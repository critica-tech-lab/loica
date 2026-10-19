/**
 * Authentication and authorization logic for WebSocket connections.
 */

import * as http from "node:http";
import Database from "better-sqlite3";
import { resolveDocAccess } from "../app/lib/doc-permission.server.ts";
import type { AuthResult } from "./types.ts";
import { verifySharePasswordCookie } from "../app/lib/share-password.server.ts";

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
 * Authenticate a WebSocket connection.
 *
 * Checks (in order):
 * 1. Share token via ?token= query param (edit_token → write, public_token → read)
 * 2. Session cookie → admin, workspace membership, or folder/document share
 *    (decided by `resolveDocAccess`)
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
    `SELECT u.id as user_id, u.is_admin as is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > unixepoch()`
  );

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
      // Need to verify password via the signed cookie set by routes/s.$token.tsx
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = parseCookies(cookieHeader);
      if (!verifySharePasswordCookie(db, token, docMeta.share_password_hash, cookies[`__share_pwd_${token}`])) return false;
    }

    if (docMeta.edit_token && docMeta.edit_token === token) return { access: "write", userId: "guest" };
    if (docMeta.public_token && docMeta.public_token === token) return { access: "read", userId: null };
  }

  // 2. Cookie-based session auth
  const cookieHeader = req.headers.cookie ?? "";
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies["__session"];
  if (!sessionId) return false;

  const session = stmtGetSession.get(sessionId) as { user_id: string; is_admin: number } | undefined;
  if (!session) return false;

  const access = resolveDocAccess(
    db,
    { id: docId, workspace_id: docMeta.workspace_id, folder_id: docMeta.folder_id },
    { id: session.user_id, is_admin: session.is_admin }
  );
  if (!access) return false;

  return { access: access.level, userId: session.user_id };
}
