import type { WorkspaceRole } from "./workspace.server";

/**
 * Restoring or purging trash changes or destroys content, so it is a write.
 * Viewers (Teamspaces only) are read-only and must not reach it.
 */
export function canManageTrash(role: WorkspaceRole | null): boolean {
  return role !== null && role !== "viewer";
}
