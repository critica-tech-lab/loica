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
import {
  initializePersistenceStatements,
  loadDocumentState,
  saveIfSafe,
  maybeAutoVersion,
  saveCommentsFromYjs,
  getDocContent,
  saveDocumentUpdate,
  type PersistenceStatements,
} from "./ws/persistence.ts";
import {
  initializeCleanupStatements,
  cleanupStaleDocs,
  cleanupOrphanUploads,
  pruneAutoVersions,
  deleteOldNotifications,
  type CleanupStatements,
} from "./ws/cleanup.ts";
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  CLEANUP_INTERVAL,
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
    saveTimer: null,
    lastVersionAt: Date.now(),
    lastEditor: null,
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
    // Get user name from DB
    let userName: string | null = null;
    try {
      const u = db.prepare<[string], { name: string }>("SELECT name FROM users WHERE id = ?").get(userId);
      userName = u?.name ?? null;
    } catch {}
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

  rooms.set(docId, room);
  return room;
}

function scheduleSave(docId: string, room: Room) {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
    const content = getDocContent(room.doc);
    if (saveIfSafe(persistenceStmts, docId, content, state, room.lastEditor)) {
      room.lastVersionAt = maybeAutoVersion(persistenceStmts, docId, room.doc, content, room.lastVersionAt, room.lastEditor);
    }
    // Persist comments from Yjs map to DB
    try {
      const commentsMap = room.doc.getMap("comments");
      saveCommentsFromYjs(db, docId, commentsMap);
    } catch (err) {
      console.error(`[ws-server] Failed to save comments for doc ${docId}:`, err);
    }
    room.saveTimer = null;
  }, 2000);
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

// ─── Connection handler ───────────────────────────────────────────────────────

function handleConnection(ws: WebSocket, docId: string, accessLevel: "read" | "write", userId: string | null) {
  const room = getOrCreateRoom(docId);
  const clientIds = new Set<number>();
  room.connections.set(ws, clientIds);
  room.wsUserMap.set(ws, userId);

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
        // not sync step 2 (send state) or updates
        if (accessLevel === "read" && syncType !== syncProtocol.messageYjsSyncStep1) {
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
        broadcastToRoom(room, data, ws);
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
      setTimeout(() => {
        // Skip if room was already destroyed (e.g. by /reset after a version restore)
        if (!rooms.has(docId) || rooms.get(docId) !== room) return;
        if (room.connections.size === 0) {
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
            saveCommentsFromYjs(db, docId, commentsMap);
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
      }, 30_000);
    }
  });
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
    conn.close(4000, "Document restored");
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  // POST /reset/:docId — used after restoring a version (localhost only)
  const resetMatch = pathname.match(/^\/reset\/(.+)$/);
  if (req.method === "POST" && resetMatch) {
    const remote = req.socket.remoteAddress ?? "";
    const isLocal = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!isLocal) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    const docId = resetMatch[1];
    flushAndDestroyRoom(docId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /status — active rooms + connected users (localhost only)
  if (req.method === "GET" && pathname === "/status") {
    const remote = req.socket.remoteAddress ?? "";
    const isLocal = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!isLocal) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

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

  res.writeHead(200);
  res.end("loica yjs ws server");
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
}, HEARTBEAT_INTERVAL_MS);
wss.on("close", () => clearInterval(heartbeatTimer));

wss.on("connection", (ws, req) => {
  (ws as WebSocket & { lastPong?: number }).lastPong = Date.now();
  ws.on("pong", () => {
    (ws as WebSocket & { lastPong?: number }).lastPong = Date.now();
  });

  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0].trim()
    ?? req.socket.remoteAddress ?? "unknown";
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
      saveCommentsFromYjs(db, docId, commentsMap);
    } catch (err) {
      console.error(`[ws-server] Failed to flush room ${docId}:`, err);
    }
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

const cleanupTimer = setInterval(() => {
  cleanupStaleDocs(cleanupStmts, new Set(rooms.keys()));
  cleanupOrphanUploads(db, cleanupStmts);
  pruneAutoVersions(db);
  deleteOldNotifications(db);
}, CLEANUP_INTERVAL);

// Run cleanup tasks once on startup after a short delay
setTimeout(() => {
  cleanupStaleDocs(cleanupStmts, new Set(rooms.keys()));
  cleanupOrphanUploads(db, cleanupStmts);
  pruneAutoVersions(db);
  deleteOldNotifications(db);
}, 10_000);

// ─── Start ───────────────────────────────────────────────────────────────────

const WS_HOST = process.env.WS_HOST ?? "0.0.0.0";
server.listen(PORT, WS_HOST, () => {
  console.log(`[ws-server] Yjs WebSocket server listening on ws://${WS_HOST}:${PORT}`);
});
