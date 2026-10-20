/**
 * The one place that decides what a signed-in user may do with a document.
 *
 * Both processes need this answer: the web server (route loaders, export
 * endpoints) and the WebSocket server (`ws/auth.ts`). Each used to carry its own
 * copy, so a change to how shares work had to be made in several places, and the
 * copies drifted (the web helpers returned a boolean and dropped the permission
 * level, so the ws server re-queried SQL to get it back).
 *
 * Takes the database handle as a parameter: the ws server owns its own
 * connection, and tests pass an in-memory one. Imports nothing from the app so
 * it loads under plain Node (the ws server runs native TS, no `~` alias).
 *
 * Share-token access (public/edit/external links) is deliberately not handled
 * here: web and ws differ on it today, and it is not a signed-in user decision.
 */

/**
 * The one database capability this module needs. better-sqlite3 (both
 * processes) satisfies it, and so does bun:sqlite, which the tests use because
 * Bun cannot load better-sqlite3's native addon.
 */
export interface DocAccessDb {
  prepare(sql: string): { get(...params: any[]): unknown };
}

export type DocAccessLevel = "write" | "read";

/**
 * Where the access came from. An admin or workspace member never lists share
 * sources: workspace access already settles the question.
 */
export type DocAccessSource = "admin" | "member" | "folder-share" | "doc-share";

export interface DocAccess {
  level: DocAccessLevel;
  via: DocAccessSource[];
}

/** True when the access comes from a share, not from workspace membership or admin. */
export function isShareAccess(access: DocAccess): boolean {
  return access.via.includes("folder-share") || access.via.includes("doc-share");
}

export interface DocAccessTarget {
  id: string;
  workspace_id: string;
  folder_id: string | null;
}

export interface DocAccessUser {
  id: string;
  is_admin: boolean | number;
}

const VIEWER_ROLE = "viewer";
const EDITOR_PERMISSION = "editor";
const ACCEPTED = "accepted";

function levelOf(permission: string): DocAccessLevel {
  return permission === EDITOR_PERMISSION ? "write" : "read";
}

/**
 * Highest permission among the user's accepted shares (direct or through a
 * group) on the folder or any of its ancestors. A share on a folder covers its
 * whole subtree, never its parents.
 */
function folderShareLevel(
  db: DocAccessDb,
  folderId: string | null,
  userId: string,
): DocAccessLevel | null {
  if (!folderId) {
    return null;
  }

  const row = db
    .prepare(
      `WITH RECURSIVE chain(id, parent_id) AS (
         SELECT id, parent_id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id
       )
       SELECT fs.permission FROM folder_shares fs
       WHERE fs.folder_id IN (SELECT id FROM chain)
         AND fs.status = ?
         AND (fs.user_id = ? OR fs.group_id IN (
           SELECT group_id FROM group_members WHERE user_id = ? AND status = ?
         ))
       ORDER BY CASE fs.permission WHEN ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(folderId, ACCEPTED, userId, userId, ACCEPTED, EDITOR_PERMISSION) as
    | { permission: string }
    | undefined;

  return row ? levelOf(row.permission) : null;
}

/** Highest permission among the user's accepted direct or group shares on the document. */
function docShareLevel(
  db: DocAccessDb,
  docId: string,
  userId: string,
): DocAccessLevel | null {
  const row = db
    .prepare(
      `SELECT ds.permission FROM document_shares ds
       WHERE ds.document_id = ? AND ds.status = ?
         AND (ds.user_id = ? OR ds.group_id IN (
           SELECT group_id FROM group_members WHERE user_id = ? AND status = ?
         ))
       ORDER BY CASE ds.permission WHEN ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(docId, ACCEPTED, userId, userId, ACCEPTED, EDITOR_PERMISSION) as
    | { permission: string }
    | undefined;

  return row ? levelOf(row.permission) : null;
}

/**
 * Resolve a user's access to a document, or null when they have none.
 *
 * Order: admin, workspace member (viewer role reads, any other role writes),
 * then shares. When both a folder share and a document share apply, the higher
 * level wins and both sources are reported.
 */
export function resolveDocAccess(
  db: DocAccessDb,
  doc: DocAccessTarget,
  user: DocAccessUser,
): DocAccess | null {
  if (user.is_admin) {
    return { level: "write", via: ["admin"] };
  }

  const membership = db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(doc.workspace_id, user.id) as { role: string } | undefined;

  if (membership) {
    return { level: membership.role === VIEWER_ROLE ? "read" : "write", via: ["member"] };
  }

  const folderLevel = folderShareLevel(db, doc.folder_id, user.id);
  const docLevel = docShareLevel(db, doc.id, user.id);

  const via: DocAccessSource[] = [];
  if (folderLevel) {
    via.push("folder-share");
  }
  if (docLevel) {
    via.push("doc-share");
  }
  if (via.length === 0) {
    return null;
  }

  const level = folderLevel === "write" || docLevel === "write" ? "write" : "read";
  return { level, via };
}
