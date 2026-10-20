/**
 * Yjs WebSocket server for loica real-time collaboration.
 * Runs as a separate process on WS_PORT (default 4001).
 *
 * Auth: connections are authenticated via session cookie (workspace membership
 * or shared folder access) or via share token (?token= query param for public
 * view/edit documents). Unauthenticated connections are rejected.
 */

// Importing db.server triggers schema creation + PRAGMAs on first run, so
// ws-server can boot against a brand-new app.db without the web server
// having started first.
import "./app/lib/db.server.ts";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "node:http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { dbPath } from "./app/lib/paths.server.ts";

// ─── Import modular components ────────────────────────────────────────────────

import { authenticateWs } from "./ws/auth.ts";
import { deleteOldActivity } from "./app/lib/activity.server.ts";
import {
  initializePersistenceStatements,
  loadDocumentState,
  saveIfSafe,
  maybeAutoVersion,
  saveCommentsFromYjs,
  getDocContent,
  saveDocumentUpdate,
  lookupUserName,
  type PersistenceStatements,
} from "./ws/persistence.ts";
import {
  initializeCleanupStatements,
  cleanupStaleDocs,
  cleanupOrphanUploads,
  pruneAutoVersions,
  deleteOldNotifications,
  deleteOldClientErrors,
  purgeExpiredTrash,
  type CleanupStatements,
} from "./ws/cleanup.ts";
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLEANUP_INTERVAL,
  MAX_SPREADSHEET_CELLS,
  MAX_SPREADSHEET_DIMENSIONS,
  WS_CLOSE_DOCUMENT_RESTORED,
  WS_CLOSE_ACCESS_REVOKED,
  WS_CLOSE_DOC_UNAVAILABLE,
  type Room,
} from "./ws/types.ts";

