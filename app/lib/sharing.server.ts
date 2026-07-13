import { nanoid } from "nanoid";
import { db, prep } from "./db.server";
import { sendFolderShareNotification } from "./email.server";
import { createNotification } from "./notification.server";
import { getFolderPath, type BreadcrumbSegment } from "./folder.server";

// ─── Types ───────────────────────────────────────────────

export type FolderShare = {
  id: string;
  folder_id: string;
  group_id: string | null;
  user_id: string | null;
  status: string;
  created_by: string;
  created_at: number;
  // Joined fields
  group_name: string | null;
  user_name: string | null;
  user_email: string | null;
};

export type PendingShare = {
  id: string;
  folder_id: string;
  folder_name: string;
  workspace_name: string;
  shared_by_name: string;
  created_at: number;
};

export type SharedFolderEntry = {
  folder_id: string;
  folder_name: string;
  workspace_id: string;
  workspace_name: string;
  shared_via: string; // group name or "direct"
  created_at: number;
};

// ─── Share / Unshare ─────────────────────────────────────

export function shareFolder(
  folderId: string,
  target: { groupId?: string; userId?: string },
  createdBy: string,
  siteUrl?: string
): string {
  if (!target.groupId && !target.userId) {
    throw new Error("Must specify either groupId or userId");
  }
  if (target.groupId && target.userId) {
    throw new Error("Cannot specify both groupId and userId");
  }
  const id = nanoid(12);
  // Group shares auto-accept; user shares start as pending
  const status = target.groupId ? "accepted" : "pending";
  db.prepare(
    `INSERT OR REPLACE INTO folder_shares (id, folder_id, group_id, user_id, permission, created_by, status)
     VALUES (?, ?, ?, ?, 'editor', ?, ?)`
  ).run(id, folderId, target.groupId ?? null, target.userId ?? null, createdBy, status);

  // Send email notification for direct user shares
  if (target.userId) {
    const targetUser = prep<{ email: string; name: string }, [string]>(
        "SELECT email, name FROM users WHERE id = ?"
      )
      .get(target.userId);
    const folder = prep<{ name: string }, [string]>(
        "SELECT name FROM folders WHERE id = ?"
      )
      .get(folderId);
    const sharer = prep<{ name: string }, [string]>(
        "SELECT name FROM users WHERE id = ?"
      )
      .get(createdBy);
    if (targetUser && folder && sharer) {
      sendFolderShareNotification(
        targetUser.email,
        targetUser.name,
        folder.name,
        sharer.name,
        siteUrl
      );
      // Create in-app notification
      createNotification(
        target.userId,
        "folder_shared",
        "Folder shared with you",
        `${sharer.name} shared "${folder.name}" with you`,
        `/shared/folder/${folderId}`
      );
    }
  }

  return id;
}

export function unshareFolder(shareId: string): void {
  db.prepare("DELETE FROM folder_shares WHERE id = ?").run(shareId);
}

/** Remove a specific user's direct share on a folder (user "leaves" the shared folder). */
export function leaveFolderShare(folderId: string, userId: string): void {
  db.prepare(
    "DELETE FROM folder_shares WHERE folder_id = ? AND user_id = ?"
  ).run(folderId, userId);
}

/** Remove ALL shares from a folder (all users and groups). */
export function unshareAllFolder(folderId: string): void {
  db.prepare("DELETE FROM folder_shares WHERE folder_id = ?").run(folderId);
}

// ─── Query shares on a folder ────────────────────────────

export function getFolderShares(folderId: string): FolderShare[] {
  return prep<FolderShare, [string]>(
      `SELECT fs.id, fs.folder_id, fs.group_id, fs.user_id,
              fs.status, fs.created_by, fs.created_at,
              g.name as group_name,
              u.name as user_name, u.email as user_email
       FROM folder_shares fs
       LEFT JOIN groups g ON g.id = fs.group_id
       LEFT JOIN users u ON u.id = fs.user_id
       WHERE fs.folder_id = ?
       ORDER BY fs.created_at ASC`
    )
    .all(folderId);
}

// ─── Shared folders for a user ───────────────────────────

const stmtGetSharedFoldersForUser = prep<SharedFolderEntry, [string, string, string]>(
  `SELECT
     f.id as folder_id, f.name as folder_name,
     w.id as workspace_id, w.name as workspace_name,
     MIN(COALESCE(g.name, 'direct')) as shared_via,
     f.created_at
   FROM folder_shares fs
   JOIN folders f ON f.id = fs.folder_id
   JOIN workspaces w ON w.id = f.workspace_id
   LEFT JOIN groups g ON g.id = fs.group_id
   WHERE fs.status = 'accepted'
     AND (fs.user_id = ?
          OR fs.group_id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'))
     AND w.id NOT IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)
   GROUP BY f.id
   ORDER BY w.name ASC, f.name ASC`
);

export function getSharedFoldersForUser(userId: string): SharedFolderEntry[] {
  return stmtGetSharedFoldersForUser.all(userId, userId, userId);
}

