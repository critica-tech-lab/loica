import { Form, redirect, useLoaderData, useActionData, useFetcher, Link, useNavigate } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/workspace";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getUserPersonalWorkspaces,
  getWorkspace,
  getMembership,
} from "~/lib/workspace.server";
import {
  getWorkspaceDocumentsPage,
  getStarredDocs,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import {
  getFoldersAtLevel,
  getAllWorkspaceFolders,
} from "~/lib/folder.server";
import { getSharedFoldersForUser, getSharedFolderIdsInWorkspace } from "~/lib/sharing.server";
import { getSharedDocsForUser, getDirectlySharedDocIds } from "~/lib/doc-sharing.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { db, prep } from "~/lib/db.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { AppShell } from "~/components/AppShell";
import { ConfirmModal } from "~/components/ConfirmModal";
import { MoveDialog } from "~/components/MoveDialog";
import { ShareDialog } from "~/components/ShareDialog";
import { DndProvider } from "~/components/dnd/DndProvider";
import { useDndMove } from "~/components/dnd/useDndMove";
import { ActionsMenu } from "~/components/ActionsMenu";
import { UserMenu } from "~/components/UserMenu";
import { ImportDropZone } from "~/components/ImportDropZone";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { FolderIcon } from "~/components/icons";
import { NewButton } from "~/components/NewButton";
import { armUndoCreate } from "~/lib/undoCreate";
import { FolderRow } from "~/components/FolderRow";
import { DocRow } from "~/components/DocRow";
import { NewFolderRow } from "~/components/NewFolderRow";
import { BulkActionBar } from "~/components/BulkActionBar";
import { useSessionUser } from "~/root";
import { useMemo } from "react";
import { useImport } from "~/components/hooks/useImport";
import { useSortState } from "~/components/hooks/useSortState";
import { useDocListState } from "~/components/hooks/useDocListState";
import { timeAgo } from "~/lib/ui-utils";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.workspace.name ?? "Workspace"} — loica` },
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  // Admin can view any workspace via ?ws=<id>
  const url = new URL(request.url);
  const wsParam = url.searchParams.get("ws");
  const pageParam = parseInt(url.searchParams.get("page") ?? "1");
  const page = Math.max(1, pageParam);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  let workspace: import("~/lib/workspace.server").Workspace | null = null;

  if (wsParam && user.is_admin) {
    workspace = getWorkspace(wsParam);
    if (!workspace) throw new Response("Workspace not found", { status: 404 });
  } else {
    const workspaces = getUserPersonalWorkspaces(user.id);
    if (workspaces.length === 0) throw redirect("/");
    workspace = workspaces[0];
  }

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const { documents, total } = getWorkspaceDocumentsPage(workspace.id, null, pageSize, offset, user.id);
  const folders = getFoldersAtLevel(workspace.id, null);
  const rootDocs = prep<{ id: string; title: string }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(workspace.id);
  const allFolders = getAllWorkspaceFolders(workspace.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedFolderIds = Array.from(getSharedFolderIdsInWorkspace(workspace.id));
  const starredDocs = getStarredDocs(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const directlySharedDocIds = Array.from(getDirectlySharedDocIds(workspace.id));
  const storageBytes = getWorkspaceStorageBytes(workspace.id);
  const teamspaces = getTeamspacesForUser(user.id);
  return { workspace, role, documents, folders, allFolders, sharedFolders, sharedFolderIds, starredDocs, sharedCount, directlySharedDocIds, storageBytes, teamspaces, page, pageSize, totalDocs: total, rootDocs };
}

export async function action({ request }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const url = new URL(request.url);
  const wsParam = url.searchParams.get("ws");
  let workspace: import("~/lib/workspace.server").Workspace | null = null;

  if (wsParam && user.is_admin) {
    workspace = getWorkspace(wsParam);
    if (!workspace) throw new Response("Not found", { status: 404 });
  } else {
    const workspaces = getUserPersonalWorkspaces(user.id);
    if (workspaces.length === 0) throw new Response("Not found", { status: 404 });
    workspace = workspaces[0];
  }

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace, role, form, request };

  return dispatchAction(ctx, intent, {
    docUrl: (id) => `/w/doc/${id}`,
    ownerRoles: ["owner"],
  });
}

export default function WorkspaceDashboard() {
  const { workspace, role, documents, folders, allFolders, sharedFolders, sharedFolderIds, starredDocs, sharedCount, directlySharedDocIds, storageBytes, teamspaces, page, pageSize, totalDocs, rootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const navigate = useNavigate();
  const canEdit = role === "owner" || role === "editor";
  const isOwner = role === "owner";
  const { handleMove } = useDndMove();
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

  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

  const isEmpty = folders.length === 0 && documents.length === 0;

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "workspace", id: workspace.id }}
      workspaceName={workspace.name}
      storageBytes={storageBytes}
      sharedCount={sharedCount}
      teamspaces={teamspaces}
      workspaceId={workspace.id}
      rootFolders={folders}
      rootDocs={rootDocs}
    />
  );

  return (
    <DndProvider onMove={handleMove} allFolders={allFolders}>
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <ImportDropZone onImport={handleImport} onUploadFile={handleUploadFile} onUploadFiles={handleUploadFiles}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6" onClick={handleContainerClick}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="section-header">{workspace.name}</h1>
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
        {isEmpty && !creatingNewFolder && sharedFolders.length === 0 ? (
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
                href={`/w/folder/${f.id}`}
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
                onClick={(e) => handleRowClick(e, `/w/folder/${f.id}`)}
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
                href={`/w/doc/${doc.id}`}
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
                onClick={(e) => handleRowClick(e, `/w/doc/${doc.id}`)}
              />
            ))}

            {/* Pagination controls — only shown if there are documents or multiple pages */}
            {(totalDocs > 0) && (
              <div className="pagination">
                <span>Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  {hasPrevPage && (
                    <Link to={`/w?page=${page - 1}`} className="pagination-link">
                      Previous
                    </Link>
                  )}
                  {hasNextPage && (
                    <Link to={`/w?page=${page + 1}`} className="pagination-link">
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
            currentWorkspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "personal" }}
            otherWorkspaces={teamspaces.map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const }))}
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
              const sharedDocs = selectedDocs.filter((d) => d.public_token || d.edit_token);
              setConfirmAction({
                type: "unshare-doc",
                id: sharedDocs.map((d) => d.id).join(","),
                title: `${sharedDocs.length} document${sharedDocs.length > 1 ? "s" : ""}`,
              });
            }}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

        {/* Confirm modal */}
        {confirmAction && (
          <ConfirmModal
            title={
              confirmAction.type === "delete-doc" ? "Delete document" :
              confirmAction.type === "delete-folder" ? "Delete folder" :
              confirmAction.type === "unshare-doc" ? "Remove public access" :
              confirmAction.type === "leave-folder" ? "Leave shared folder" :
              "Remove all shares"
            }
            message={
              confirmAction.type === "delete-doc"
                ? `Are you sure you want to delete "${confirmAction.title}"? This will be moved to trash.`
                : confirmAction.type === "delete-folder"
                ? `Are you sure you want to delete "${confirmAction.title}" and all its contents? This will be moved to trash.`
                : confirmAction.type === "unshare-doc"
                ? `Remove public access from "${confirmAction.title}"? Anyone with the link will lose access.`
                : confirmAction.type === "leave-folder"
                ? `Remove "${confirmAction.title}" from your workspace? You will lose access unless shared again.`
                : `Remove all shares from "${confirmAction.title}"? Shared users will lose access.`
            }
            confirmLabel={
              confirmAction.type === "leave-folder" ? "Leave" :
              confirmAction.type.startsWith("delete") ? "Delete" : "Unshare"
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
    </AppShell>
    </DndProvider>
  );
}
