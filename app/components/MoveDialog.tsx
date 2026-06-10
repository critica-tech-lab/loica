import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { FolderSummary } from "~/lib/folder.server";
import { getDescendantIds } from "~/lib/folder-utils";
import { FolderIcon } from "./icons";
import { useFocusTrap } from "~/components/hooks/useFocusTrap";

export type WorkspaceOption = {
  id: string;
  name: string;
  icon?: string | null;
  type: "personal" | "team";
};

interface MoveDialogProps {
  itemType: "doc" | "folder";
  itemId: string;
  currentFolderId: string | null;
  allFolders: FolderSummary[];
  onClose: () => void;
  /** When set, constrains the tree to this subtree root (for shared folders). */
  rootFolderId?: string;
  /** Current workspace info — needed for cross-workspace moves. */
  currentWorkspace?: WorkspaceOption;
  /** Other workspaces the user can move items to. */
  otherWorkspaces?: WorkspaceOption[];
}

function buildTree(
  folders: FolderSummary[],
  parentId: string | null,
  depth: number
): { folder: FolderSummary; depth: number }[] {
  const result: { folder: FolderSummary; depth: number }[] = [];
  const children = folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    result.push({ folder: child, depth });
    result.push(...buildTree(folders, child.id, depth + 1));
  }
  return result;
}


