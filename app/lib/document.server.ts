import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { hash, verify } from "@node-rs/argon2";
import { db, prep } from "./db.server";
import { getDocumentType } from "./templates";

export type Document = {
  id: string;
  workspace_id: string;
  created_by: string;
  updated_by: string | null;
  title: string;
  content: string;
  visibility: "private" | "public_view" | "public_edit";
  public_token: string | null;
  edit_token: string | null;
  folder_id: string | null;
  pdf_file: string | null;
  created_at: number;
  updated_at: number;
  share_expires_at: number | null;
  share_password_hash: string | null;
};

export type DocumentSummary = Pick<
  Document,
  "id" | "title" | "visibility" | "created_by" | "created_at" | "updated_at" | "folder_id" | "public_token" | "edit_token" | "pdf_file" | "share_expires_at" | "share_password_hash"
> & {
  /** "spreadsheet" | "presentation" | null — derived from the first ~200 chars of content. */
  doc_type?: string | null;
};

// ─── Create ───────────────────────────────────────────────

export function createDocument(
  workspaceId: string,
  userId: string,
  title = "Untitled",
  folderId?: string | null,
  content?: string
): Document {
  const id = nanoid(12);
  if (content !== undefined) {
    db.prepare(
      `INSERT INTO documents (id, workspace_id, created_by, title, folder_id, content)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, userId, title, folderId ?? null, content);
  } else {
    db.prepare(
      `INSERT INTO documents (id, workspace_id, created_by, title, folder_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, workspaceId, userId, title, folderId ?? null);
  }

  return getDocument(id)!;
}

export function createPdfDocument(
  workspaceId: string,
  userId: string,
  title: string,
  pdfFile: string,
  folderId?: string | null,
): Document {
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO documents (id, workspace_id, created_by, title, content, pdf_file, folder_id)
     VALUES (?, ?, ?, ?, '', ?, ?)`
  ).run(id, workspaceId, userId, title, pdfFile, folderId ?? null);
  return getDocument(id)!;
}

// ─── Read ─────────────────────────────────────────────────

export function getDocument(id: string): Document | null {
  return (
    prep<Document, [string]>(
        `SELECT id, workspace_id, created_by, updated_by, title, content,
                visibility, public_token, edit_token, folder_id, pdf_file, created_at, updated_at,
                share_expires_at, share_password_hash
         FROM documents WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) ?? null
  );
}

