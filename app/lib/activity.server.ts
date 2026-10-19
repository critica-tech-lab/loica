import { nanoid } from "nanoid";
// Explicit `.ts` extension (like db.server.ts's own imports): this module is
// imported directly by ws-server.ts, which runs under plain Node — Node ESM
// resolution needs the extension; bundler-only app/lib modules normally omit
// it, but this one can't.
import { db, prep } from "./db.server.ts";

/**
 * Workspace activity log: who did what to which document/folder/member, for
 * teamspace admins and workspace owners to audit. Append-only; `actor_id` is
 * ON DELETE SET NULL (schema) so a deleted user's past actions stay visible
 * instead of vanishing with the row.
 */

// Enum of loggable actions (TEXT in the DB) — kept as a const object rather
// than a TS `enum` so the stored values are predictable, grep-able strings.
export const ActivityAction = {
  DocCreate: "doc.create",
  DocRename: "doc.rename",
  DocMove: "doc.move",
  DocTrash: "doc.trash",
  DocRestore: "doc.restore",
  DocPurge: "doc.purge",
  FolderCreate: "folder.create",
  FolderRename: "folder.rename",
  FolderMove: "folder.move",
  FolderTrash: "folder.trash",
  FolderRestore: "folder.restore",
  FolderPurge: "folder.purge",
  ShareAdd: "share.add",
  ShareRemove: "share.remove",
  MemberAdd: "member.add",
  MemberRemove: "member.remove",
  MemberRole: "member.role",
} as const;

export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];

export type ActivityEntry = {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_title: string | null;
  created_at: number;
};

export type ActivityPage = {
  items: ActivityEntry[];
  nextCursor: string | null;
};

const stmtInsertActivity = db.prepare(
  `INSERT INTO activity (id, workspace_id, actor_id, action, target_type, target_id, target_title)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * Record one workspace mutation. `actorId` may be null for system-initiated actions.
 *
 * Never throws: it runs after the mutation already succeeded, so a failed
 * audit insert (locked DB, full disk) must not turn that success into an
 * error response (e.g. a moved folder reported as a name conflict).
 */
export function logActivity(params: {
  workspaceId: string;
  actorId: string | null;
  action: ActivityAction;
  targetType?: string;
  targetId?: string;
  targetTitle?: string;
}): void {
  try {
    stmtInsertActivity.run(
      nanoid(16),
      params.workspaceId,
      params.actorId,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.targetTitle ?? null
    );
  } catch (e) {
    console.error(`[activity] failed to log ${params.action}:`, e);
  }
}

type ActivityRow = ActivityEntry & { rowid: number };

/**
 * Page through a workspace's activity, newest first. `rowid` (SQLite's
 * implicit integer rowid — stable and monotonic since this table is
 * insert-only) is the cursor, not `created_at`: several rows can share the
 * same second under concurrent edits, which would make a timestamp cursor
 * skip or repeat rows.
 */
export function getActivity(
  workspaceId: string,
  limit = 50,
  cursor?: string | null
): ActivityPage {
  const cursorRowid = cursor ? Number(cursor) : null;
  const rows = prep<ActivityRow, [string, number | null, number | null, number]>(
    `SELECT a.id, a.workspace_id, a.actor_id, u.name AS actor_name, a.action,
            a.target_type, a.target_id, a.target_title, a.created_at, a.rowid AS rowid
     FROM activity a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.workspace_id = ?
       AND (? IS NULL OR a.rowid < ?)
     ORDER BY a.rowid DESC
     LIMIT ?`
  ).all(workspaceId, cursorRowid, cursorRowid, limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? String(page[page.length - 1].rowid) : null;

  return {
    items: page.map(({ rowid: _rowid, ...rest }) => rest),
    nextCursor,
  };
}

/** Retention: drop activity older than `olderThanDays` (default 180). */
export function deleteOldActivity(olderThanDays = 180): void {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;
  db.prepare("DELETE FROM activity WHERE created_at < ?").run(cutoff);
}
