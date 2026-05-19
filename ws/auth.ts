/**
 * Authentication and authorization logic for WebSocket connections.
 */

import * as http from "node:http";
import Database from "better-sqlite3";
import type { AuthResult } from "./types.ts";

const SHARED_ACCESS_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Session cookie parsing helper.
 */
function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1) return [];
      return [[trimmed.slice(0, eq).trim(), decodeURIComponent(trimmed.slice(eq + 1).trim())]];
    })
  );
}

/**
 * Cache for shared folder/document access checks.
 * Maps "folderId:userId" to permission level with TTL.
 */
const sharedAccessCache = new Map<
  string,
  { result: "editor" | "viewer" | false; expires: number }
>();

/**
 * Evict expired cache entries and cap size at 2000.
 */
function maintainAccessCache(): void {
  // Evict expired entries
  const now = Date.now();
  for (const [key, entry] of sharedAccessCache) {
    if (entry.expires < now) sharedAccessCache.delete(key);
  }

  // Hard cap: if still over limit after expiry eviction, drop oldest entries
  if (sharedAccessCache.size > 2000) {
    const excess = sharedAccessCache.size - 1000;
    let removed = 0;
    for (const key of sharedAccessCache.keys()) {
      if (removed >= excess) break;
      sharedAccessCache.delete(key);
      removed++;
    }
  }
}

/**
 * Check shared folder access for a user.
 * Uses 5-minute cache to avoid recursive CTE on every connection.
 */
function checkSharedAccess(
  db: Database.Database,
  folderId: string | null,
  userId: string
): "editor" | "viewer" | false {
  if (!folderId) return false;

  const cacheKey = `${folderId}:${userId}`;
  const cached = sharedAccessCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;

  const ancestors = db.prepare(
    `WITH RECURSIVE chain(id, parent_id) AS (
       SELECT id, parent_id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id
     )
     SELECT id FROM chain`
  ).all(folderId) as { id: string }[];

  if (ancestors.length === 0) {
    sharedAccessCache.set(cacheKey, { result: false, expires: Date.now() + SHARED_ACCESS_TTL });
    return false;
  }

  const placeholders = ancestors.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT fs.permission FROM folder_shares fs
     WHERE fs.folder_id IN (${placeholders})
       AND fs.status = 'accepted'
       AND (fs.user_id = ? OR fs.group_id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'))
     ORDER BY CASE fs.permission WHEN 'editor' THEN 0 ELSE 1 END
     LIMIT 1`
  ).get(...ancestors.map((a) => a.id), userId, userId) as { permission: string } | undefined;

  const result: "editor" | "viewer" | false = row ? (row.permission as "editor" | "viewer") : false;

  sharedAccessCache.set(cacheKey, { result, expires: Date.now() + SHARED_ACCESS_TTL });
  maintainAccessCache();
  return result;
}

/**
 * Check direct document share access for a user.
 */
function checkDocSharedAccess(
  db: Database.Database,
  docId: string,
  userId: string
): "editor" | "viewer" | false {
  const row = db.prepare(
    `SELECT ds.permission FROM document_shares ds
     WHERE ds.document_id = ? AND ds.status = 'accepted'
       AND (ds.user_id = ? OR ds.group_id IN (
         SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'
       ))
     ORDER BY CASE ds.permission WHEN 'editor' THEN 0 ELSE 1 END
     LIMIT 1`
  ).get(docId, userId, userId) as { permission: string } | undefined;

  return row ? (row.permission as "editor" | "viewer") : false;
}

/**
 * Authenticate a WebSocket connection.
 *
 * Checks (in order):
 * 1. Share token via ?token= query param (edit_token → write, public_token → read)
 * 2. Session cookie → workspace membership, shared folder/document access, or admin
 *
 * Returns:
 * - { access: "write" | "read", userId: string | null } if authorized
 * - false if not authorized
 */
export function authenticateWs(
  db: Database.Database,
  req: http.IncomingMessage,
  docId: string
): AuthResult | false {
  const token = new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? undefined;

  // Prepare statements for auth checks
  const stmtGetDocMeta = db.prepare(
    `SELECT workspace_id, visibility, public_token, edit_token, folder_id, share_expires_at, share_password_hash
     FROM documents WHERE id = ?`
  );

  const stmtGetSession = db.prepare(
    `SELECT u.id as user_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > unixepoch()`
  );

  const stmtGetMembership = db.prepare(
    `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?`
  );

  const stmtIsAdmin = db.prepare(`SELECT is_admin FROM users WHERE id = ?`);

  const docMeta = stmtGetDocMeta.get(docId) as {
    workspace_id: string;
    visibility: string;
    public_token: string | null;
    edit_token: string | null;
    folder_id: string | null;
    share_expires_at: number | null;
    share_password_hash: string | null;
  } | undefined;

  if (!docMeta) return false;

  // 1. Token-based access (share pages)
  if (token) {
    // Check if token matches and share is not expired
    const isExpired = docMeta.share_expires_at && docMeta.share_expires_at < Date.now() / 1000;
    if (isExpired) return false;

    // Check for password protection
    if (docMeta.share_password_hash) {
      // Need to verify password via cookie
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = parseCookies(cookieHeader);
      if (cookies[`__share_pwd_${token}`] !== "1") return false;
    }

    if (docMeta.edit_token && docMeta.edit_token === token) return { access: "write", userId: "guest" };
    if (docMeta.public_token && docMeta.public_token === token) return { access: "read", userId: null };
  }

  // 2. Cookie-based session auth
  const cookieHeader = req.headers.cookie ?? "";
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies["__session"];
  if (!sessionId) return false;

  const session = stmtGetSession.get(sessionId) as { user_id: string } | undefined;
  if (!session) return false;

  const userId = session.user_id;

  // Admin gets full write access
  const adminRow = stmtIsAdmin.get(userId) as { is_admin: number } | undefined;
  if (adminRow?.is_admin) return { access: "write", userId };

  // Workspace member — viewer gets read, others get write
  const membership = stmtGetMembership.get(docMeta.workspace_id, userId) as { role: string } | undefined;
  if (membership) return { access: membership.role === "viewer" ? "read" : "write", userId };

  // Shared folder access — respect permission level
  const folderPerm = checkSharedAccess(db, docMeta.folder_id, userId);
  if (folderPerm) return { access: folderPerm === "editor" ? "write" : "read", userId };

  // Direct document share access — respect permission level
  const docPerm = checkDocSharedAccess(db, docId, userId);
  if (docPerm) return { access: docPerm === "editor" ? "write" : "read", userId };

  return false;
}
