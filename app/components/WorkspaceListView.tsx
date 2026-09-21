import { Link, useFetcher, useNavigate } from "react-router";
import { useMemo, type ReactNode } from "react";
import type { DocumentSummary } from "~/lib/document.server";
import type { FolderSummary } from "~/lib/folder.server";
import type { SharedFolderEntry } from "~/lib/sharing.server";
import type { WorkspaceOption } from "~/components/MoveDialog";
import { ConfirmModal } from "~/components/ConfirmModal";
import { MoveDialog } from "~/components/MoveDialog";
import { ShareDialog } from "~/components/ShareDialog";
import { ActionsMenu } from "~/components/ActionsMenu";
import { ImportDropZone } from "~/components/ImportDropZone";
import { NewButton } from "~/components/NewButton";
import { armUndoCreate } from "~/lib/undoCreate";
import { FolderRow } from "~/components/FolderRow";
import { DocRow } from "~/components/DocRow";
import { NewFolderRow } from "~/components/NewFolderRow";
import { BulkActionBar } from "~/components/BulkActionBar";
import { FolderIcon } from "~/components/icons";
import { useImport } from "~/components/hooks/useImport";
import { useSortState } from "~/components/hooks/useSortState";
import { useDocListState } from "~/components/hooks/useDocListState";
import { timeAgo } from "~/lib/ui-utils";

interface WorkspaceListViewProps {
  basePath: string; // "/w" or `/t/<teamspaceId>`
  headerContent: ReactNode;
  documents: DocumentSummary[];
  folders: FolderSummary[];
  allFolders: FolderSummary[];
  sharedFolders?: SharedFolderEntry[];
  sharedFolderIds: string[];
  starredDocs: { id: string }[];
  directlySharedDocIds: string[];
  canEdit: boolean;
  isOwner: boolean;
  page: number;
  pageSize: number;
  totalDocs: number;
  currentWorkspace: WorkspaceOption;
  otherWorkspaces: WorkspaceOption[];
}