export function getDocumentsByIds(ids: string[]): Document[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return prep<Document, string[]>(
      `SELECT id, workspace_id, created_by, updated_by, title, content,
              visibility, public_token, edit_token, folder_id, pdf_file, created_at, updated_at,
              share_expires_at, share_password_hash
       FROM documents WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    )
    .all(...ids);
}

/** Like getDocument but includes trashed items — for restore/purge operations. */
export function getDocumentIncludingTrashed(id: string): Document | null {
  return (
    prep<Document, [string]>(
        `SELECT id, workspace_id, created_by, updated_by, title, content,
                visibility, public_token, edit_token, folder_id, pdf_file, created_at, updated_at,
                share_expires_at, share_password_hash
         FROM documents WHERE id = ?`
      )
      .get(id) ?? null
  );
}

export function getWorkspaceDocuments(
  workspaceId: string,
  folderId?: string | null,
  limit = 5000
): DocumentSummary[] {
  if (folderId === undefined) {
    return prep<DocumentSummary, [string, number]>(
        `SELECT id, title, visibility, created_by, created_at, updated_at, folder_id, public_token, edit_token, pdf_file, share_expires_at, share_password_hash
         FROM documents
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(workspaceId, limit);
  }
  if (folderId === null) {
    // Root-level documents (no folder)
    return prep<DocumentSummary, [string]>(
        `SELECT id, title, visibility, created_by, created_at, updated_at, folder_id, public_token, edit_token, pdf_file, share_expires_at, share_password_hash
         FROM documents
         WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL
         ORDER BY updated_at DESC`
      )
      .all(workspaceId);
  }
  return prep<DocumentSummary, [string, string]>(
      `SELECT id, title, visibility, created_by, created_at, updated_at, folder_id, public_token, edit_token, pdf_file, share_expires_at, share_password_hash
       FROM documents
       WHERE workspace_id = ? AND folder_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all(workspaceId, folderId);
}

export type DocumentPage = {
  documents: DocumentSummary[];
  total: number;
};

export function getWorkspaceDocumentsPage(
  workspaceId: string,
  folderId: string | null | undefined,
  limit: number,
  offset: number,
  userId?: string
): DocumentPage {
  // When userId is provided, LEFT JOIN user_stars so starred docs sort first.
  const starJoin = userId
    ? `LEFT JOIN user_stars s ON s.document_id = d.id AND s.user_id = ?`
    : "";
  const starOrder = userId ? `CASE WHEN s.document_id IS NULL THEN 1 ELSE 0 END,` : "";
  // Pull a short content prefix so we can detect frontmatter type (spreadsheet /
  // presentation) without fetching the full document body.
  const cols = `d.id, d.title, d.visibility, d.created_by, d.created_at, d.updated_at, d.folder_id, d.public_token, d.edit_token, d.pdf_file, d.share_expires_at, d.share_password_hash, substr(d.content, 1, 200) AS content_head`;

  let countSql: string;
  let docsSql: string;
  let params: unknown[];

  if (folderId === undefined) {
    countSql = `SELECT COUNT(*) as cnt FROM documents WHERE workspace_id = ? AND deleted_at IS NULL`;
    docsSql = `SELECT ${cols}
               FROM documents d
               ${starJoin}
               WHERE d.workspace_id = ? AND d.deleted_at IS NULL
               ORDER BY ${starOrder} d.updated_at DESC
               LIMIT ? OFFSET ?`;
    params = userId ? [userId, workspaceId, limit, offset] : [workspaceId, limit, offset];
  } else if (folderId === null) {
    countSql = `SELECT COUNT(*) as cnt FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL`;
    docsSql = `SELECT ${cols}
               FROM documents d
               ${starJoin}
               WHERE d.workspace_id = ? AND d.folder_id IS NULL AND d.deleted_at IS NULL
               ORDER BY ${starOrder} d.updated_at DESC
               LIMIT ? OFFSET ?`;
    params = userId ? [userId, workspaceId, limit, offset] : [workspaceId, limit, offset];
  } else {
    countSql = `SELECT COUNT(*) as cnt FROM documents WHERE workspace_id = ? AND folder_id = ? AND deleted_at IS NULL`;
    docsSql = `SELECT ${cols}
               FROM documents d
               ${starJoin}
               WHERE d.workspace_id = ? AND d.folder_id = ? AND d.deleted_at IS NULL
               ORDER BY ${starOrder} d.updated_at DESC
               LIMIT ? OFFSET ?`;
    params = userId ? [userId, workspaceId, folderId, limit, offset] : [workspaceId, folderId, limit, offset];
  }

  const countParams = folderId === undefined ? [workspaceId] : folderId === null ? [workspaceId] : [workspaceId, folderId];
  const countResult = prep<{ cnt: number }>(countSql).get(...countParams);
  const total = countResult?.cnt ?? 0;

  type Row = DocumentSummary & { content_head?: string | null };
  const rows = prep<Row>(docsSql).all(...params) as Row[];
  const documents: DocumentSummary[] = rows.map(({ content_head, ...rest }) => ({
    ...rest,
    doc_type: content_head ? getDocumentType(content_head) : null,
  }));

  return { documents, total };
}

/**
 * Get the N most recently modified documents within a folder tree (folder + all descendants).
 * Uses a recursive CTE to traverse subfolders.
 */
export function getRecentDocsInFolderTree(
  folderId: string,
  limit = 5
): DocumentSummary[] {
  return prep<DocumentSummary, [string, number]>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
       )
       SELECT d.id, d.title, d.visibility, d.created_by, d.created_at, d.updated_at, d.folder_id, d.public_token, d.edit_token, d.pdf_file, d.share_expires_at, d.share_password_hash
       FROM documents d
       WHERE d.folder_id IN (SELECT id FROM tree) AND d.deleted_at IS NULL
       ORDER BY d.updated_at DESC
       LIMIT ?`
    )
    .all(folderId, limit);
}

/**
 * Get the N most recently modified documents across an entire workspace.
 */
