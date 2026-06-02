/**
 * Shared types, interfaces, and constants for the WebSocket server.
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebSocket } from "ws";

// ─── Size limits ──────────────────────────────────────────────────────────────

export const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_MESSAGE_BYTES = MAX_DOC_BYTES * 2; // 10 MB raw WS message

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
  saveTimer: ReturnType<typeof setTimeout> | null;
  lastVersionAt: number;
  lastEditor: string | null;
}

// ─── Message types (y-websocket protocol) ─────────────────────────────────────

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

// ─── Cleanup ───────────────────────────────────────────────────────────────────

export const AUTO_VERSION_INTERVAL = 5 * 1000; // 5s — TESTING MODE, revert to 60*1000
export const RING_BUFFER_SIZE = 15; // always keep the last N auto-versions per doc
export const SHARED_ACCESS_TTL = 5 * 60 * 1000; // 5 minutes
export const CLEANUP_INTERVAL = 60 * 60 * 1000; // every hour
export const STALE_AGE_SECS = 48 * 60 * 60; // 48 hours
export const MIN_CONTENT_LEN = 5;