// ─── DB ───────────────────────────────────────────────────────────────────────

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// ─── Schema migrations (idempotent) ─────────────────────────────────────────
try {
  db.exec("ALTER TABLE documents ADD COLUMN comments_migrated INTEGER NOT NULL DEFAULT 0");
} catch {
  /* exists */
}
try {
  db.exec("ALTER TABLE document_versions ADD COLUMN yjs_state BLOB");
} catch {
  /* exists */
}
db.exec(`CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  thread_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  anchor_from TEXT,
  anchor_to   TEXT,
  anchor_text TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
)`);
try {
  db.exec(`CREATE TABLE IF NOT EXISTS document_updates (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     TEXT,
    user_name   TEXT,
    yjs_update  BLOB NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
} catch {
  /* exists */
}
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_doc_updates ON document_updates(document_id, created_at DESC)");
} catch {
  /* exists */
}

// ─── Initialize persistence and cleanup statements ───────────────────────────

const persistenceStmts: PersistenceStatements = initializePersistenceStatements(db);
const cleanupStmts: CleanupStatements = initializeCleanupStatements(db);

// ─── Per-room pending updates with throttling ─────────────────────────────────

interface PendingUpdate {
  update: Uint8Array;
  userId: string | null;
  userName: string | null;
  docId: string;
  createdAt: number;
}

// Per-room pending updates: key = `${docId}:${userId}`, value = merged update
const pendingUpdates = new Map<string, PendingUpdate>();
const updateFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushPendingUpdate(key: string) {
  const pending = pendingUpdates.get(key);
  if (!pending) return;
  pendingUpdates.delete(key);
  updateFlushTimers.delete(key);
  try {
    saveDocumentUpdate(db, pending.docId, pending.userId, pending.userName, pending.update, pending.createdAt);
    // Prune occasionally (1% of flushes)
    if (Math.random() < 0.01) {
      cleanupStmts.pruneUpdates?.run({ docId: pending.docId });
    }
  } catch (err) {
    console.error("[ws] Failed to save update:", err);
  }
}

// ─── In-memory doc rooms ──────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

function getOrCreateRoom(docId: string): Room {
  if (rooms.has(docId)) return rooms.get(docId)!;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  // Load persisted state from SQLite
  loadDocumentState(db, persistenceStmts, doc, docId);

  const room: Room = {
    doc,
    awareness,
    connections: new Map(),
    wsUserMap: new Map(),
    wsUserNameMap: new Map(),
    wsAccessMap: new Map(),
    saveTimer: null,
    firstPendingSaveAt: null,
    lastVersionAt: Date.now(),
    lastEditor: null,
    colorByIdentity: new Map(),
    nextColorIndex: 0,
    anonSeq: 0,
    wsColorMap: new Map(),
  };

  // Attribute edits to the user whose connection caused the update. The
  // second arg to `doc.on("update", ...)` is the origin passed to
  // `Y.applyUpdate` / the sync protocol — our sync handler forwards the
  // client's `ws` as origin, so we can look up the user there. This replaces
  // the old approach of setting `lastEditor` on every inbound sync message,
  // which mis-attributed edits to viewers whose step2 handshake didn't
  // actually change the document.
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin instanceof Object && room.wsUserMap.has(origin as WebSocket)) {
      const uid = room.wsUserMap.get(origin as WebSocket);
      if (uid) room.lastEditor = uid;
    }
    scheduleSave(docId, room);
  });

  // Log each Yjs update with user attribution for document history
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (!room.wsUserMap.has(origin as WebSocket)) return; // skip DB/local origins
    const ws = origin as WebSocket;
    const userId = room.wsUserMap.get(ws) ?? null;
    if (!userId) return;
    // Resolved once at connect time (see handleConnection) — a connection's
    // name doesn't change mid-session, so there's no need to hit the DB here.
    const userName = room.wsUserNameMap.get(ws) ?? null;
    const key = `${docId}:${userId}`;
    const now = Math.floor(Date.now() / 1000);
    const existing = pendingUpdates.get(key);
    let merged: Uint8Array;
    try {
      merged = existing ? Y.mergeUpdates([existing.update, update]) : update;
    } catch {
      merged = update;
    }
    pendingUpdates.set(key, {
      update: merged,
      userId,
      userName,
      docId,
      createdAt: existing?.createdAt ?? now,
    });
    clearTimeout(updateFlushTimers.get(key));
    updateFlushTimers.set(key, setTimeout(() => flushPendingUpdate(key), 1000));
  });

  // A comments-map entry's userId is client-supplied CRDT data — an
  // anonymous edit-token guest can craft one claiming to be any real user
  // (their id is visible to guests via the awareness broadcast). Bind each
  // new comment's stored author to the authenticated identity of the WS
  // connection whose transaction actually created it; never trust the
  // client-asserted value. Only re-bind on creation, not on later edits
  // (e.g. another collaborator resolving the thread), so legitimate
  // updates by a different user don't get misattributed.
  const commentsMap = doc.getMap("comments");
  commentsMap.observe((event, transaction) => {
    const origin = transaction.origin;
    if (!(origin instanceof Object) || !room.wsUserMap.has(origin as WebSocket)) return;
    const authorId = room.wsUserMap.get(origin as WebSocket) ?? "guest";
    for (const [key, change] of event.changes.keys) {
      if (change.action !== "add") continue;
      const entry = commentsMap.get(key) as Record<string, unknown> | undefined;
      if (!entry || typeof entry !== "object" || entry.userId === authorId) continue;
      doc.transact(() => {
        commentsMap.set(key, { ...entry, userId: authorId });
      }, origin);
    }
  });

  // Spreadsheet Y.Maps are only capped when seeding from persisted content
  // (see seedSpreadsheetMaps) — nothing re-checked their size on the live
  // collaborative-edit path, so a sustained stream of small updates could
  // grow any of them unbounded. Revert overflow keys a transaction just
  // added, keeping each map at its cap. No-op for non-spreadsheet docs,
  // whose ss-* maps just stay empty.
  capMapSize(doc, doc.getMap("ss-cells"), MAX_SPREADSHEET_CELLS);
  capMapSize(doc, doc.getMap("ss-styles"), MAX_SPREADSHEET_CELLS);
  capMapSize(doc, doc.getMap("ss-colWidths"), MAX_SPREADSHEET_DIMENSIONS);
  capMapSize(doc, doc.getMap("ss-rowHeights"), MAX_SPREADSHEET_DIMENSIONS);

  rooms.set(docId, room);
  return room;
}

function capMapSize(doc: Y.Doc, map: Y.Map<unknown>, max: number): void {
  map.observe((event, transaction) => {
    let overflow = map.size - max;
    if (overflow <= 0) return;
    const toRemove: string[] = [];
    for (const [key, change] of event.changes.keys) {
      if (overflow <= 0) break;
      if (change.action !== "add") continue;
      toRemove.push(key);
      overflow--;
    }
    if (toRemove.length === 0) return;
    doc.transact(() => {
      for (const key of toRemove) map.delete(key);
    }, transaction.origin);
  });
}

const SAVE_DEBOUNCE_MS = 2000;
// A steady stream of updates (e.g. someone typing continuously) kept
// resetting the plain debounce below, so a room could go unsaved for its
// whole session. Cap how long a save can be deferred regardless of new
// activity.
const SAVE_MAX_WAIT_MS = 10_000;

function flushRoomSave(docId: string, room: Room) {
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  const content = getDocContent(room.doc);
  if (saveIfSafe(persistenceStmts, docId, content, state, room.lastEditor)) {
    room.lastVersionAt = maybeAutoVersion(persistenceStmts, docId, room.doc, content, room.lastVersionAt, room.lastEditor);
  }
  // Persist comments from Yjs map to DB
  try {
    const commentsMap = room.doc.getMap("comments");
    saveCommentsFromYjs(db, persistenceStmts, docId, commentsMap);
  } catch (err) {
    console.error(`[ws-server] Failed to save comments for doc ${docId}:`, err);
  }
}

function scheduleSave(docId: string, room: Room) {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  if (room.firstPendingSaveAt == null) room.firstPendingSaveAt = Date.now();
  const elapsed = Date.now() - room.firstPendingSaveAt;
  const delay = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, SAVE_MAX_WAIT_MS - elapsed));
  room.saveTimer = setTimeout(() => {
    room.firstPendingSaveAt = null;
    room.saveTimer = null;
    flushRoomSave(docId, room);
  }, delay);
}

// ─── Message utilities ────────────────────────────────────────────────────────

function send(ws: WebSocket, message: Uint8Array) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(message);
  }
}

function broadcastToRoom(room: Room, message: Uint8Array, exclude?: WebSocket) {
  for (const [conn] of room.connections) {
    if (conn !== exclude) send(conn, message);
  }
}

// ─── Cursor colour assignment ──────────────────────────────────────────────────
//
// Collision-free within a room for its first 12 distinct identities (one
// colour per join, in join order); a 13th falls back to a deterministic hash
// of its identity key, which can collide with another identity but never
// changes for the same one.
const CURSOR_PALETTE = [
  "#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#264653", "#457b9d",
  "#b5838d", "#6d6875", "#52b788", "#f07167", "#8338ec", "#3a86ff",
];

function hashColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length];
}

function assignRoomColor(room: Room, identityKey: string): string {
  const existing = room.colorByIdentity.get(identityKey);
  if (existing) return existing;
  const color = room.nextColorIndex < CURSOR_PALETTE.length
    ? CURSOR_PALETTE[room.nextColorIndex++]
    : hashColor(identityKey);
  room.colorByIdentity.set(identityKey, color);
  return color;
}

// ─── Live access control: kick / re-check ─────────────────────────────────────
//
// Permissions are checked only at connect time (authenticateWs, below). If a
// share is revoked, a member removed, or a role downgraded afterwards, an
// already-open connection doesn't know. Two mechanisms close that gap:
//  1. Explicit kick: the web process calls POST /kick (or /kick/:docId) right
//     after it revokes access, so the affected connection drops immediately
//     instead of waiting for the next sweep.
//  2. Periodic sweep: every heartbeat tick, every open connection is
//     re-authenticated against current DB state, catching access lost any
//     other way within HEARTBEAT_INTERVAL_MS.
// Both funnel through recheckConnection() so the logic lives in one place.

// Map from ws to the original upgrade request, kept so a later re-check can
// re-run authenticateWs() exactly as it ran at connect time (same cookie /
// ?token=). Populated on connect, cleared on close.
const connReqMap = new Map<WebSocket, import("http").IncomingMessage>();

/**
 * Re-authenticate one connection against current DB state. Closes it if
 * access was lost entirely; otherwise updates its stored access level so a
 * downgrade (editor -> viewer) takes effect without forcing a reconnect.
 * Returns true if the connection was closed.
 */
function recheckConnection(docId: string, room: Room, ws: WebSocket, reason: string): boolean {
  const req = connReqMap.get(ws);
  if (!req) return false; // shouldn't happen; be conservative and leave the connection be
  const auth = authenticateWs(db, req, docId);
  if (!auth) {
    ws.close(WS_CLOSE_ACCESS_REVOKED, reason);
    return true;
  }
  if (room.wsAccessMap.get(ws) !== auth.access) {
    room.wsAccessMap.set(ws, auth.access);
  }
  return false;
}

/** Re-check (and close if it now fails) connections in one room, optionally scoped to one user. */
function kickRoom(docId: string, userId: string | undefined, reason: string): number {
  const room = rooms.get(docId);
  if (!room) return 0;
  let closed = 0;
  for (const [ws, connUserId] of room.wsUserMap) {
    if (userId !== undefined && connUserId !== userId) continue;
    if (recheckConnection(docId, room, ws, reason)) closed++;
  }
  return closed;
}

/** Re-check (and close if it now fails) one user's connections across every room. */
function kickUserEverywhere(userId: string, reason: string): number {
  let closed = 0;
  for (const [docId, room] of rooms) {
    for (const [ws, connUserId] of room.wsUserMap) {
      if (connUserId !== userId) continue;
      if (recheckConnection(docId, room, ws, reason)) closed++;
    }
  }
  return closed;
}

/** Unconditionally close a room's connections — for lifecycle events (trash/move/delete) that
 *  authenticateWs() has no opinion on, so a recheck-based kick would be a silent no-op. */
function closeRoomConnections(docId: string, code: number, reason: string): number {
  const room = rooms.get(docId);
  if (!room) return 0;
  let closed = 0;
  for (const [ws] of room.wsUserMap) {
    ws.close(code, reason);
    closed++;
  }
  return closed;
}

// ─── Connection handler ───────────────────────────────────────────────────────

function handleConnection(ws: WebSocket, docId: string, accessLevel: "read" | "write", userId: string | null) {
  const room = getOrCreateRoom(docId);
  const clientIds = new Set<number>();
  room.connections.set(ws, clientIds);
  room.wsUserMap.set(ws, userId);
  room.wsAccessMap.set(ws, accessLevel);

  // Resolve identity once at connect: a real account gets its DB name and a
  // room-stable colour; an anonymous share-link guest ("guest" or null) gets
  // its own per-connection colour slot but no borrowed name.
  const hasRealIdentity = !!userId && userId !== "guest";
  const userName = hasRealIdentity ? lookupUserName(persistenceStmts, userId) : null;
  room.wsUserNameMap.set(ws, userName);
  const identityKey = hasRealIdentity ? userId : `guest:${room.anonSeq++}`;
  room.wsColorMap.set(ws, assignRoomColor(room, identityKey));

  // 1. Send sync step 1 (our state vector)
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(ws, encoding.toUint8Array(encoder));
  }

  // 2. Broadcast current awareness states to the newcomer
  {
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(states.keys())
        )
      );
      send(ws, encoding.toUint8Array(encoder));
    }
  }

  // Track awareness client IDs added by this connection
  const onAwarenessChange = (
    { added }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === ws) {
      for (const id of added) clientIds.add(id);
    }
  };
  room.awareness.on("change", onAwarenessChange);

  ws.on("message", (data: Buffer) => {
    // Reject oversized raw messages before they inflate the in-memory Yjs doc
    const MAX_MESSAGE_BYTES = 10 * 1024 * 1024; // 10 MB
    if (data.byteLength > MAX_MESSAGE_BYTES) {
      console.warn(
        `[ws-server] Dropping oversized message (${data.byteLength} bytes) for doc ${docId}`
      );
      return;
    }

    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        // Peek at the sync message type before processing
        const syncType = decoding.readVarUint(decoder);

        // Read-only clients can only send sync step 1 (request state),
        // not sync step 2 (send state) or updates. Read from the live map,
        // not the connect-time `accessLevel` param — recheckConnection()
        // (see the heartbeat sweep and /kick) updates it in place on a
        // editor -> viewer downgrade, without forcing a reconnect.
        if (room.wsAccessMap.get(ws) === "read" && syncType !== syncProtocol.messageYjsSyncStep1) {
          return; // silently drop write attempts from read-only clients
        }

        // Re-create decoder since we consumed the sync type
        const fullDecoder = decoding.createDecoder(new Uint8Array(data));
        decoding.readVarUint(fullDecoder); // skip MESSAGE_SYNC

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncMsgType = syncProtocol.readSyncMessage(fullDecoder, encoder, room.doc, ws);
        // For step 1 (state-vector exchange), send back step 2 (full state)
        if (
          syncMsgType === syncProtocol.messageYjsSyncStep1 &&
          encoding.length(encoder) > 1
        ) {
          send(ws, encoding.toUint8Array(encoder));
        }
        // For step 2 / update, broadcast to other connections. (lastEditor
        // is tracked inside the Yjs `doc.on("update", ...)` handler so that
        // viewer handshakes that don't actually change the doc don't steal
        // edit attribution.)
        if (syncMsgType !== syncProtocol.messageYjsSyncStep1) {
          broadcastToRoom(room, data, ws);
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);

        // Anti-spoof: the "user" field in an awareness state (name, colour,
        // userId) is client-supplied — an edit-token guest could otherwise
        // claim to be any real user, since their id is visible to everyone
        // via this same broadcast. Overwrite it on this connection's own
        // client IDs with what was verified at connect time, then re-encode
        // before broadcasting so peers never see the claimed values.
        let corrected = false;
        for (const clientId of clientIds) {
          const state = room.awareness.states.get(clientId);
          if (!state?.user) continue;
          const authUserId = room.wsUserMap.get(ws) ?? null;
          const verifiedUserId = authUserId && authUserId !== "guest" ? authUserId : null;
          room.awareness.states.set(clientId, {
            ...state,
            user: {
              ...state.user,
              userId: verifiedUserId,
              name: verifiedUserId ? room.wsUserNameMap.get(ws) ?? state.user.name : state.user.name,
              color: room.wsColorMap.get(ws) ?? state.user.color,
            },
          });
          corrected = true;
        }
        if (corrected) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(clientIds))
          );
          broadcastToRoom(room, encoding.toUint8Array(encoder), ws);
        } else {
          broadcastToRoom(room, data, ws);
        }
      }
    } catch (err) {
      console.error(`[ws-server] Error processing message for doc ${docId}:`, err);
      ws.close(1011, "Internal error");
    }
  });

  ws.on("close", () => {
    room.awareness.off("change", onAwarenessChange);
    room.connections.delete(ws);
    room.wsUserMap.delete(ws);
    room.wsUserNameMap.delete(ws);
    room.wsAccessMap.delete(ws);
    room.wsColorMap.delete(ws);
    connReqMap.delete(ws);
    // Remove this client's awareness state
    if (clientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        Array.from(clientIds),
        "connection closed"
      );
    }
    // Clean up room if empty (after a grace period so reconnects don't re-init)
    if (room.connections.size === 0) {
      setTimeout(() => teardownEmptyRoom(docId, room), 30_000);
    }
  });
}

/**
 * Runs 30s after a room's last connection drops (scheduled above). Bails if
 * the room was already torn down in the meantime — e.g. by /reset after a
 * version restore — or if a client reconnected during the grace period.
 */
function teardownEmptyRoom(docId: string, room: Room) {
  if (!rooms.has(docId) || rooms.get(docId) !== room) return;
  if (room.connections.size !== 0) return;

  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  const content = getDocContent(room.doc);
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
  }
  // Final save (skip if oversized)
  if (saveIfSafe(persistenceStmts, docId, content, state, room.lastEditor)) {
    // Force an auto-version on room teardown, regardless of interval —
    // this captures the final edits of a short session.
    room.lastVersionAt = maybeAutoVersion(persistenceStmts, docId, room.doc, content, room.lastVersionAt, room.lastEditor, true);
  }
  // Persist comments
  try {
    const commentsMap = room.doc.getMap("comments");
    saveCommentsFromYjs(db, persistenceStmts, docId, commentsMap);
  } catch (e) {
    console.error("[ws] error persisting comments on room close:", e);
  }
  // Flush pending updates for this room
  const keysToFlush = Array.from(pendingUpdates.keys()).filter(k => k.startsWith(`${docId}:`));
  for (const key of keysToFlush) {
    const timer = updateFlushTimers.get(key);
    if (timer) clearTimeout(timer);
    flushPendingUpdate(key);
  }
  rooms.delete(docId);
}

// ─── HTTP + WS server ─────────────────────────────────────────────────────────

const PORT = Number(process.env.WS_PORT ?? 4001);

function flushAndDestroyRoom(docId: string) {
  const room = rooms.get(docId);
  if (!room) return;
  // Cancel pending save — do NOT flush, the DB already has the restored content
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  // Remove from map BEFORE closing connections so close handlers
  // won't trigger a final save that overwrites the restored content
  rooms.delete(docId);
  // Close all WS connections so clients reconnect with fresh state
  for (const [conn] of room.connections) {
    conn.close(WS_CLOSE_DOCUMENT_RESTORED, "Document restored");
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("loica yjs ws server");
});

// ─── Admin HTTP endpoints (/reset, /status) ────────────────────────────────
//
// These are internal-only: the sole legitimate caller is this same host's
// web process (document.server.ts's restoreDocumentVersion), over loopback.
// They live on their own server bound to 127.0.0.1, on a port no reverse
// proxy is ever configured to forward to — a `remoteAddress` check alone
// isn't sufficient here, because a same-host reverse proxy that strips a
// path prefix (e.g. Caddy's `handle_path /ws/*`) makes its own loopback
// connection to ws-server look local for any path that survives the strip.

function isLoopback(req: import("http").IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

const adminServer = http.createServer((req, res) => {
  if (!isLoopback(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  // POST /reset/:docId — used after restoring a version
  const resetMatch = pathname.match(/^\/reset\/(.+)$/);
  if (req.method === "POST" && resetMatch) {
    const docId = resetMatch[1];
    flushAndDestroyRoom(docId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /kick/:docId or /kick — re-check access and drop connections that
  // lost it. Called by the web process right after it revokes a share, a
  // membership, or a role (unshareFolder, unshareDoc, removeTeamspaceMember,
  // updateTeamspaceMemberRole, setViewShare/setEditShare(false), ...).
  // ?userId= scopes to one user; omitted with a :docId it re-checks everyone
  // in that room; omitted entirely with no :docId it is a (deliberate) no-op.
  const kickMatch = pathname.match(/^\/kick(?:\/(.+))?$/);
  if (req.method === "POST" && kickMatch) {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const userId = params.get("userId") ?? undefined;
    const reason = params.get("reason") ?? "Access revoked";
    const kickDocId = kickMatch[1];
    const closed = kickDocId
      ? kickRoom(kickDocId, userId, reason)
      : userId
        ? kickUserEverywhere(userId, reason)
        : 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, closed }));
    return;
  }

  // POST /notify/:docId?reason= — unconditionally close a room's connections
  // for a lifecycle event (trash/move/rename/delete) that authenticateWs()
  // has no opinion on, so /kick's recheck would be a silent no-op. The
  // client treats WS_CLOSE_DOC_UNAVAILABLE as permanent (see ws/types.ts)
  // and shows the reason instead of retrying.
  const notifyMatch = pathname.match(/^\/notify\/(.+)$/);
  if (req.method === "POST" && notifyMatch) {
    const docId = notifyMatch[1];
    const reason = new URL(req.url ?? "/", "http://localhost").searchParams.get("reason") ?? "Document unavailable";
    const closed = closeRoomConnections(docId, WS_CLOSE_DOC_UNAVAILABLE, reason);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, closed }));
    return;
  }

  // GET /room/:docId — is a Yjs room currently live for this doc? Lets the
  // web process (see app/lib/ws-notify.server.ts) reject a direct `content`
  // write while a collaborative session owns the document, instead of
  // silently losing it to the next debounced Yjs save.
  const roomMatch = pathname.match(/^\/room\/(.+)$/);
  if (req.method === "GET" && roomMatch) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ live: rooms.has(roomMatch[1]) }));
    return;
  }

  // GET /status — active rooms + connected users
  if (req.method === "GET" && pathname === "/status") {
    const stmtDocTitle = db.prepare("SELECT title FROM documents WHERE id = ?");
    const activeRooms: Array<{
      docId: string;
      title: string;
      users: Array<{ name: string; color: string }>;
    }> = [];

    for (const [docId, room] of rooms) {
      if (room.connections.size === 0) continue;
      const states = room.awareness.getStates();
      const users: Array<{ name: string; color: string }> = [];
      for (const [, state] of states) {
        if (state.user?.name) {
          users.push({ name: state.user.name, color: state.user.color ?? "#888" });
        }
      }
      if (users.length === 0) continue;
      const docRow = stmtDocTitle.get(docId) as { title: string } | undefined;
      activeRooms.push({
        docId,
        title: docRow?.title || "Untitled",
        users,
      });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rooms: activeRooms }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// Build allowed origins from WS_URL or ALLOWED_ORIGINS env var
const allowedOrigins = new Set<string>();
const wsUrl = process.env.WS_URL;
if (wsUrl) {
  try {
    // WS_URL like "wss://your-domain.com/ws" → origin "https://your-domain.com"
    const u = new URL(wsUrl);
    const httpOrigin = `${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`;
    allowedOrigins.add(httpOrigin);
  } catch (e) {
    console.error("[ws] error parsing WS_URL:", e);
  }
}
if (process.env.ALLOWED_ORIGINS) {
  for (const o of process.env.ALLOWED_ORIGINS.split(",")) {
    allowedOrigins.add(o.trim());
  }
}
// Always allow localhost in development
allowedOrigins.add("http://localhost:4000");
allowedOrigins.add("http://localhost:4001");

const wss = new WebSocketServer({
  server,
  verifyClient: (info: { origin: string; req: import("http").IncomingMessage; secure: boolean }) => {
    // Skip origin check if no origins configured (dev without WS_URL)
    if (allowedOrigins.size <= 2) return true; // only the localhost defaults
    const origin = info.origin ?? (info.req.headers.origin as string | undefined) ?? "";
    if (!origin) return true; // non-browser clients (curl, server-to-server)
    return allowedOrigins.has(origin);
  },
});

const MAX_CONNECTIONS_PER_IP = 50;
const connectionsByIp = new Map<string, number>();

// Same trusted-hop-count contract as app/lib/rate-limit.server.ts's
// getClientIp() — keep TRUST_PROXY_HOPS consistent across both processes.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 0);

function getClientIp(req: import("http").IncomingMessage): string {
  if (TRUST_PROXY_HOPS > 0) {
    const forwarded = req.headers["x-forwarded-for"];
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (header) {
      const hops = header.split(",").map((h) => h.trim()).filter(Boolean);
      const clientHop = hops[hops.length - TRUST_PROXY_HOPS];
      if (clientHop) return clientHop;
    }
  }
  // No trusted proxy configured: this process has direct access to the raw
  // socket, so fall back to that instead of trusting attacker input.
  return req.socket.remoteAddress ?? "unknown";
}

// Heartbeat: server-initiated WS ping every 20s. If a client hasn't ponged
// within 45s we treat the socket as dead and terminate it, freeing the slot
// and letting the client's y-websocket auto-reconnect fire immediately
// instead of waiting for TCP timeouts (which can take minutes).
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    const lastPong = (ws as WebSocket & { lastPong?: number }).lastPong ?? now;
    if (now - lastPong > HEARTBEAT_TIMEOUT_MS) {
      ws.terminate();
      continue;
    }
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch { /* socket closing */ }
    }
  }
  // Safety net for access lost without an explicit /kick call (e.g. the
  // caller forgot, or the SHARED_ACCESS_TTL cache just expired on its own).
  // Same recheckConnection() used by /kick, just unscoped.
  for (const [docId, room] of rooms) {
    for (const [ws] of room.wsUserMap) {
      // One failing check (e.g. DB busy) must not skip the remaining
      // connections for this tick.
      try {
        recheckConnection(docId, room, ws, "Access revoked");
      } catch (e) {
        console.error(`[ws-server] Access re-check failed for doc ${docId}:`, e);
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on("close", () => clearInterval(heartbeatTimer));

wss.on("connection", (ws, req) => {
  (ws as WebSocket & { lastPong?: number }).lastPong = Date.now();
  ws.on("pong", () => {
    (ws as WebSocket & { lastPong?: number }).lastPong = Date.now();
  });

  const ip = getClientIp(req);
  const count = connectionsByIp.get(ip) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1008, "Too many connections");
    return;
  }
  connectionsByIp.set(ip, count + 1);
  ws.on("close", () => {
    const c = connectionsByIp.get(ip) ?? 1;
    if (c <= 1) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, c - 1);
  });

  // URL pattern: /<docId>
  const docId = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
  if (!docId) {
    ws.close(1008, "Missing docId");
    return;
  }

  // Verify doc exists
  const row = persistenceStmts.loadDoc.get({ id: docId }) as { content: string } | undefined;
  if (!row) {
    ws.close(1008, "Document not found");
    return;
  }

  // Authenticate: session cookie, workspace membership, shared access, or share token
  const auth = authenticateWs(db, req, docId);
  if (!auth) {
    ws.close(1008, "Unauthorized");
    return;
  }

  // Kept so a later live re-check (recheckConnection) can re-run
  // authenticateWs() with the same cookie/token this connection used.
  // Cleared in handleConnection's own close handler.
  connReqMap.set(ws, req);

  handleConnection(ws, docId, auth.access, auth.userId);
});

