import { ConfirmModal } from "~/components/ConfirmModal";

export interface ConfirmActionState {
  type: string;
  id: string;
  title: string;
}

/**
 * Canonical confirm dialog for destructive doc/folder actions (delete, unshare,
 * leave). The wording (title, message, button label) lives here so the four
 * dashboard routes — workspace, teamspace, and their folder views — can't drift
 * apart again. The actual submit differs per route (bulk vs single, different
 * intent names), so each caller passes its own `onConfirm`.
 */
export function ConfirmActionModal({
  action,
  onConfirm,
  onCancel,
}: {
  action: ConfirmActionState | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!action) return null;

  const title =
    action.type === "delete-doc" ? "Delete document" :
    action.type === "delete-folder" ? "Delete folder" :
    action.type === "unshare-doc" ? "Remove public access" :
    action.type === "leave-folder" ? "Leave shared folder" :
    "Remove all shares";

  const message =
    action.type === "delete-doc"
      ? `Are you sure you want to delete "${action.title}"? This will be moved to trash.`
      : action.type === "delete-folder"
      ? `Are you sure you want to delete "${action.title}" and all its contents? This will be moved to trash.`
      : action.type === "unshare-doc"
      ? `Remove public access from "${action.title}"? Anyone with the link will lose access.`
      : action.type === "leave-folder"
      ? `Remove "${action.title}" from your workspace? You will lose access unless shared again.`
      : `Remove all shares from "${action.title}"? Shared users will lose access.`;

  const confirmLabel =
    action.type === "leave-folder" ? "Leave" :
    action.type.startsWith("delete") ? "Delete" : "Unshare";

  return (
    <ConfirmModal
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