export function getRecentDocsInWorkspace(
  workspaceId: string,
  limit = 5
): DocumentSummary[] {
  return prep<DocumentSummary, [string, number]>(
      `SELECT id, title, visibility, created_by, created_at, updated_at, folder_id, public_token, edit_token, pdf_file, share_expires_at, share_password_hash
       FROM documents
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit);
}

// ─── Storage ──────────────────────────────────────────────

/** Returns total storage in bytes for all documents in a workspace (content + yjs_state). */
export function getWorkspaceStorageBytes(workspaceId: string): number {
  const row = prep<{ total: number }, [string]>(
      `SELECT COALESCE(SUM(LENGTH(content)) + SUM(LENGTH(yjs_state)), 0) as total
       FROM documents WHERE workspace_id = ?`
    )
    .get(workspaceId);
  return row?.total ?? 0;
}

// ─── Update ───────────────────────────────────────────────

export function updateDocument(
  id: string,
  fields: { title?: string; content?: string },
  userId?: string
): void {
  const parts: string[] = [];
  const values: unknown[] = [];

  if (fields.title !== undefined) {
    parts.push("title = ?");
    values.push(fields.title);
  }
  if (fields.content !== undefined) {
    parts.push("content = ?");
    values.push(fields.content);
  }

  if (parts.length === 0) return;
  parts.push("updated_at = unixepoch()");
  if (userId) {
    parts.push("updated_by = ?");
    values.push(userId);
  }
  values.push(id);

  db.prepare(
    `UPDATE documents SET ${parts.join(", ")} WHERE id = ?`
  ).run(...values);
}

// ─── Trash (soft-delete) ─────────────────────────────────

export function trashDocument(id: string, userId: string): void {
  db.prepare(
    "UPDATE documents SET deleted_at = unixepoch(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL"
  ).run(userId, id);
}

export function restoreDocument(id: string): void {
  // If parent folder was permanently deleted (no longer exists), move to workspace root
  const doc = prep<{ folder_id: string | null }, [string]>(
    "SELECT folder_id FROM documents WHERE id = ?"
  ).get(id);
  if (doc?.folder_id) {
    const folderExists = prep<{ id: string }, [string]>(
      "SELECT id FROM folders WHERE id = ?"
    ).get(doc.folder_id);
    if (!folderExists) {
      db.prepare("UPDATE documents SET folder_id = NULL WHERE id = ?").run(id);
    }
  }
  db.prepare(
    "UPDATE documents SET deleted_at = NULL, deleted_by = NULL WHERE id = ?"
  ).run(id);
}

export function permanentlyDeleteDocument(id: string): void {
  const doc = prep<{ pdf_file: string | null }, [string]>(
    "SELECT pdf_file FROM documents WHERE id = ?"
  ).get(id);
  if (doc?.pdf_file) {
    try { unlinkSync(join(process.cwd(), "uploads", doc.pdf_file)); } catch { /* file may not exist */ }
  }
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

// Keep legacy name as alias
export const deleteDocument = permanentlyDeleteDocument;

export type TrashedDocument = {
  id: string;
  title: string;
  folder_name: string | null;
  folder_id: string | null;
  deleted_at: number;
  deleted_by: string;
};

export function getTrashedDocumentsForWorkspace(userId: string, workspaceId: string): TrashedDocument[] {
  return prep<TrashedDocument, [string, string]>(
      `SELECT d.id, d.title, f.name AS folder_name, d.folder_id, d.deleted_at, d.deleted_by
       FROM documents d
       LEFT JOIN folders f ON f.id = d.folder_id
       WHERE d.deleted_by = ? AND d.deleted_at IS NOT NULL AND d.workspace_id = ?
         AND (d.folder_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = d.folder_id AND p.deleted_at IS NOT NULL))
       ORDER BY d.deleted_at DESC`
    )
    .all(userId, workspaceId);
}

export function getTrashedDocuments(userId: string): TrashedDocument[] {
  return prep<TrashedDocument, [string]>(
      `SELECT d.id, d.title, f.name AS folder_name, d.folder_id, d.deleted_at, d.deleted_by
       FROM documents d
       LEFT JOIN folders f ON f.id = d.folder_id
       WHERE d.deleted_by = ? AND d.deleted_at IS NOT NULL
         AND (d.folder_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = d.folder_id AND p.deleted_at IS NOT NULL))
       ORDER BY d.deleted_at DESC`
    )
    .all(userId);
}

export function purgeExpiredTrash(): void {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  // Clean up PDF files before deleting documents
  const pdfDocs = prep<{ pdf_file: string }, [number]>(
    "SELECT pdf_file FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ? AND pdf_file IS NOT NULL"
  ).all(cutoff);
  for (const doc of pdfDocs) {
    try { unlinkSync(join(process.cwd(), "uploads", doc.pdf_file)); } catch { /* file may not exist */ }
  }
  db.prepare("DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
  db.prepare("DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
}

export function moveDocument(docId: string, folderId: string | null): void {
  db.prepare(
    "UPDATE documents SET folder_id = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(folderId, docId);
}

export function moveDocumentToWorkspace(
  docId: string,
  targetWorkspaceId: string,
  targetFolderId: string | null,
): void {
  db.prepare(
    "UPDATE documents SET workspace_id = ?, folder_id = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(targetWorkspaceId, targetFolderId, docId);
}

// ─── Public sharing ───────────────────────────────────────

export interface ShareOptions {
  expiresAt?: number | null;
  password?: string | null;
}

/** Enable or disable the view-only share link. Returns the token (or null when disabled). */
export async function setViewShare(id: string, enabled: boolean, options?: ShareOptions): Promise<string | null> {
  if (!enabled) {
    db.prepare(
      "UPDATE documents SET public_token = NULL, share_expires_at = NULL, share_password_hash = NULL, updated_at = unixepoch() WHERE id = ?"
    ).run(id);
    return null;
  }
  const existing = prep<{ public_token: string | null }, [string]>(
      "SELECT public_token FROM documents WHERE id = ?"
    )
    .get(id);
  const token = existing?.public_token ?? nanoid(20);

  // Hash password if provided
  let passwordHash: string | null = null;
  if (options?.password) {
    passwordHash = await hash(options.password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  }

  db.prepare(
    "UPDATE documents SET public_token = ?, share_expires_at = ?, share_password_hash = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(token, options?.expiresAt ?? null, passwordHash, id);
  return token;
}

/** Enable or disable the edit share link. Returns the token (or null when disabled). */
export async function setEditShare(id: string, enabled: boolean, options?: ShareOptions): Promise<string | null> {
  if (!enabled) {
    db.prepare(
      "UPDATE documents SET edit_token = NULL, share_expires_at = NULL, share_password_hash = NULL, updated_at = unixepoch() WHERE id = ?"
    ).run(id);
    return null;
  }
  const existing = prep<{ edit_token: string | null }, [string]>(
      "SELECT edit_token FROM documents WHERE id = ?"
    )
    .get(id);
  const token = existing?.edit_token ?? nanoid(20);

  // Hash password if provided
  let passwordHash: string | null = null;
  if (options?.password) {
    passwordHash = await hash(options.password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  }

  db.prepare(
    "UPDATE documents SET edit_token = ?, share_expires_at = ?, share_password_hash = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(token, options?.expiresAt ?? null, passwordHash, id);
  return token;
}

/** Remove all share links (view + edit) from a document. */
export function unshareDocument(id: string): void {
  db.prepare(
    "UPDATE documents SET public_token = NULL, edit_token = NULL, share_expires_at = NULL, share_password_hash = NULL, updated_at = unixepoch() WHERE id = ?"
  ).run(id);
}

/** Update share settings (expiration and/or password) for an existing share. */
export async function updateShareSettings(id: string, options: ShareOptions): Promise<void> {
  let passwordHash: string | null | undefined;
  if (options.password !== undefined) {
    if (options.password === null) {
      passwordHash = null;
    } else {
      passwordHash = await hash(options.password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    }
  }

  if (options.expiresAt !== undefined && passwordHash !== undefined) {
    db.prepare(
      "UPDATE documents SET share_expires_at = ?, share_password_hash = ?, updated_at = unixepoch() WHERE id = ?"
    ).run(options.expiresAt, passwordHash, id);
  } else if (options.expiresAt !== undefined) {
    db.prepare(
      "UPDATE documents SET share_expires_at = ?, updated_at = unixepoch() WHERE id = ?"
    ).run(options.expiresAt, id);
  } else if (passwordHash !== undefined) {
    db.prepare(
      "UPDATE documents SET share_password_hash = ?, updated_at = unixepoch() WHERE id = ?"
    ).run(passwordHash, id);
  }
}

/** Verify a share password for a document. */
export async function verifySharePassword(docId: string, password: string): Promise<boolean> {
  const doc = prep<{ share_password_hash: string | null }, [string]>(
      "SELECT share_password_hash FROM documents WHERE id = ?"
    )
    .get(docId);
  if (!doc?.share_password_hash) return false;
  return await verify(doc.share_password_hash, password);
}

// ─── Versions ────────────────────────────────────────────

export type DocumentVersion = {
  id: string;
  document_id: string;
  title: string;
  content: string;
  created_by: string | null;
  creator_name: string | null;
  auto: number;
  created_at: number;
};

export type DocumentVersionSummary = Omit<DocumentVersion, "content"> & {
  content_size: number;
};

export function createDocumentVersion(
  docId: string,
  userId: string | null,
  auto: boolean
): string {
  const id = nanoid(16);
  db.prepare(
    `INSERT INTO document_versions (id, document_id, title, content, created_by, auto)
     SELECT ?, id, title, content, ?, ? FROM documents WHERE id = ?`
  ).run(id, userId, auto ? 1 : 0, docId);
  return id;
}

export function getDocumentVersions(docId: string): DocumentVersionSummary[] {
  return prep<DocumentVersionSummary, [string]>(
      `SELECT v.id, v.document_id, v.title, v.created_by, v.auto, v.created_at,
              u.name as creator_name, length(v.content) as content_size
       FROM document_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.document_id = ?
       ORDER BY v.created_at DESC`
    )
    .all(docId);
}

export function getDocumentVersion(versionId: string): DocumentVersion | null {
  return (
    prep<DocumentVersion, [string]>(
        `SELECT v.id, v.document_id, v.title, v.content, v.created_by, v.auto, v.created_at,
                u.name as creator_name
         FROM document_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.id = ?`
      )
      .get(versionId) ?? null
  );
}

/**
 * Restore a past version over the current document.
 *
 * Snapshots the *current* content into a new auto-version first, so the
 * restore is reversible — the returned `backupVersionId` can be fed back
 * into this function to undo the restore. Returns `null` if the target
 * version does not exist.
 */
export async function restoreDocumentVersion(
  docId: string,
  versionId: string,
  userId: string | null,
): Promise<{ backupVersionId: string } | null> {
  const version = prep<{ title: string; content: string }, [string, string]>(
      "SELECT title, content FROM document_versions WHERE id = ? AND document_id = ?"
    )
    .get(versionId, docId);

  if (!version) return null;

  // Auto-version of the current content BEFORE we overwrite it — that's the
  // undo target. Always flagged `auto = true` so it doesn't clutter the
  // manual-versions view.
  const backupVersionId = createDocumentVersion(docId, userId, true);

  db.prepare(
    `UPDATE documents SET title = ?, content = ?, yjs_state = NULL, updated_at = unixepoch() WHERE id = ?`
  ).run(version.title, version.content, docId);

  // Notify ws-server to reset the room — await so the room is destroyed
  // before the client reloads and reconnects
  const wsPort = process.env.WS_PORT ?? "4001";
  try {
    await fetch(`http://localhost:${wsPort}/reset/${docId}`, { method: "POST", signal: AbortSignal.timeout(5000) });
  } catch {
    // ws-server may not be running; restore still succeeded in DB
  }

  return { backupVersionId };
}