// ─── Uncaught error handling ──────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  console.error("[ws-server] Uncaught exception:", err);
  // Don't exit — keep serving other connections
});

process.on("unhandledRejection", (reason) => {
  console.error("[ws-server] Unhandled rejection:", reason);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

function gracefulShutdown(signal: string) {
  console.log(`[ws-server] ${signal} received — flushing ${rooms.size} room(s) to DB…`);

  for (const [docId, room] of rooms) {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      room.saveTimer = null;
    }
    try {
      const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
      const content = getDocContent(room.doc);
      saveIfSafe(persistenceStmts, docId, content, state, room.lastEditor);
      const commentsMap = room.doc.getMap("comments");
      saveCommentsFromYjs(db, persistenceStmts, docId, commentsMap);
    } catch (err) {
      console.error(`[ws-server] Failed to flush room ${docId}:`, err);
    }
  }

  // Flush the per-user document_updates audit log too — it debounces on its
  // own 1s timer (see pendingUpdates/updateFlushTimers above), independent
  // of the per-room save above, and was previously left for the next flush
  // timer that a shutdown never lets fire.
  for (const key of Array.from(pendingUpdates.keys())) {
    const timer = updateFlushTimers.get(key);
    if (timer) clearTimeout(timer);
    flushPendingUpdate(key);
  }

  // Close all WebSocket connections
  for (const [, room] of rooms) {
    for (const [conn] of room.connections) {
      conn.close(1001, "Server shutting down");
    }
  }
  rooms.clear();

  server.close(() => {
    console.log("[ws-server] Shutdown complete.");
    process.exit(0);
  });

  // Force exit after 5 seconds if connections won't close
  setTimeout(() => {
    console.error("[ws-server] Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─── Background cleanup tasks ─────────────────────────────────────────────────

// Each task runs on its own: one throwing (locked DB, missing file) must not
// skip the rest or surface as an unhandled rejection from the timer.
async function runTask(name: string, task: () => void | Promise<void>): Promise<void> {
  try {
    await task();
  } catch (e) {
    console.error(`[ws-server] Cleanup task "${name}" failed:`, e);
  }
}

async function runCleanup(): Promise<void> {
  await runTask("stale docs", () => cleanupStaleDocs(cleanupStmts, new Set(rooms.keys())));
  await runTask("orphan uploads", () => cleanupOrphanUploads(db));
  await runTask("auto-versions", () => pruneAutoVersions(db));
  await runTask("notifications", () => deleteOldNotifications(db));
  await runTask("client errors", () => deleteOldClientErrors(db));
  // So trash gets purged on a schedule, not only when someone happens to
  // open a trash page. A room still open on a purged doc would keep
  // accepting edits that can no longer be saved: close it first.
  await runTask("trash", () => {
    for (const docId of purgeExpiredTrash(db)) {
      closeRoomConnections(docId, WS_CLOSE_DOC_UNAVAILABLE, "Document permanently deleted");
    }
  });
  await runTask("activity", () => deleteOldActivity());
}

const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL);

// Run cleanup tasks once on startup after a short delay
setTimeout(runCleanup, 10_000);

// ─── Start ───────────────────────────────────────────────────────────────────

// Production sits behind a reverse proxy, so bind to loopback unless told
// otherwise (the Docker image sets 0.0.0.0). Dev binds everywhere because macOS
// resolves `localhost` to ::1, which a 127.0.0.1 listener would miss.
const WS_HOST = process.env.WS_HOST ?? (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
server.listen(PORT, WS_HOST, () => {
  console.log(`[ws-server] Yjs WebSocket server listening on ws://${WS_HOST}:${PORT}`);
});

const WS_ADMIN_PORT = Number(process.env.WS_ADMIN_PORT ?? PORT + 1);
adminServer.listen(WS_ADMIN_PORT, "127.0.0.1", () => {
  console.log(`[ws-server] Admin endpoints listening on http://127.0.0.1:${WS_ADMIN_PORT} (loopback only)`);
});
