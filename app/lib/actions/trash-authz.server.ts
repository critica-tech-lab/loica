/**
 * Pure authorization rules for trash actions, kept separate from
 * trash-actions.server.ts so they can be unit tested without pulling in
 * the document/folder/workspace modules (and transitively the DB).
 */
import type { WorkspaceRole } from "~/lib/workspace.server";

/** Minimal trashed-item shape needed to authorize a purge. */
export interface TrashedItem {
  created_by: string;
  deleted_by?: string | null;
}

/** Restoring from trash needs more than read access — a viewer may not. */
export function canRestoreTrashItem(role: WorkspaceRole | null): boolean {
  return !!role && role !== "viewer";
}

/**
 * Permanently deleting is irreversible, so it's reserved for the workspace
 * owner/admin, or whoever created the item or sent it to trash in the first
 * place — not just anyone with edit access.
 */
export function canPurgeTrashItem(
  role: WorkspaceRole | null,
  actorId: string,
  item: TrashedItem
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (actorId === item.created_by) return true;
  return !!item.deleted_by && actorId === item.deleted_by;
}