// ─── Full-text search ────────────────────────────────────

export type SearchResult = {
  id: string;
  title: string;
  snippet: string;
  workspace_id: string;
  workspace_name: string;
  workspace_type: string;
};

export function searchDocuments(userId: string, query: string): SearchResult[] {
  if (!query.trim()) return [];
  // Append * for prefix matching
  const ftsQuery = query.trim().split(/\s+/).map(w => `"${w}"*`).join(" ");
  return prep<SearchResult, [string, string, string, string, string, string]>(
      `SELECT d.id, d.title,
              snippet(documents_fts, 1, '<mark>', '</mark>', '…', 40) AS snippet,
              w.id AS workspace_id,
              w.name AS workspace_name,
              w.type AS workspace_type
       FROM documents_fts fts
       JOIN documents d ON d.rowid = fts.rowid
       JOIN workspaces w ON w.id = d.workspace_id
       WHERE documents_fts MATCH ?
         AND d.deleted_at IS NULL
         AND (
           EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = d.workspace_id AND wm.user_id = ?)
           OR EXISTS (SELECT 1 FROM folder_shares fs
                      JOIN group_members gm ON gm.group_id = fs.group_id AND gm.user_id = ? AND gm.status = 'accepted'
                      WHERE fs.folder_id = d.folder_id AND fs.status = 'accepted')
           OR EXISTS (SELECT 1 FROM folder_shares fs WHERE fs.folder_id = d.folder_id AND fs.user_id = ? AND fs.status = 'accepted')
           OR EXISTS (SELECT 1 FROM document_shares ds WHERE ds.document_id = d.id AND ds.user_id = ? AND ds.status = 'accepted')
           OR EXISTS (SELECT 1 FROM document_shares ds
                      JOIN group_members gm ON gm.group_id = ds.group_id AND gm.user_id = ? AND gm.status = 'accepted'
                      WHERE ds.document_id = d.id)
         )
       ORDER BY rank
       LIMIT 20`
    )
    .all(ftsQuery, userId, userId, userId, userId, userId);
}

