/**
 * Shared types, interfaces, and constants for the WebSocket server.
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebSocket } from "ws";
import { MAX_DOC_BYTES } from "../app/lib/doc-limits.server.ts";

// ─── Size limits ──────────────────────────────────────────────────────────────

export { MAX_DOC_BYTES };
export const MAX_MESSAGE_BYTES = MAX_DOC_BYTES * 2; // 10 MB raw WS message

// Applies both when seeding a spreadsheet doc's Y.Maps from persisted
// content and, live, on every collaborative edit — see ws-server.ts's
// capMapSize(). ss-cells/ss-styles are keyed by cell coordinate (same
// cardinality domain); ss-colWidths/ss-rowHeights are keyed by column/row
// index, bounded by grid dimensions, so a smaller cap is generous.
export const MAX_SPREADSHEET_CELLS = 10_000;
export const MAX_SPREADSHEET_DIMENSIONS = 5_000;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthResult {
  access: "read" | "write";
  userId: string | null;
}

// ─── Room state ───────────────────────────────────────────────────────────────

export interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Map<WebSocket, Set<number>>; // ws → set of awarenessClientIds
  wsUserMap: Map<WebSocket, string | null>; // ws → userId
  wsUserNameMap: Map<WebSocket, string | null>; // ws → display name, resolved once at connect
  wsAccessMap: Map<WebSocket, "read" | "write">; // ws → current access level, re-checked live (see recheckConnection)
  saveTimer: ReturnType<typeof setTimeout> | null;
  // Set when a save is first scheduled after the last flush, cleared once it
  // runs. Lets scheduleSave() enforce a maxWait even under a steady stream of
  // updates that keeps resetting the plain debounce timer.
  firstPendingSaveAt: number | null;
  lastVersionAt: number;
  lastEditor: string | null;
  // Cursor colour, assigned once per identity in join order from a fixed
  // palette (falls back to a hash once the room has more identities than
  // the palette has colours). Keyed by userId for authenticated connections,
  // or a per-connection synthetic key for anonymous share-link guests.
  colorByIdentity: Map<string, string>;
  nextColorIndex: number;
  anonSeq: number;
  wsColorMap: Map<WebSocket, string>; // ws → its assigned colour, resolved once at connect
}

// ─── Message types (y-websocket protocol) ─────────────────────────────────────

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

// ─── WS close codes ───────────────────────────────────────────────────────────
//
// y-websocket's client only auto-reconnects for codes outside [4400, 4500) —
// see node_modules/y-websocket's `defaultShouldReconnect`. DOCUMENT_RESTORED
// is deliberately below that range (the client should reconnect, just with
// its local Yjs/IndexedDB state cleared first); the other two are inside it
// (reconnecting would just be re-authenticated and closed again).
export const WS_CLOSE_DOCUMENT_RESTORED = 4000;
export const WS_CLOSE_ACCESS_REVOKED = 4401;
export const WS_CLOSE_DOC_UNAVAILABLE = 4402;

// ─── Cleanup ───────────────────────────────────────────────────────────────────

export const AUTO_VERSION_INTERVAL = 60 * 1000; // 1 minute
export const RING_BUFFER_SIZE = 15; // always keep the last N auto-versions per doc
export const SHARED_ACCESS_TTL = 5 * 60 * 1000; // 5 minutes
export const CLEANUP_INTERVAL = 60 * 60 * 1000; // every hour
export const STALE_AGE_SECS = 48 * 60 * 60; // 48 hours
export const MIN_CONTENT_LEN = 5;
