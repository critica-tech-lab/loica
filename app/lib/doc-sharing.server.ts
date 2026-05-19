import { nanoid } from "nanoid";
import { db, prep } from "./db.server";
import { sendDocShareNotification } from "./email.server";
import { createNotification } from "./notification.server";

// ─── Types ───────────────────────────────────────────────

export type DocShare = {
  id: string;
  document_id: string;
  user_id: string;
  permission: string;
  status: string;
  created_by: string;
  created_at: number;
  user_name: string;
  user_email: string;
};

export type PendingDocShare = {
  id: string;
  document_id: string;
  document_title: string;
  workspace_name: string;
  shared_by_name: string;
  created_at: number;
};

export type DocGroupShare = {
  id: string;
  document_id: string;
  group_id: string;
  group_name: string;
  permission: string;
  created_by: string;
  created_at: number;
  member_count: number;
};

export type SharedDocEntry = {
  document_id: string;
  document_title: string;
  workspace_id: string;
  workspace_name: string;
  shared_by_name: string;
  created_at: number;
};

export type ExternalDocShare = {
  id: string;
  document_id: string;
  external_email: string;
  token: string | null;
  created_by: string;
  created_at: number;
};

// ─── Share / Unshare ─────────────────────────────────────

export function shareDocWithUser(
  docId: string,
  userId: string,
  createdBy: string,
  siteUrl?: string
): string {
  // Check if the doc belongs to a team workspace and the target user is already a member
  const docWorkspace = prep<{ workspace_id: string; type: string }, [string]>(
      `SELECT d.workspace_id, w.type
       FROM documents d JOIN workspaces w ON w.id = d.workspace_id
       WHERE d.id = ?`
    )
    .get(docId);

  if (docWorkspace?.type === "team") {
    const isMember = prep<{ user_id: string }, [string, string]>(
        "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
      )
      .get(docWorkspace.workspace_id, userId);

    if (isMember) {
      // User already has access via teamspace — just send a notification email
      // with a direct link (no share record, no accept step)
      const targetUser = prep<{ email: string; name: string }, [string]>(
          "SELECT email, name FROM users WHERE id = ?"
        )
        .get(userId);
      const doc = prep<{ title: string }, [string]>(
          "SELECT title FROM documents WHERE id = ?"
        )
        .get(docId);
      const sharer = prep<{ name: string }, [string]>(
          "SELECT name FROM users WHERE id = ?"
        )
        .get(createdBy);
      if (targetUser && doc && sharer) {
        sendDocShareNotification(
          targetUser.email,
          targetUser.name,
          doc.title,
          sharer.name,
          docId,
          siteUrl,
          true // direct link — user already has access
        );
        // Create in-app notification
        createNotification(
          userId,
          "doc_shared",
          "Document shared with you",
          `${sharer.name} shared "${doc.title}" with you`,
          `/shared/doc/${docId}`
        );
      }
      return ""; // no share record created
    }
  }

  const id = nanoid(12);
  db.prepare(
    `INSERT OR REPLACE INTO document_shares (id, document_id, user_id, permission, status, created_by)
     VALUES (?, ?, ?, 'editor', 'pending', ?)`
  ).run(id, docId, userId, createdBy);

  // Send email notification
  const targetUser = prep<{ email: string; name: string }, [string]>(
      "SELECT email, name FROM users WHERE id = ?"
    )
    .get(userId);
  const doc = prep<{ title: string }, [string]>(
      "SELECT title FROM documents WHERE id = ?"
    )
    .get(docId);
  const sharer = prep<{ name: string }, [string]>(
      "SELECT name FROM users WHERE id = ?"
    )
    .get(createdBy);
  if (targetUser && doc && sharer) {
    sendDocShareNotification(
      targetUser.email,
      targetUser.name,
      doc.title,
      sharer.name,
      docId,
      siteUrl
    );
    // Create in-app notification
    createNotification(
      userId,
      "doc_shared",
      "Document shared with you",
      `${sharer.name} shared "${doc.title}" with you`,
      `/shared/doc/${docId}`
    );
  }

  return id;
}