// ─── Starred documents ──────────────────────────────────

/**
 * Get all accepted group member user IDs that have access to a document
 * via folder shares on the document's folder ancestor chain.
 * Returns empty set if the document has no folder or no group shares.
 */
export function getGroupMemberIdsForDoc(docId: string): Set<string> {
  const doc = prep<{ folder_id: string | null }, [string]>(
      "SELECT folder_id FROM documents WHERE id = ?"
    )
    .get(docId);
  if (!doc?.folder_id) return new Set();

  // Walk ancestor chain
  const ancestors = prep<{ id: string }, [string]>(
      `WITH RECURSIVE chain(id, parent_id) AS (
         SELECT id, parent_id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id
       )
       SELECT id FROM chain`
    )
    .all(doc.folder_id)
    .map((r) => r.id);

  if (ancestors.length === 0) return new Set();

  // Find all accepted group members from folder shares on any ancestor
  const placeholders = ancestors.map(() => "?").join(",");
  const rows = prep<{ user_id: string }>(
      `SELECT DISTINCT gm.user_id
       FROM folder_shares fs
       JOIN group_members gm ON gm.group_id = fs.group_id AND gm.status = 'accepted'
       WHERE fs.folder_id IN (${placeholders})
         AND fs.status = 'accepted'
         AND fs.group_id IS NOT NULL`
    )
    .all(...ancestors);

  return new Set(rows.map((r) => r.user_id));
}