// ─── Access check ────────────────────────────────────────

/**
 * Walk the ancestor chain once and return both access status and the
 * topmost shared folder (the "shared root"). Avoids duplicate recursive
 * CTEs that hasSharedAccess + findSharedRootFolder used to run separately.
 */
export function getSharedAccessInfo(
  folderId: string,
  userId: string
): { hasAccess: boolean; sharedRootId: string | null } {
  // Build ancestor chain (self → root), ordered deepest-first
  const ancestors = prep<{ id: string }, [string]>(
      `WITH RECURSIVE chain(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id, f.parent_id, c.depth + 1
         FROM folders f JOIN chain c ON f.id = c.parent_id
       )
       SELECT id FROM chain ORDER BY depth ASC`
    )
    .all(folderId)
    .map((r) => r.id);

  if (ancestors.length === 0) return { hasAccess: false, sharedRootId: null };

  // Find which ancestors have accepted shares for this user
  const placeholders = ancestors.map(() => "?").join(",");
  const sharedAncestors = new Set(
    prep<{ folder_id: string }>(
        `SELECT DISTINCT fs.folder_id
         FROM folder_shares fs
         WHERE fs.folder_id IN (${placeholders})
           AND fs.status = 'accepted'
           AND (fs.user_id = ? OR fs.group_id IN (
             SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted'
           ))`
      )
      .all(...ancestors, userId, userId)
      .map((r) => r.folder_id)
  );

  if (sharedAncestors.size === 0) return { hasAccess: false, sharedRootId: null };

  // Walk from topmost ancestor (last in array) to find the highest shared one
  let sharedRootId: string | null = null;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (sharedAncestors.has(ancestors[i])) {
      sharedRootId = ancestors[i];
      break;
    }
  }

  return { hasAccess: true, sharedRootId };
}

/** Convenience wrapper — boolean-only check (one ancestor walk). */
export function hasSharedAccess(folderId: string, userId: string): boolean {
  return getSharedAccessInfo(folderId, userId).hasAccess;
}

/** Convenience wrapper — returns the shared root folder ID. */
export function findSharedRootFolder(folderId: string, userId: string): string | null {
  return getSharedAccessInfo(folderId, userId).sharedRootId;
}

/**
 * Breadcrumb trail for a folder, trimmed to the part the user may actually open.
 *
 * A share grants access to one folder and its subtree — never to its parents. The
 * raw path from `getFolderPath()` walks all the way to the workspace root, so
 * rendering it whole hands a shared user links into folders that 403 (and leaks
 * the names of private folders along the way). Starting the trail at the shared
 * root keeps every crumb clickable.
 */
export function getSharedFolderPath(folderId: string, userId: string): BreadcrumbSegment[] {
  const { hasAccess, sharedRootId } = getSharedAccessInfo(folderId, userId);
  if (!hasAccess || !sharedRootId) return [];

  const path = getFolderPath(folderId);
  const rootIndex = path.findIndex((seg) => seg.id === sharedRootId);
  return rootIndex === -1 ? [] : path.slice(rootIndex);
}

// ─── Shared folder IDs in a workspace ────────────────────

export function getSharedFolderIdsInWorkspace(workspaceId: string): Set<string> {
  const rows = prep<{ folder_id: string }, [string]>(
      `SELECT DISTINCT fs.folder_id
       FROM folder_shares fs
       JOIN folders f ON f.id = fs.folder_id
       WHERE f.workspace_id = ? AND fs.status = 'accepted'`
    )
    .all(workspaceId);
  return new Set(rows.map((r) => r.folder_id));
}

// ─── Pending shares ─────────────────────────────────────

export function getPendingSharesForUser(userId: string): PendingShare[] {
  return prep<PendingShare, [string]>(
      `SELECT fs.id, fs.folder_id,
              f.name as folder_name,
              w.name as workspace_name,
              sharer.name as shared_by_name,
              fs.created_at
       FROM folder_shares fs
       JOIN folders f ON f.id = fs.folder_id
       JOIN workspaces w ON w.id = f.workspace_id
       JOIN users sharer ON sharer.id = fs.created_by
       WHERE fs.user_id = ? AND fs.status = 'pending'
       ORDER BY fs.created_at DESC`
    )
    .all(userId);
}

export function getPendingShareCount(userId: string): number {
  const row = prep<{ cnt: number }, [string]>(
      `SELECT COUNT(*) as cnt FROM folder_shares WHERE user_id = ? AND status = 'pending'`
    )
    .get(userId);
  return row?.cnt ?? 0;
}

export function acceptShare(shareId: string, userId: string): boolean {
  const result = db
    .prepare(
      "UPDATE folder_shares SET status = 'accepted' WHERE id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(shareId, userId);
  return result.changes > 0;
}

export function declineShare(shareId: string, userId: string): boolean {
  const result = db
    .prepare(
      "DELETE FROM folder_shares WHERE id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(shareId, userId);
  return result.changes > 0;
}