export function WorkspaceListView({
  basePath,
  headerContent,
  documents,
  folders,
  allFolders,
  sharedFolders = [],
  sharedFolderIds,
  starredDocs,
  directlySharedDocIds,
  canEdit,
  isOwner,
  page,
  pageSize,
  totalDocs,
  currentWorkspace,
  otherWorkspaces,
}: WorkspaceListViewProps) {
  const navigate = useNavigate();
  const sharedSet = new Set(sharedFolderIds);
  const starredSet = useMemo(() => new Set(starredDocs.map((d) => d.id)), [starredDocs]);
  const directlySharedSet = useMemo(() => new Set(directlySharedDocIds), [directlySharedDocIds]);
  const { handleImport, handleUploadFile, handleUploadFiles, duplicatePrompt, confirmDuplicate, cancelDuplicate } = useImport();
  const createDocFetcher = useFetcher();
  const duplicateFetcher = useFetcher();
  const { sortCol, sortDir, toggleSort, sortedFolders, sortedDocuments } = useSortState(folders, documents, starredSet);
  const totalPages = Math.ceil(totalDocs / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;
  const {
    selectedIds, setSelectedIds, selectedDocIds, renamingItem, setRenamingItem, shareItem, setShareItem,
    moveItem, setMoveItem, creatingNewFolder, setCreatingNewFolder,
    confirmAction, setConfirmAction, confirmFetcher, starFetcher, bulkFetcher, listRef,
    hasSelectedDocs, hasPublicInSelection,
    handleRowClick, handleCheckboxToggle, handleContainerClick,
  } = useDocListState(documents);
  const selectedDocs = documents.filter((d) => selectedDocIds.includes(d.id));

  const isEmpty = folders.length === 0 && documents.length === 0 && sharedFolders.length === 0;

  return (
    <ImportDropZone onImport={handleImport} onUploadFile={handleUploadFile} onUploadFiles={handleUploadFiles}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6" onClick={handleContainerClick}>
        {/* Header */}
        <div className="flex items-center justify-between">
          {headerContent}
          {canEdit && (
            <NewButton
              onCreateDoc={() => {
                armUndoCreate("doc", location.pathname);
                const form = new FormData();
                form.set("intent", "create");
                createDocFetcher.submit(form, { method: "post" });
              }}
              onCreateFromTemplate={(templateId) => {
                armUndoCreate(templateId, location.pathname);
                const form = new FormData();
                form.set("intent", "create");
                form.set("template", templateId);
                createDocFetcher.submit(form, { method: "post" });
              }}
              onCreateFolder={() => setCreatingNewFolder(true)}
              onImport={handleImport}
              onUploadFile={handleUploadFile}
              onUploadFiles={handleUploadFiles}
            />
          )}
        </div>

        {/* Content — unified list */}
        {isEmpty && !creatingNewFolder ? (
          <div className="archive-empty" data-clear-selection>
            <p>No documents or folders yet.</p>
            {canEdit && <p>Create one above to get started.</p>}
          </div>
        ) : (
          <div ref={listRef} className="archive-list">
            {/* Sortable header */}
            <div className="archive-header">
              <span className="w-3.5 shrink-0" />
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="ml-2 flex-1 text-left"
              >
                Name {sortCol === "name" && (sortDir === "asc" ? "↑" : "↓")}
              </button>
              <button
                type="button"
                onClick={() => toggleSort("created")}
                className="hidden w-20 shrink-0 text-right sm:block"
              >
                Created {sortCol === "created" && (sortDir === "asc" ? "↑" : "↓")}
              </button>
              <button
                type="button"
                onClick={() => toggleSort("modified")}
                className="w-20 shrink-0 text-right"
              >
                Modified {sortCol === "modified" && (sortDir === "asc" ? "↑" : "↓")}
              </button>
              <span className="w-8 shrink-0" />
            </div>

            {/* New folder inline row */}
            {creatingNewFolder && (
              <NewFolderRow onDone={() => setCreatingNewFolder(false)} />
            )}

            {/* Own folders */}
            {sortedFolders.map((f, i) => (
              <FolderRow
                key={f.id}
                folder={f}
                href={`${basePath}/folder/${f.id}`}
                canEdit={canEdit}
                isOwner={isOwner}
                isShared={sharedSet.has(f.id)}
                isSelected={selectedIds.has(`folder-${f.id}`)}
                isRenaming={renamingItem?.type === "folder" && renamingItem.id === f.id}
                showBorder={i > 0 || creatingNewFolder}
                showCheckbox
                onRename={() => setRenamingItem({ type: "folder", id: f.id })}
                onRenameCancel={() => setRenamingItem(null)}
                onMove={() => setMoveItem({ type: "folder", id: f.id, currentFolderId: f.parent_id })}
                onShare={() => setShareItem({ type: "folder", id: f.id })}
                onDelete={() => setConfirmAction({ type: "delete-folder", id: f.id, title: f.name })}
                onUnshare={() => setConfirmAction({ type: "unshare-folder", id: f.id, title: f.name })}
                onCheckboxToggle={(e) => handleCheckboxToggle(e as React.MouseEvent, `folder-${f.id}`)}
                onClick={(e) => handleRowClick(e, `${basePath}/folder/${f.id}`)}
              />
            ))}

            {/* Shared folders — violet, with shared icon */}
            {sharedFolders.map((sf) => {
              const isSelected = selectedIds.has(`shared-${sf.folder_id}`);
              return (
                <div
                  key={`shared-${sf.folder_id}-${sf.shared_via}`}
                  onClick={(e) => handleRowClick(e, `/shared/folder/${sf.folder_id}`)}
                  className={`archive-row group cursor-pointer ${
                    isSelected ? "bg-sage/[0.06]" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    data-checkbox
                    checked={isSelected}
                    onChange={(e) => handleCheckboxToggle(e, `shared-${sf.folder_id}`)}
                    className={`archive-checkbox ${isSelected ? "archive-checkbox-selected" : ""}`}
                    style={{ accentColor: "var(--color-sage)" }}
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                    <FolderIcon className="h-4 w-4 shrink-0 text-tawny/60" />
                    {sf.folder_name}
                    <span className="shrink-0 rounded-full bg-sage/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sage/60">shared</span>
                  </span>
                  <span className="archive-meta hidden sm:block">
                    {timeAgo(sf.created_at)}
                  </span>
                  <span className="archive-meta">&mdash;</span>
                  <div className="archive-actions">
                    <ActionsMenu
                      itemType="shared-folder"
                      itemId={sf.folder_id}
                      canEdit={false}
                      isOwner={false}
                      onRename={() => {}}
                      onMove={() => {}}
                      onShare={() => {}}
                      onOpen={() => navigate(`/shared/folder/${sf.folder_id}`)}
                      onLeave={() => setConfirmAction({ type: "leave-folder", id: sf.folder_id, title: sf.folder_name })}
                    />
                  </div>
                </div>
              );
            })}

            {/* Documents */}
            {sortedDocuments.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                href={`${basePath}/doc/${doc.id}`}
                canEdit={canEdit}
                isOwner={isOwner}
                pdfFile={doc.pdf_file}
                isStarred={starredSet.has(doc.id)}
                isDirectlyShared={directlySharedSet.has(doc.id)}
                isSelected={selectedIds.has(`doc-${doc.id}`)}
                isRenaming={renamingItem?.type === "doc" && renamingItem.id === doc.id}
                showCheckbox
                onRename={() => setRenamingItem({ type: "doc", id: doc.id })}
                onRenameCancel={() => setRenamingItem(null)}
                onMove={() => setMoveItem({ type: "doc", id: doc.id, currentFolderId: doc.folder_id })}
                onShare={() => setShareItem({ type: "doc", id: doc.id })}
                onDelete={() => setConfirmAction({ type: "delete-doc", id: doc.id, title: doc.title })}
                onUnshare={() => setConfirmAction({ type: "unshare-doc", id: doc.id, title: doc.title })}
                onToggleStar={() => starFetcher.submit({ intent: "toggle-star", docId: doc.id }, { method: "post" })}
                onDuplicate={() => duplicateFetcher.submit({ intent: "duplicate-doc", docId: doc.id }, { method: "post" })}
                onCheckboxToggle={(e) => handleCheckboxToggle(e as React.MouseEvent, `doc-${doc.id}`)}
                onClick={(e) => handleRowClick(e, `${basePath}/doc/${doc.id}`)}
              />
            ))}

            {/* Pagination controls — only shown if there are documents or multiple pages */}
            {(totalDocs > 0) && (
              <div className="pagination">
                <span>Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  {hasPrevPage && (
                    <Link to={`${basePath}?page=${page - 1}`} className="pagination-link">
                      Previous
                    </Link>
                  )}
                  {hasNextPage && (
                    <Link to={`${basePath}?page=${page + 1}`} className="pagination-link">
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Move dialog */}
        {moveItem && (
          <MoveDialog
            itemType={moveItem.type}
            itemId={moveItem.id}
            currentFolderId={moveItem.currentFolderId}
            allFolders={allFolders}
            onClose={() => setMoveItem(null)}
            currentWorkspace={currentWorkspace}
            otherWorkspaces={otherWorkspaces}
          />
        )}

        {/* Share dialog */}
        {shareItem?.type === "folder" && isOwner && (
          <ShareDialog
            itemType="folder"
            itemId={shareItem.id}
            onClose={() => setShareItem(null)}
          />
        )}
        {shareItem?.type === "doc" && canEdit && (() => {
          const shareDoc = documents.find((d) => d.id === shareItem.id);
          return (
            <ShareDialog
              itemType="doc"
              itemId={shareItem.id}
              publicToken={shareDoc?.public_token}
              editToken={shareDoc?.edit_token}
              shareExpiresAt={shareDoc?.share_expires_at}
              hasPassword={!!shareDoc?.share_password_hash}
              onClose={() => setShareItem(null)}
            />
          );
        })()}

        {/* Bulk action bar */}
        {hasSelectedDocs && canEdit && (
          <BulkActionBar
            selectedCount={selectedDocs.length}
            hasPublicInSelection={hasPublicInSelection}
            disabled={bulkFetcher.state !== "idle"}
            onDelete={() => {
              setConfirmAction({
                type: "delete-doc",
                id: selectedDocIds.join(","),
                title: `${selectedDocs.length} document${selectedDocs.length > 1 ? "s" : ""}`,
              });
            }}
            onUnshare={() => {
              const publicDocs = selectedDocs.filter((d) => d.public_token || d.edit_token);
              setConfirmAction({
                type: "unshare-doc",
                id: publicDocs.map((d) => d.id).join(","),
                title: `${publicDocs.length} document${publicDocs.length > 1 ? "s" : ""}`,
              });
            }}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

        {/* Confirm modal */}
        {confirmAction && (
          <ConfirmModal
            title={
              confirmAction.type === "delete-doc" ? "Move to trash" :
              confirmAction.type === "delete-folder" ? "Move folder to trash" :
              confirmAction.type === "unshare-doc" ? "Remove public access" :
              confirmAction.type === "leave-folder" ? "Leave shared folder" :
              "Remove all shares"
            }
            message={
              confirmAction.type === "delete-doc"
                ? `Move "${confirmAction.title}" to trash? You can restore it within 30 days.`
                : confirmAction.type === "delete-folder"
                ? `Move "${confirmAction.title}" and all its contents to trash? You can restore it within 30 days.`
                : confirmAction.type === "unshare-doc"
                ? `Remove public access from "${confirmAction.title}"? Anyone with the link will lose access.`
                : confirmAction.type === "leave-folder"
                ? `Remove "${confirmAction.title}" from your workspace? You will lose access unless shared again.`
                : `Remove all shares from "${confirmAction.title}"? Shared users will lose access.`
            }
            confirmLabel={
              confirmAction.type === "leave-folder" ? "Leave" :
              confirmAction.type.startsWith("delete") ? "Move to trash" : "Unshare"
            }
            danger
            onCancel={() => setConfirmAction(null)}
            onConfirm={() => {
              const { type, id } = confirmAction;
              if (type === "delete-doc") {
                if (id.includes(",")) {
                  confirmFetcher.submit({ intent: "bulk-delete", docIds: id }, { method: "post" });
                } else {
                  confirmFetcher.submit({ intent: "delete", docId: id }, { method: "post" });
                }
              } else if (type === "delete-folder") {
                confirmFetcher.submit({ intent: "delete-folder", folderId: id }, { method: "post" });
              } else if (type === "unshare-doc") {
                if (id.includes(",")) {
                  confirmFetcher.submit({ intent: "bulk-unshare", docIds: id }, { method: "post" });
                } else {
                  confirmFetcher.submit({ intent: "unshare-doc", docId: id }, { method: "post" });
                }
              } else if (type === "unshare-folder") {
                confirmFetcher.submit({ intent: "unshare-all-folder", folderId: id }, { method: "post" });
              } else if (type === "leave-folder") {
                confirmFetcher.submit({ intent: "leave-folder", folderId: id }, { method: "post" });
              }
              setConfirmAction(null);
              setSelectedIds(new Set());
            }}
          />
        )}

        {/* Duplicate PDF modal */}
        {duplicatePrompt && (
          <ConfirmModal
            title="Duplicate PDF"
            message={`A PDF named "${duplicatePrompt}" already exists in this folder. Upload anyway? The new file will be renamed automatically.`}
            confirmLabel="Upload anyway"
            onConfirm={confirmDuplicate}
            onCancel={cancelDuplicate}
          />
        )}
      </div>
    </ImportDropZone>
  );
}