export function unshareDoc(shareId: string, workspaceId?: string): void {
  if (workspaceId) {
    db.prepare(
      `DELETE FROM document_shares WHERE id = ? AND document_id IN (
        SELECT id FROM documents WHERE workspace_id = ?
      )`
    ).run(shareId, workspaceId);
  } else {
    db.prepare("DELETE FROM document_shares WHERE id = ?").run(shareId);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function shareDocWithExternal(
  docId: string,
  email: string,
  createdBy: string
): { id: string; token: string } {
  if (!EMAIL_RE.test(email)) {
    throw new Error(`Invalid external share email: ${email}`);
  }
  // Check if already shared with this email
  const existing = prep<{ id: string; token: string | null }, [string, string]>(
      "SELECT id, token FROM document_shares WHERE document_id = ? AND external_email = ?"
    )
    .get(docId, email);
  if (existing) return { id: existing.id, token: existing.token ?? "" };

  const id = nanoid(12);
  const token = nanoid(21);
  db.prepare(
    `INSERT INTO document_shares (id, document_id, user_id, group_id, external_email, token, permission, status, created_by)
     VALUES (?, ?, NULL, NULL, ?, ?, 'editor', 'accepted', ?)`
  ).run(id, docId, email, token, createdBy);
  return { id, token };
}

export function getExternalDocShares(docId: string): ExternalDocShare[] {
  return prep<ExternalDocShare, [string]>(
      `SELECT id, document_id, external_email, token, created_by, created_at
       FROM document_shares
       WHERE document_id = ? AND external_email IS NOT NULL
       ORDER BY created_at ASC`
    )
    .all(docId);
}

/** Look up a document via a per-invite external share token. */
export function getDocumentByExternalToken(
  token: string
): { documentId: string; email: string } | null {
  const row = prep<{ document_id: string; external_email: string }, [string]>(
      `SELECT document_id, external_email FROM document_shares
       WHERE token = ? AND external_email IS NOT NULL AND status = 'accepted'`
    )
    .get(token);
  return row ? { documentId: row.document_id, email: row.external_email } : null;
}

export function shareDocWithGroup(
  docId: string,
  groupId: string,
  createdBy: string,
  siteUrl?: string
): string {
  // Check if already shared with this group
  const existing = prep<{ id: string }, [string, string]>(
      "SELECT id FROM document_shares WHERE document_id = ? AND group_id = ?"
    )
    .get(docId, groupId);
  if (existing) return existing.id;

  const id = nanoid(12);
  db.prepare(
    `INSERT INTO document_shares (id, document_id, user_id, group_id, permission, status, created_by)
     VALUES (?, ?, NULL, ?, 'editor', 'accepted', ?)`
  ).run(id, docId, groupId, createdBy);

  // Notify each accepted group member (except the sharer themselves).
  // Members who are already in the doc's workspace get a direct link.
  const docMeta = prep<{ title: string; workspace_id: string }, [string]>(
      "SELECT title, workspace_id FROM documents WHERE id = ?"
    )
    .get(docId);
  const sharer = prep<{ name: string }, [string]>(
      "SELECT name FROM users WHERE id = ?"
    )
    .get(createdBy);
  if (docMeta && sharer) {
    const members = prep<
        { user_id: string; email: string; name: string; is_member: number },
        [string, string, string]
      >(
        `SELECT u.id AS user_id, u.email, u.name,
                CASE WHEN wm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_member
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN workspace_members wm
           ON wm.user_id = u.id AND wm.workspace_id = ?
         WHERE gm.group_id = ? AND gm.status = 'accepted' AND gm.user_id != ?`
      )
      .all(docMeta.workspace_id, groupId, createdBy);

    for (const m of members) {
      sendDocShareNotification(
        m.email,
        m.name,
        docMeta.title,
        sharer.name,
        docId,
        siteUrl,
        m.is_member === 1
      );
      createNotification(
        m.user_id,
        "doc_shared",
        "Document shared with you",
        `${sharer.name} shared "${docMeta.title}" with you`,
        m.is_member === 1 ? `/w/doc/${docId}` : `/shared/doc/${docId}`
      );
    }
  }

  return id;
}

export function getDocGroupShares(docId: string): DocGroupShare[] {
  return prep<DocGroupShare, [string]>(
      `SELECT ds.id, ds.document_id, ds.group_id, g.name as group_name,
              ds.permission, ds.created_by, ds.created_at,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND status = 'accepted') as member_count
       FROM document_shares ds
       JOIN groups g ON g.id = ds.group_id
       WHERE ds.document_id = ? AND ds.group_id IS NOT NULL
       ORDER BY ds.created_at ASC`
    )
    .all(docId);
}

// ─── Query shares on a document ─────────────────────────

export function getDocShares(docId: string): DocShare[] {
  return prep<DocShare, [string]>(
      `SELECT ds.id, ds.document_id, ds.user_id, ds.permission,
              ds.status, ds.created_by, ds.created_at,
              u.name as user_name, u.email as user_email
       FROM document_shares ds
       JOIN users u ON u.id = ds.user_id
       WHERE ds.document_id = ?
       ORDER BY ds.created_at ASC`
    )
    .all(docId);
}

// ─── Access check ────────────────────────────────────────

export function hasDocSharedAccess(docId: string, userId: string): boolean {
  const row = prep<{ cnt: number }, [string, string, string]>(
      `SELECT COUNT(*) as cnt FROM document_shares ds
       WHERE ds.document_id = ? AND ds.status = 'accepted'
         AND (ds.user_id = ? OR ds.group_id IN (
           SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'
         ))`
    )
    .get(docId, userId, userId);
  return !!row && row.cnt > 0;
}

// ─── Shared docs for a user ─────────────────────────────

export function getSharedDocsForUser(userId: string): SharedDocEntry[] {
  return prep<SharedDocEntry, [string, string]>(
      `SELECT DISTINCT d.id as document_id, d.title as document_title,
              w.id as workspace_id, w.name as workspace_name,
              sharer.name as shared_by_name,
              ds.created_at
       FROM document_shares ds
       JOIN documents d ON d.id = ds.document_id
       JOIN workspaces w ON w.id = d.workspace_id
       JOIN users sharer ON sharer.id = ds.created_by
       WHERE ds.status = 'accepted'
         AND (ds.user_id = ? OR ds.group_id IN (
           SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'
         ))
       ORDER BY d.title ASC`
    )
    .all(userId, userId);
}

// ─── Shared doc IDs in a workspace ──────────────────────

/** Returns a Set of document IDs that have at least one direct share (user, group, or external). */
export function getDirectlySharedDocIds(workspaceId: string): Set<string> {
  const rows = prep<{ document_id: string }, [string]>(
      `SELECT DISTINCT ds.document_id
       FROM document_shares ds
       JOIN documents d ON d.id = ds.document_id
       WHERE d.workspace_id = ?`
    )
    .all(workspaceId);
  return new Set(rows.map((r) => r.document_id));
}

// ─── Pending doc shares ─────────────────────────────────

export function getPendingDocSharesForUser(userId: string): PendingDocShare[] {
  return prep<PendingDocShare, [string]>(
      `SELECT ds.id, ds.document_id,
              d.title as document_title,
              w.name as workspace_name,
              sharer.name as shared_by_name,
              ds.created_at
       FROM document_shares ds
       JOIN documents d ON d.id = ds.document_id
       JOIN workspaces w ON w.id = d.workspace_id
       JOIN users sharer ON sharer.id = ds.created_by
       WHERE ds.user_id = ? AND ds.status = 'pending'
       ORDER BY ds.created_at DESC`
    )
    .all(userId);
}

/** Auto-accept a pending doc share for a user (used when clicking the email link). */
export function acceptPendingDocShare(docId: string, userId: string): boolean {
  const result = db
    .prepare(
      "UPDATE document_shares SET status = 'accepted' WHERE document_id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(docId, userId);
  return result.changes > 0;
}

export function acceptDocShare(shareId: string, userId: string): boolean {
  const result = db
    .prepare(
      "UPDATE document_shares SET status = 'accepted' WHERE id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(shareId, userId);
  return result.changes > 0;
}

export function declineDocShare(shareId: string, userId: string): boolean {
  const result = db
    .prepare(
      "DELETE FROM document_shares WHERE id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(shareId, userId);
  return result.changes > 0;
}
