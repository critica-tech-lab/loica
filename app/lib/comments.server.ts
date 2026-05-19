import { db, prep } from "./db.server";
import { nanoid } from "nanoid";
import { createNotification } from "./notification.server";

// ─── Types ────────────────────────────────────────────────

export interface CommentRow {
  id: string;
  document_id: string;
  thread_id: string | null;
  user_id: string;
  user_name: string;
  body: string;
  anchor_from: string | null;
  anchor_to: string | null;
  anchor_text: string | null;
  resolved: number;
  created_at: number;
  updated_at: number;
}

export interface CommentThread {
  root: CommentRow;
  replies: CommentRow[];
}

// ─── Queries ──────────────────────────────────────────────

const stmtThreadsByDoc = db.prepare(`
  SELECT c.*, u.name as user_name
  FROM comments c
  JOIN users u ON u.id = c.user_id
  WHERE c.document_id = ?
  ORDER BY c.created_at ASC
`);

const stmtInsert = db.prepare(`
  INSERT INTO comments (id, document_id, thread_id, user_id, body, anchor_from, anchor_to, anchor_text)
  VALUES (@id, @documentId, @threadId, @userId, @body, @anchorFrom, @anchorTo, @anchorText)
`);

const stmtUpdate = db.prepare(`
  UPDATE comments SET body = @body, updated_at = unixepoch() WHERE id = @id AND user_id = @userId
`);

const stmtDelete = db.prepare(`DELETE FROM comments WHERE id = ?`);

const stmtResolve = db.prepare(`
  UPDATE comments SET resolved = @resolved, updated_at = unixepoch() WHERE id = @id AND thread_id IS NULL
`);

const stmtGetById = db.prepare(`SELECT * FROM comments WHERE id = ?`);

// ─── CRUD Functions ───────────────────────────────────────

export function getDocumentThreads(docId: string): CommentThread[] {
  const rows = stmtThreadsByDoc.all(docId) as CommentRow[];
  const threadMap = new Map<string, CommentThread>();

  for (const row of rows) {
    if (!row.thread_id) {
      // Root comment
      threadMap.set(row.id, { root: row, replies: [] });
    }
  }

  for (const row of rows) {
    if (row.thread_id) {
      const thread = threadMap.get(row.thread_id);
      if (thread) thread.replies.push(row);
    }
  }

  return Array.from(threadMap.values());
}

export function createComment(opts: {
  documentId: string;
  userId: string;
  body: string;
  threadId?: string | null;
  anchorFrom?: string | null;
  anchorTo?: string | null;
  anchorText?: string | null;
}): string {
  const id = nanoid(16);
  stmtInsert.run({
    id,
    documentId: opts.documentId,
    threadId: opts.threadId ?? null,
    userId: opts.userId,
    body: opts.body,
    anchorFrom: opts.anchorFrom ?? null,
    anchorTo: opts.anchorTo ?? null,
    anchorText: opts.anchorText ?? null,
  });

  // Notify the document owner if someone else commented
  if (!opts.threadId) {
    // Only notify for root comments, not replies
    const doc = prep<{ created_by: string; title: string }, [string]>(
      "SELECT created_by, title FROM documents WHERE id = ?"
    ).get(opts.documentId);

    const commenter = prep<{ name: string }, [string]>(
      "SELECT name FROM users WHERE id = ?"
    ).get(opts.userId);

    if (doc && doc.created_by !== opts.userId && commenter) {
      createNotification(
        doc.created_by,
        "comment_added",
        "New comment on your document",
        `${commenter.name} commented on "${doc.title}"`,
        `/w/doc/${opts.documentId}`
      );
    }
  }

  return id;
}

export function updateComment(commentId: string, userId: string, body: string): boolean {
  const result = stmtUpdate.run({ id: commentId, userId, body });
  return result.changes > 0;
}

export function deleteComment(commentId: string, userId: string): boolean {
  const row = stmtGetById.get(commentId) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return false;
  stmtDelete.run(commentId);
  return true;
}

export function resolveThread(commentId: string): boolean {
  const result = stmtResolve.run({ id: commentId, resolved: 1 });
  return result.changes > 0;
}

export function unresolveThread(commentId: string): boolean {
  const result = stmtResolve.run({ id: commentId, resolved: 0 });
  return result.changes > 0;
}

// ─── Bulk upsert (for ws-server persistence) ─────────────

const stmtUpsert = db.prepare(`
  INSERT INTO comments (id, document_id, thread_id, user_id, body, anchor_from, anchor_to, anchor_text, resolved, created_at, updated_at)
  VALUES (@id, @documentId, @threadId, @userId, @body, @anchorFrom, @anchorTo, @anchorText, @resolved, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    body = excluded.body,
    resolved = excluded.resolved,
    updated_at = excluded.updated_at
`);

const stmtDeleteByDoc = db.prepare(`DELETE FROM comments WHERE document_id = ?`);

export function syncCommentsFromYjs(
  docId: string,
  comments: Array<{
    id: string;
    threadId: string | null;
    userId: string;
    body: string;
    anchorFrom: string | null;
    anchorTo: string | null;
    anchorText: string | null;
    resolved: number;
    createdAt: number;
    updatedAt: number;
  }>
): void {
  const currentIds = new Set(comments.map(c => c.id));

  // Delete comments that no longer exist in Yjs map
  const existing = db.prepare(
    "SELECT id FROM comments WHERE document_id = ?"
  ).all(docId) as { id: string }[];
  for (const row of existing) {
    if (!currentIds.has(row.id)) {
      stmtDelete.run(row.id);
    }
  }

  // Upsert all comments from Yjs map
  for (const c of comments) {
    stmtUpsert.run({
      id: c.id,
      documentId: docId,
      threadId: c.threadId,
      userId: c.userId,
      body: c.body,
      anchorFrom: c.anchorFrom,
      anchorTo: c.anchorTo,
      anchorText: c.anchorText,
      resolved: c.resolved,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
  }
}
