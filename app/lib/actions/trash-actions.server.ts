import {
  restoreDocument,
  permanentlyDeleteDocument,
  getDocumentIncludingTrashed,
} from "~/lib/document.server";
import {
  restoreFolder,
  permanentlyDeleteFolder,
  getFolderIncludingTrashed,
} from "~/lib/folder.server";
import { getMembership, type WorkspaceRole } from "~/lib/workspace.server";

/** Minimal actor shape needed to authorize a trash action. */
export interface TrashActor {
  id: string;
  is_admin?: boolean;
}

const NOT_FOUND = { ok: false, error: "Not found" } as const;

/** Any member may restore except viewers (view-only access shouldn't move items out of trash). */
function canRestore(role: WorkspaceRole | null): boolean {
  return !!role && role !== "viewer";
}

/** Permanent deletion is for workspace admins/owners, or whoever trashed the item. */
function canPurge(role: WorkspaceRole | null, deletedBy: string | null | undefined, userId: string): boolean {
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  return deletedBy === userId;
}

export function handleRestoreDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc) return NOT_FOUND;
  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  if (!canRestore(role)) return NOT_FOUND;
  restoreDocument(docId, doc.workspace_id);
  return { ok: true };
}

export function handleRestoreFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder) return NOT_FOUND;
  const role = getMembership(folder.workspace_id, user.id, user.is_admin);
  if (!canRestore(role)) return NOT_FOUND;
  restoreFolder(folderId, folder.workspace_id);
  return { ok: true };
}

export function handlePurgeDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc || doc.deleted_at == null) return NOT_FOUND;
  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  if (!canPurge(role, doc.deleted_by, user.id)) return NOT_FOUND;
  permanentlyDeleteDocument(docId, doc.workspace_id);
  return { ok: true };
}

export function handlePurgeFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder || folder.deleted_at == null) return NOT_FOUND;
  const role = getMembership(folder.workspace_id, user.id, user.is_admin);
  if (!canPurge(role, folder.deleted_by, user.id)) return NOT_FOUND;
  permanentlyDeleteFolder(folderId, folder.workspace_id);
  return { ok: true };
}
