import { useState, useCallback, useRef, useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useToast } from "~/components/Toast";

interface Doc {
  id: string;
  public_token: string | null;
  edit_token: string | null;
}

const ACTION_MESSAGES: Record<string, string> = {
  "delete-doc": "Moved to trash",
  "delete-folder": "Folder moved to trash",
  "unshare-doc": "Public access removed",
  "unshare-folder": "Sharing removed",
  "leave-folder": "Left shared folder",
};

/**
 * Intents whose "success" toast should expose an Undo action that restores
 * the trashed item(s) via the corresponding restore-* intent.
 */
const UNDOABLE_INTENTS = new Set(["delete-doc", "delete-folder"]);

export function useDocListState(documents: Doc[]) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingItem, setRenamingItem] = useState<{ type: "doc" | "folder"; id: string } | null>(null);
  const [shareItem, setShareItem] = useState<{ type: "doc" | "folder"; id: string } | null>(null);
  const [moveItem, setMoveItem] = useState<{
    type: "doc" | "folder";
    id: string;
    currentFolderId: string | null;
  } | null>(null);
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: string;
    id: string;
    title: string;
  } | null>(null);
  const confirmFetcher = useFetcher();
  const starFetcher = useFetcher();
  const bulkFetcher = useFetcher();
  const undoFetcher = useFetcher();
  const listRef = useRef<HTMLDivElement>(null);

  // Derive selected doc IDs from selection state
  const selectedDocIds = Array.from(selectedIds)
    .filter((s) => s.startsWith("doc-"))
    .map((s) => s.slice(4));
  const selectedDocs = documents.filter((d) => selectedDocIds.includes(d.id));
  const hasSelectedDocs = selectedDocs.length > 0;
  const hasPublicInSelection = selectedDocs.some((d) => d.public_token || d.edit_token);

  // Clear selection after bulk action completes
  const prevBulkState = useRef(bulkFetcher.state);
  if (prevBulkState.current !== "idle" && bulkFetcher.state === "idle") {
    setSelectedIds(new Set());
  }
  prevBulkState.current = bulkFetcher.state;

  // Toast (with optional Undo) when confirmFetcher completes.
  // We remember the last action's type AND id so the Undo button knows what to restore.
  const lastConfirm = useRef<{ type: string; id: string } | null>(null);
  const prevConfirmState = useRef(confirmFetcher.state);
  useEffect(() => {
    if (prevConfirmState.current !== "idle" && confirmFetcher.state === "idle" && lastConfirm.current) {
      const { type, id } = lastConfirm.current;
      const msg = ACTION_MESSAGES[type];
      if (msg) {
        if (UNDOABLE_INTENTS.has(type)) {
          const restoreIntent = type === "delete-folder" ? "restore-folder" : "restore-doc";
          const idField = type === "delete-folder" ? "folderId" : "docId";
          toast(msg, {
            type: "success",
            duration: 8000,
            action: {
              label: "Undo",
              onClick: () => {
                undoFetcher.submit(
                  { intent: restoreIntent, [idField]: id },
                  { method: "post", action: "/trash" },
                );
              },
            },
          });
        } else {
          toast(msg, "success");
        }
      }
      lastConfirm.current = null;
    }
    prevConfirmState.current = confirmFetcher.state;
  }, [confirmFetcher.state, toast, undoFetcher]);

  const setConfirmActionWithTracking = useCallback(
    (action: { type: string; id: string; title: string } | null) => {
      if (action) lastConfirm.current = { type: action.type, id: action.id };
      setConfirmAction(action);
    },
    []
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if ((e.target as HTMLElement).closest("button, a, input, form, [data-no-select], [data-checkbox]")) return;
      // Docs open in a new tab (Drive pattern); folders navigate in-place.
      if (path.includes("/doc/")) {
        window.open(path, "_blank", "noopener");
      } else {
        navigate(path);
      }
    },
    [navigate]
  );

  const handleCheckboxToggle = useCallback(
    (e: React.MouseEvent | React.ChangeEvent, id: string) => {
      e.stopPropagation();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    []
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-clear-selection]")) {
        setSelectedIds(new Set());
      }
    },
    []
  );

  return {
    selectedIds,
    setSelectedIds,
    renamingItem,
    setRenamingItem,
    shareItem,
    setShareItem,
    moveItem,
    setMoveItem,
    creatingNewFolder,
    setCreatingNewFolder,
    confirmAction,
    setConfirmAction: setConfirmActionWithTracking,
    confirmFetcher,
    starFetcher,
    bulkFetcher,
    listRef,
    selectedDocIds,
    hasSelectedDocs,
    hasPublicInSelection,
    handleRowClick,
    handleCheckboxToggle,
    handleContainerClick,
  };
}
