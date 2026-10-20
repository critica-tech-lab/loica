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
import { canRestoreTrashItem, canPurgeTrashItem } from "./trash-authz.server";
import { logActivity, ActivityAction } from "~/lib/activity.server";

/** Minimal actor shape needed to authorize a trash action. */
export interface TrashActor {
  id: string;
  is_admin?: boolean;
}

const NOT_FOUND = { ok: false, error: "Not found" } as const;
const FORBIDDEN = { ok: false, error: "Forbidden" } as const;

export function handleRestoreDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc) return NOT_FOUND;
  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  if (!canRestoreTrashItem(role)) return FORBIDDEN;
  restoreDocument(docId, doc.workspace_id);
  logActivity({ workspaceId: doc.workspace_id, actorId: user.id, action: ActivityAction.DocRestore, targetType: "document", targetId: docId, targetTitle: doc.title });
  return { ok: true };
}

export function handleRestoreFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder) return NOT_FOUND;
  const role = getMembership(folder.workspace_id, user.id, user.is_admin);
  if (!canRestoreTrashItem(role)) return FORBIDDEN;
  restoreFolder(folderId, folder.workspace_id);
  logActivity({ workspaceId: folder.workspace_id, actorId: user.id, action: ActivityAction.FolderRestore, targetType: "folder", targetId: folderId, targetTitle: folder.name });
  return { ok: true };
}

export function handlePurgeDoc(form: FormData, user: TrashActor) {
  const docId = String(form.get("docId") || "");
  const doc = getDocumentIncludingTrashed(docId);
  if (!doc || doc.deleted_at == null) return NOT_FOUND;
  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  if (!canPurgeTrashItem(role, user.id, doc)) return FORBIDDEN;
  permanentlyDeleteDocument(docId, doc.workspace_id);
  logActivity({ workspaceId: doc.workspace_id, actorId: user.id, action: ActivityAction.DocPurge, targetType: "document", targetId: docId, targetTitle: doc.title });
  return { ok: true };
}

export function handlePurgeFolder(form: FormData, user: TrashActor) {
  const folderId = String(form.get("folderId") || "");
  const folder = getFolderIncludingTrashed(folderId);
  if (!folder || folder.deleted_at == null) return NOT_FOUND;
  const role = getMembership(folder.workspace_id, user.id, user.is_admin);
  if (!canPurgeTrashItem(role, user.id, folder)) return FORBIDDEN;
  permanentlyDeleteFolder(folderId, folder.workspace_id);
  logActivity({ workspaceId: folder.workspace_id, actorId: user.id, action: ActivityAction.FolderPurge, targetType: "folder", targetId: folderId, targetTitle: folder.name });
  return { ok: true };
}