export function toggleStar(userId: string, docId: string): boolean {
  const existing = prep<{ user_id: string }, [string, string]>(
      "SELECT user_id FROM user_stars WHERE user_id = ? AND document_id = ?"
    )
    .get(userId, docId);

  const groupMemberIds = getGroupMemberIdsForDoc(docId);

  if (groupMemberIds.size > 0) {
    // Group-wide toggle: apply to all group members
    const targetIds = Array.from(groupMemberIds);
    const tx = db.transaction(() => {
      if (existing) {
        const placeholders = targetIds.map(() => "?").join(",");
        db.prepare(
          `DELETE FROM user_stars WHERE document_id = ? AND user_id IN (${placeholders})`
        ).run(docId, ...targetIds);
        return false;
      }
      const insert = db.prepare(
        "INSERT OR IGNORE INTO user_stars (user_id, document_id) VALUES (?, ?)"
      );
      for (const uid of targetIds) {
        insert.run(uid, docId);
      }
      return true;
    });
    return tx();
  }

  // Per-user toggle (no group sharing)
  if (existing) {
    db.prepare("DELETE FROM user_stars WHERE user_id = ? AND document_id = ?").run(userId, docId);
    return false;
  }
  db.prepare("INSERT INTO user_stars (user_id, document_id) VALUES (?, ?)").run(userId, docId);
  return true;
}

export function isStarred(userId: string, docId: string): boolean {
  return !!prep<{ user_id: string }, [string, string]>(
      "SELECT user_id FROM user_stars WHERE user_id = ? AND document_id = ?"
    )
    .get(userId, docId);
}

