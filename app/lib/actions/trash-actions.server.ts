import {
  restoreDocument,
  permanentlyDeleteDocument,
} from "~/lib/document.server";
import {
  restoreFolder,
  permanentlyDeleteFolder,
} from "~/lib/folder.server";

export function handleRestoreDoc(form: FormData) {
  const docId = String(form.get("docId") || "");
  restoreDocument(docId);
  return { ok: true };
}

export function handleRestoreFolder(form: FormData) {
  const folderId = String(form.get("folderId") || "");
  restoreFolder(folderId);
  return { ok: true };
}

export function handlePurgeDoc(form: FormData) {
  const docId = String(form.get("docId") || "");
  permanentlyDeleteDocument(docId);
  return { ok: true };
}

export function handlePurgeFolder(form: FormData) {
  const folderId = String(form.get("folderId") || "");
  permanentlyDeleteFolder(folderId);
  return { ok: true };
}
