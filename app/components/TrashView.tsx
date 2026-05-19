import { useFetcher } from "react-router";
import { ConfirmModal } from "~/components/ConfirmModal";
import { TrashIcon, FolderIcon, DocIcon } from "~/components/icons";
import { useToast } from "~/components/Toast";
import { useState } from "react";

interface TrashedFolder {
  id: string;
  name: string;
  parent_name: string | null;
  deleted_at: number;
}

interface TrashedDoc {
  id: string;
  title: string;
  folder_name: string | null;
  deleted_at: number;
}

function daysLeft(deletedAt: number): number {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = deletedAt + 30 * 24 * 60 * 60;
  return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60)));
}

export function TrashView({
  documents,
  folders,
}: {
  documents: TrashedDoc[];
  folders: TrashedFolder[];
}) {
  const fetcher = useFetcher();
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<{
    type: "purge-doc" | "purge-folder" | "empty-trash";
    id: string;
    title: string;
  } | null>(null);

  const isEmpty = documents.length === 0 && folders.length === 0;

  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="section-header">Trash</h1>
          {!isEmpty && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: "empty-trash", id: "", title: "" })}
              className="cursor-pointer rounded border border-scarlet/20 bg-scarlet/[0.06] px-2.5 py-1 text-xs font-medium text-scarlet transition-colors hover:bg-scarlet/15"
            >
              Empty trash
            </button>
          )}
        </div>

        <p className="m-0 text-xs text-fg/30">
          Items in trash are automatically deleted after 30 days.
        </p>

        {isEmpty ? (
          <div className="archive-empty">
            <p>Trash is empty.</p>
            <p>Deleted documents and folders will appear here for 30 days.</p>
          </div>
        ) : (
          <div className="archive-list">
            <div className="archive-header">
              <span className="flex-1">Name</span>
              <span className="w-24 shrink-0 text-right">Location</span>
              <span className="w-16 shrink-0 text-right">Expires</span>
              <span className="w-24 shrink-0" />
            </div>
            {folders.map((f) => (
              <div key={f.id} className="archive-row group">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                  <FolderIcon className="h-4 w-4 shrink-0 text-tawny/60" />
                  {f.name}
                </span>
                <span className="archive-meta w-24">{f.parent_name ?? "/"}</span>
                <span className="archive-meta w-16">{daysLeft(f.deleted_at)}d</span>
                <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                  <button
                    type="button"
                    title="Restore"
                    onClick={() => {
                      fetcher.submit(
                        { intent: "restore-folder", folderId: f.id },
                        { method: "post" }
                      );
                      toast("Folder restored", "success");
                    }}
                    className="cursor-pointer rounded border border-sage/25 bg-sage/[0.08] px-2 py-0.5 text-xs font-medium text-sage transition-colors hover:bg-sage/20"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    title="Delete permanently"
                    onClick={() =>
                      setConfirmAction({
                        type: "purge-folder",
                        id: f.id,
                        title: f.name,
                      })
                    }
                    className="cursor-pointer rounded border border-scarlet/20 bg-scarlet/[0.06] p-0.5 text-scarlet transition-colors hover:bg-scarlet/15"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
            {documents.map((d) => (
              <div key={d.id} className="archive-row group">
                <DocIcon className="mr-1.5 h-4 w-4 shrink-0 text-fg/40" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.title}</span>
                <span className="archive-meta w-24">{d.folder_name ?? "/"}</span>
                <span className="archive-meta w-16">{daysLeft(d.deleted_at)}d</span>
                <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                  <button
                    type="button"
                    title="Restore"
                    onClick={() => {
                      fetcher.submit(
                        { intent: "restore-doc", docId: d.id },
                        { method: "post" }
                      );
                      toast("Document restored", "success");
                    }}
                    className="cursor-pointer rounded border border-sage/25 bg-sage/[0.08] px-2 py-0.5 text-xs font-medium text-sage transition-colors hover:bg-sage/20"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    title="Delete permanently"
                    onClick={() =>
                      setConfirmAction({
                        type: "purge-doc",
                        id: d.id,
                        title: d.title,
                      })
                    }
                    className="cursor-pointer rounded border border-scarlet/20 bg-scarlet/[0.06] p-0.5 text-scarlet transition-colors hover:bg-scarlet/15"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          title={
            confirmAction.type === "empty-trash"
              ? "Empty trash"
              : "Delete permanently"
          }
          message={
            confirmAction.type === "empty-trash"
              ? "Permanently delete all items in trash? This cannot be undone."
              : `Permanently delete "${confirmAction.title}"? This cannot be undone.`
          }
          confirmLabel="Delete permanently"
          danger
          onConfirm={() => {
            if (confirmAction.type === "empty-trash") {
              fetcher.submit({ intent: "empty-trash" }, { method: "post" });
              toast("Trash emptied", "success");
            } else if (confirmAction.type === "purge-doc") {
              fetcher.submit(
                { intent: "purge-doc", docId: confirmAction.id },
                { method: "post" }
              );
              toast("Document permanently deleted", "success");
            } else {
              fetcher.submit(
                { intent: "purge-folder", folderId: confirmAction.id },
                { method: "post" }
              );
              toast("Folder permanently deleted", "success");
            }
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