export type StarredDoc = {
  id: string;
  title: string;
  workspace_name: string;
  updated_at: number;
};

export function getStarredDocsForWorkspace(userId: string, workspaceId: string): StarredDoc[] {
  return prep<StarredDoc, [string, string]>(
      `SELECT d.id, d.title, w.name AS workspace_name, d.updated_at
       FROM user_stars s
       JOIN documents d ON d.id = s.document_id
       JOIN workspaces w ON w.id = d.workspace_id
       WHERE s.user_id = ? AND d.deleted_at IS NULL AND d.workspace_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(userId, workspaceId);
}

export function getStarredDocs(userId: string): StarredDoc[] {
  return prep<StarredDoc, [string]>(
      `SELECT d.id, d.title, w.name AS workspace_name, d.updated_at
       FROM user_stars s
       JOIN documents d ON d.id = s.document_id
       JOIN workspaces w ON w.id = d.workspace_id
       WHERE s.user_id = ? AND d.deleted_at IS NULL
       ORDER BY s.created_at DESC`
    )
    .all(userId);
}

// ─── Recent documents ───────────────────────────────────

export function recordRecentDoc(userId: string, docId: string): void {
  db.prepare(
    `INSERT INTO user_recent_docs (user_id, document_id, viewed_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(user_id, document_id) DO UPDATE SET viewed_at = unixepoch()`
  ).run(userId, docId);
}

export type RecentDoc = {
  id: string;
  title: string;
  workspace_name: string;
  viewed_at: number;
};

export function getRecentDocs(userId: string, limit = 10): RecentDoc[] {
  return prep<RecentDoc, [string, number]>(
      `SELECT d.id, d.title, w.name AS workspace_name, r.viewed_at
       FROM user_recent_docs r
       JOIN documents d ON d.id = r.document_id
       JOIN workspaces w ON w.id = d.workspace_id
       WHERE r.user_id = ? AND d.deleted_at IS NULL
       ORDER BY r.viewed_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

export type RecentlyModifiedDoc = {
  id: string;
  title: string;
  updated_at: number;
  modifier_name: string | null;
  folder_name: string | null;
};

export function getRecentlyModifiedDocs(workspaceId: string, limit = 20): RecentlyModifiedDoc[] {
  return prep<RecentlyModifiedDoc, [string, number]>(
      `SELECT d.id, d.title, d.updated_at,
              u.name AS modifier_name,
              f.name AS folder_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.updated_by
       LEFT JOIN folders f ON f.id = d.folder_id
       WHERE d.workspace_id = ? AND d.deleted_at IS NULL
       ORDER BY d.updated_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit);
}

/** Look up a document by its public share token (view or edit), or by a per-invite external token. */
export function getDocumentByToken(
  token: string
): { document: Document; mode: "public_view" | "public_edit"; hasPassword: boolean; externalEmail?: string } | null {
  // First check global public/edit tokens
  const doc = prep<Document, [string, string]>(
      `SELECT id, workspace_id, created_by, updated_by, title, content,
              visibility, public_token, edit_token, folder_id, pdf_file, created_at, updated_at,
              share_expires_at, share_password_hash
       FROM documents WHERE (public_token = ? OR edit_token = ?) AND deleted_at IS NULL`
    )
    .get(token, token);
  if (doc) {
    // Check if share is expired
    if (doc.share_expires_at && doc.share_expires_at < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      document: doc,
      mode: doc.edit_token === token ? "public_edit" : "public_view",
      hasPassword: !!doc.share_password_hash,
    };
  }

  // Then check per-invite external share tokens
  const share = prep<{ document_id: string; external_email: string }, [string]>(
      `SELECT document_id, external_email FROM document_shares
       WHERE token = ? AND external_email IS NOT NULL AND status = 'accepted'`
    )
    .get(token);
  if (!share) return null;

  const extDoc = prep<Document, [string]>(
      `SELECT id, workspace_id, created_by, title, content,
              visibility, public_token, edit_token, folder_id, pdf_file, created_at, updated_at,
              share_expires_at, share_password_hash
       FROM documents WHERE id = ? AND deleted_at IS NULL`
    )
    .get(share.document_id);
  if (!extDoc) return null;

  return {
    document: extDoc,
    mode: "public_edit",
    hasPassword: false,
    externalEmail: share.external_email,
  };
}
