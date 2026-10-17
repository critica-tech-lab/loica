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
import { getMembership } from "~/lib/workspace.server";
import { canManageTrash } from "~/lib/trash-permission.server";

/** Minimal actor shape needed to authorize a trash action. */
export interface TrashActor {
  id: string;
  is_admin?: boolean;
}

const NOT_FOUND = { ok: false, error: "Not found" } as const;

export function handleRestoreDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc || !canManageTrash(getMembership(doc.workspace_id, user.id, user.is_admin))) return NOT_FOUND;
  restoreDocument(docId, doc.workspace_id);
  return { ok: true };
}

export function handleRestoreFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder || !canManageTrash(getMembership(folder.workspace_id, user.id, user.is_admin))) return NOT_FOUND;
  restoreFolder(folderId, folder.workspace_id);
  return { ok: true };
}

export function handlePurgeDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc || doc.deleted_at == null) return NOT_FOUND;
  if (!canManageTrash(getMembership(doc.workspace_id, user.id, user.is_admin))) return NOT_FOUND;
  permanentlyDeleteDocument(docId, doc.workspace_id);
  return { ok: true };
}

export function handlePurgeFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder || folder.deleted_at == null) return NOT_FOUND;
  if (!canManageTrash(getMembership(folder.workspace_id, user.id, user.is_admin))) return NOT_FOUND;
  permanentlyDeleteFolder(folderId, folder.workspace_id);
  return { ok: true };
}
