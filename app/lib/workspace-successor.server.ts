/**
 * Who takes over what a leaving user created in a workspace.
 *
 * `created_by` is NOT NULL on workspaces, folders and documents, so removing a
 * user has to hand each of those rows to someone else first. The successor is
 * picked from the workspace's remaining members: an owner first (shared
 * Personal workspaces), then a Teamspace admin, then the member who joined
 * earliest. Teamspace members never hold the `owner` role, so choosing owners
 * only made every user who created a Teamspace impossible to remove.
 *
 * A workspace left with no other member has no successor and the update fails
 * on the NOT NULL constraint. Callers delete or hand over such workspaces
 * before calling this.
 *
 * Takes the database handle as a parameter so tests can use an in-memory one.
 */

/** The one database capability this module needs. */
export interface SuccessorDb {
  prepare(sql: string): { run(...params: any[]): unknown };
}

// Each table paired with the SQL expression naming its workspace.
const REASSIGNED_TABLES = [
  { table: "workspaces", workspaceId: "workspaces.id" },
  { table: "folders", workspaceId: "folders.workspace_id" },
  { table: "documents", workspaceId: "documents.workspace_id" },
] as const;

function successorSql(workspaceId: string): string {
  return `SELECT wm.user_id FROM workspace_members wm
          WHERE wm.workspace_id = ${workspaceId} AND wm.user_id != ?
          ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                   wm.joined_at, wm.user_id
          LIMIT 1`;
}

/** Hand everything `userId` created in workspaces, folders and documents to a successor. */
export function reassignCreatedBy(db: SuccessorDb, userId: string): void {
  for (const { table, workspaceId } of REASSIGNED_TABLES) {
    db.prepare(
      `UPDATE ${table} SET created_by = (${successorSql(workspaceId)}) WHERE created_by = ?`,
    ).run(userId, userId);
  }
}
