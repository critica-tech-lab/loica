import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { FolderSummary } from "~/lib/folder.server";
import { FolderIcon, DocIcon, PdfIcon, AttachmentIcon } from "~/components/icons";
import { useDndState } from "~/components/dnd/DndProvider";
import { Droppable } from "~/components/dnd/Droppable";
import { SidebarCreateMenu } from "./SidebarCreateMenu";

export interface FolderTreeNodeProps {
  folder: FolderSummary;
  depth: number;
  activeItemId?: string | null;
  workspaceId: string;
  expandedFolders: Set<string>;
  onToggle: (folderId: string) => void;
  urlPrefix?: string;
  /** When set, drops onto this folder trigger a cross-workspace move to this workspace. */
  crossWorkspaceId?: string;
  /** Increment to force a refetch of this node's children. */
  refreshToken?: number;
}

interface ChildData {
  folders: FolderSummary[];
  docs: { id: string; title: string; pdf_file: string | null }[];
}

// Indentation: 0.5rem base + 0.75rem per depth level, capped at depth 6
const MAX_INDENT_DEPTH = 6;
function folderIndent(depth: number) {
  return 0.5 + Math.min(depth, MAX_INDENT_DEPTH) * 0.75;
}
// Docs sit under their parent folder, aligned past the chevron
function docIndent(depth: number) {
  return folderIndent(depth) + 1;
}

export function FolderTreeNode({
  folder,
  depth,
  activeItemId,
  workspaceId,
  expandedFolders,
  onToggle,
  urlPrefix = "/w",
  crossWorkspaceId,
  refreshToken,
}: FolderTreeNodeProps) {
  // Plain `fetch` instead of `useFetcher.load` to avoid RR's fog-of-war
  // manifest discovery, which Vite caches as immutable in dev and stalls
  // on a "JSON.parse: unexpected end of data" if any one response was empty
  // (see FolderTreeSidebar comment for details).
  const [children, setChildren] = useState<ChildData | null>(null);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);
  const hasFetched = useRef(false);
  const isActive = activeItemId === folder.id;
  const isExpanded = expandedFolders.has(folder.id);

  function loadChildren() {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setIsLoadingChildren(true);
    fetch(`/api/folder-children/${workspaceId}?parentId=${folder.id}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setChildren(d); })
      .catch(() => { /* leave empty */ })
      .finally(() => setIsLoadingChildren(false));
  }

  // Auto-fetch children when folder is expanded (e.g. from localStorage state)
  useEffect(() => {
    if (isExpanded) loadChildren();
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when a move operation completes
  useEffect(() => {
    if (!refreshToken) return;
    hasFetched.current = false;
    if (isExpanded) {
      setChildren(null);
      loadChildren();
    }
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle() {
    onToggle(folder.id);
    loadChildren();
  }

  const indent = folderIndent(depth);
  const isLoading = isLoadingChildren && !children;
  // Guide line position: aligned to the chevron center of this folder
  const guideLeft = indent + 0.5;
  const { enabled: dndEnabled } = useDndState();

  const folderRow = (
    dropRef?: (el: HTMLElement | null) => void,
    isOver?: boolean,
    isInvalid?: boolean,
  ) => (
    <div
      ref={dropRef}
      className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}${
        isOver && !isInvalid ? " sidebar-drop-over" : ""
      }${isInvalid ? " sidebar-drop-invalid" : ""}`}
      style={{ paddingLeft: `${indent}rem` }}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="tree-chevron"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse" : "Expand"}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform var(--ease-out)" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <Link
        to={`${urlPrefix}/folder/${folder.id}`}
        prefetch="intent"
        className="flex flex-1 items-center gap-1.5 truncate no-underline text-inherit"
        data-tree-item={folder.id}
      >
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-tawny/60" />
        <span className="truncate">{folder.name}</span>
      </Link>
      <SidebarCreateMenu
        actionUrl={`${urlPrefix}/folder/${folder.id}`}
        docIntent="create-doc"
        folderIntent="create-folder"
      />
    </div>
  );

  return (
    <div>
      {dndEnabled ? (
        <Droppable target={{ type: "folder", id: folder.id, ...(crossWorkspaceId ? { workspaceId: crossWorkspaceId } : {}) }}>
          {({ dropRef, isOver, isInvalid }) => folderRow(dropRef, isOver, isInvalid)}
        </Droppable>
      ) : (
        folderRow()
      )}

      {isExpanded && (
        <div className="relative">
          {/* Tree guide line */}
          <div
            className="tree-guide-line"
            style={{ left: `${guideLeft}rem` }}
          />
          {isLoading && (
            <div
              className="py-1.5 text-[11px] text-fg/25 italic"
              style={{ paddingLeft: `${docIndent(depth + 1)}rem` }}
            >
              Loading...
            </div>
          )}
          {children && (
            <>
              {children.folders.map((childFolder) => (
                <FolderTreeNode
                  key={childFolder.id}
                  folder={childFolder}
                  depth={depth + 1}
                  activeItemId={activeItemId}
                  workspaceId={workspaceId}
                  expandedFolders={expandedFolders}
                  onToggle={onToggle}
                  urlPrefix={urlPrefix}
                  crossWorkspaceId={crossWorkspaceId}
                  refreshToken={refreshToken}
                />
              ))}
              {children.docs.map((doc) => (
                <DocTreeItem
                  key={doc.id}
                  doc={doc}
                  depth={depth + 1}
                  isActive={activeItemId === doc.id}
                  urlPrefix={urlPrefix}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DocTreeItem({
  doc,
  depth,
  isActive,
  urlPrefix = "/w",
}: {
  doc: { id: string; title: string; pdf_file: string | null };
  depth: number;
  isActive: boolean;
  urlPrefix?: string;
}) {
  const indent = docIndent(depth);
  const isPdf = doc.pdf_file?.toLowerCase().endsWith(".pdf");
  const isFile = !!doc.pdf_file && !isPdf;
  return (
    <Link
      to={`${urlPrefix}/doc/${doc.id}`}
      target="_blank"
      rel="noopener"
      className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
      style={{ paddingLeft: `${indent}rem` }}
      data-tree-item={doc.id}
    >
      {isPdf ? (
        <PdfIcon className="h-3.5 w-3.5 shrink-0 text-scarlet/60" />
      ) : isFile ? (
        <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-purple/50" />
      ) : (
        <DocIcon className="h-3.5 w-3.5 shrink-0 text-cyan/50" />
      )}
      <span className="truncate">{doc.title || "Untitled"}</span>
    </Link>
  );
}

export { folderIndent, docIndent };