export function MoveDialog({
  itemType,
  itemId,
  currentFolderId,
  allFolders,
  onClose,
  rootFolderId,
  currentWorkspace,
  otherWorkspaces,
}: MoveDialogProps) {
  const canCrossWorkspace = currentWorkspace && otherWorkspaces && otherWorkspaces.length > 0;
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [movedToName, setMovedToName] = useState<string | null>(null);
  const folderFetcher = useFetcher<{ folders: FolderSummary[] }>();
  const moveFetcher = useFetcher();
  const prevMoveFetcherState = useRef(moveFetcher.state);

  useEffect(() => {
    const prev = prevMoveFetcherState.current;
    prevMoveFetcherState.current = moveFetcher.state;
    if (prev !== "idle" && moveFetcher.state === "idle" && movedToName !== null) {
      window.dispatchEvent(new CustomEvent("loica:sidebar-refresh"));
    }
  }, [moveFetcher.state, movedToName]);

  // When a different workspace is selected, fetch its folders
  useEffect(() => {
    if (selectedWorkspaceId) {
      folderFetcher.load(`/api/folder-children/${selectedWorkspaceId}?all=1`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  const isOtherWorkspace = selectedWorkspaceId !== null;
  const activeFolders = isOtherWorkspace
    ? (folderFetcher.data?.folders ?? [])
    : allFolders;
  const isLoading = isOtherWorkspace && folderFetcher.state === "loading";

  const rootFolder = rootFolderId && !isOtherWorkspace
    ? activeFolders.find((f) => f.id === rootFolderId)
    : undefined;
  const treeRoot = isOtherWorkspace ? null : (rootFolderId ?? null);
  const tree = buildTree(activeFolders, treeRoot, 0);

  const intent = isOtherWorkspace
    ? (itemType === "doc" ? "move-doc-to-workspace" : "move-folder-to-workspace")
    : (itemType === "doc" ? "move-doc" : "move-folder");
  const idField = itemType === "doc" ? "docId" : "folderId";
  const disabledIds =
    itemType === "folder" && !isOtherWorkspace
      ? getDescendantIds(activeFolders, itemId)
      : new Set<string>();
  const isCurrentRoot = isOtherWorkspace
    ? false
    : (rootFolderId ? currentFolderId === rootFolderId : currentFolderId === null);

  const selectedWs = canCrossWorkspace
    ? otherWorkspaces.find((w) => w.id === selectedWorkspaceId)
    : undefined;

  function handleMove(destinationName: string, fields: Record<string, string>) {
    setMovedToName(destinationName);
    moveFetcher.submit(fields, { method: "post" });
  }

  const trapRef = useFocusTrap<HTMLDivElement>(onClose);
  const itemLabel = itemType === "doc" ? "document" : "folder";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-plumage/40"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${itemLabel}`}
        className="flex max-h-[60vh] w-[min(24rem,90vw)] flex-col gap-3 rounded-lg border border-fg/15 bg-bg p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold">Move {itemLabel}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer border-none bg-transparent p-1 text-fg opacity-50 transition-opacity hover:opacity-100"
          >
            &times;
          </button>
        </div>

        {movedToName !== null ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-fg/70">
              {itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)} moved to{" "}
              <span className="font-semibold text-fg">{movedToName}</span>.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded bg-fg/10 px-4 py-1.5 text-xs font-medium transition-colors hover:bg-fg/15"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Workspace selector */}
            {canCrossWorkspace && (
              <div className="flex flex-wrap gap-1.5 border-b border-fg/10 pb-2">
                <button
                  type="button"
                  onClick={() => setSelectedWorkspaceId(null)}
                  className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${
                    !isOtherWorkspace
                      ? "bg-fg/10 font-bold"
                      : "opacity-60 hover:bg-fg/5 hover:opacity-100"
                  }`}
                >
                  {currentWorkspace.icon ? `${currentWorkspace.icon} ` : ""}{currentWorkspace.name}
                </button>
                {otherWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => setSelectedWorkspaceId(ws.id)}
                    className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${
                      selectedWorkspaceId === ws.id
                        ? "bg-fg/10 font-bold"
                        : "opacity-60 hover:bg-fg/5 hover:opacity-100"
                    }`}
                  >
                    {ws.icon ? `${ws.icon} ` : ""}{ws.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-0.5 overflow-y-auto">
              {isLoading ? (
                <div className="py-4 text-center text-xs opacity-50">Loading folders...</div>
              ) : (
                <>
                  {/* Root option */}
                  <button
                    type="button"
                    disabled={isCurrentRoot}
                    onClick={() => handleMove(
                      rootFolder ? rootFolder.name : (selectedWs ? `${selectedWs.name} root` : "Root"),
                      {
                        intent,
                        [idField]: itemId,
                        targetFolderId: rootFolder?.id ?? "",
                        ...(isOtherWorkspace ? { targetWorkspaceId: selectedWorkspaceId! } : {}),
                      }
                    )}
                    className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors
                      ${isCurrentRoot
                        ? "cursor-not-allowed font-bold opacity-50"
                        : "cursor-pointer opacity-80 hover:bg-fg/5 hover:opacity-100"
                      }`}
                  >
                    {rootFolder ? (
                      <FolderIcon className="h-4 w-4 shrink-0 opacity-40" />
                    ) : (
                      <svg className="h-4 w-4 shrink-0 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                    )}
                    {rootFolder ? rootFolder.name : (selectedWs ? `${selectedWs.name} root` : "Root")}
                  </button>

                  {tree.map(({ folder, depth }) => {
                    const isCurrent = !isOtherWorkspace && folder.id === currentFolderId;
                    const isDisabled = isCurrent || disabledIds.has(folder.id);
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handleMove(folder.name, {
                          intent,
                          [idField]: itemId,
                          targetFolderId: folder.id,
                          ...(isOtherWorkspace ? { targetWorkspaceId: selectedWorkspaceId! } : {}),
                        })}
                        className={`flex w-full items-center gap-2 rounded py-1.5 text-left text-xs transition-colors
                          ${isCurrent ? "cursor-not-allowed font-bold opacity-50" : ""}
                          ${isDisabled && !isCurrent ? "cursor-not-allowed opacity-30" : ""}
                          ${!isDisabled ? "cursor-pointer opacity-80 hover:bg-fg/5 hover:opacity-100" : ""}
                        `}
                        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
                      >
                        <FolderIcon className="h-4 w-4 shrink-0 opacity-50" />
                        {folder.name}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
