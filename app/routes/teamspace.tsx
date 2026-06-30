import { Form, redirect, useLoaderData, useActionData, useFetcher, Link } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace";
import { getSessionUser } from "~/lib/auth.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";
import {
  getWorkspaceDocumentsPage,
  getStarredDocs,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import {
  getFoldersAtLevel,
  getAllWorkspaceFolders,
} from "~/lib/folder.server";
import { updateTeamspaceIcon } from "~/lib/teamspace.server";
import { getDirectlySharedDocIds } from "~/lib/doc-sharing.server";
import { getSharedFolderIdsInWorkspace } from "~/lib/sharing.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { getUserPersonalWorkspaces } from "~/lib/workspace.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { db, prep } from "~/lib/db.server";
import { AppShell } from "~/components/AppShell";
import { ConfirmModal } from "~/components/ConfirmModal";
import { MoveDialog } from "~/components/MoveDialog";
import { ShareDialog } from "~/components/ShareDialog";
import { DndProvider } from "~/components/dnd/DndProvider";
import { useDndMove } from "~/components/dnd/useDndMove";
import { UserMenu } from "~/components/UserMenu";
import { ImportDropZone } from "~/components/ImportDropZone";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
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
import { TeamspaceIconPicker } from "~/components/TeamspaceIconPicker";


export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as { workspace?: { name?: string } } | undefined;
  return [{ title: `${d?.workspace?.name ?? "Teamspace"} teamspace — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const url = new URL(request.url);
  const pageParam = parseInt(url.searchParams.get("page") ?? "1");
  const page = Math.max(1, pageParam);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const workspace = getWorkspace(params.workspaceId);
  if (!workspace) throw new Response("Teamspace not found", { status: 404 });
  if (workspace.type !== "team") throw new Response("Not a teamspace", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const { documents, total } = getWorkspaceDocumentsPage(workspace.id, null, pageSize, offset, user.id);
  const folders = getFoldersAtLevel(workspace.id, null);
  const allFolders = getAllWorkspaceFolders(workspace.id);
  const sharedFolderIds = Array.from(getSharedFolderIdsInWorkspace(workspace.id));
  const starredDocs = getStarredDocs(user.id);
  const directlySharedDocIds = Array.from(getDirectlySharedDocIds(workspace.id));
  const storageBytes = getWorkspaceStorageBytes(workspace.id);
  const personalWorkspaces = getUserPersonalWorkspaces(user.id);
  const personalWsId = personalWorkspaces.length > 0 ? personalWorkspaces[0].id : workspace.id;
  const personalWsName = personalWorkspaces.length > 0 ? personalWorkspaces[0].name : "";
  const teamspaces = getTeamspacesForUser(user.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const sidebarRootFolders = getFoldersAtLevel(personalWsId, null);
  const sidebarRootDocs = prep<{ id: string; title: string; pdf_file?: string | null }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(personalWsId);
  return { workspace, role, documents, folders, allFolders, sharedFolderIds, starredDocs, directlySharedDocIds, storageBytes, page, pageSize, totalDocs: total, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const workspace = getWorkspace(params.workspaceId);
  if (!workspace) throw new Response("Teamspace not found", { status: 404 });
  if (workspace.type !== "team") throw new Response("Not a teamspace", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace, role, form, request };

  // Teamspace-specific: icon change
  if (intent === "change-icon") {
    const isTeamAdmin = role === "admin" || role === "owner" || user.is_admin;
    if (!isTeamAdmin) return { error: "Only admins can change the icon." };
    const icon = String(form.get("icon") || "").trim() || null;
    updateTeamspaceIcon(workspace.id, icon);
    return { success: "Icon updated." };
  }

  return dispatchAction(ctx, intent, {
    docUrl: (id) => `/t/${workspace.id}/doc/${id}`,
    ownerRoles: ["owner", "admin"],
  });
}

export default function TeamspaceDashboard() {
  const { workspace, role, documents, folders, allFolders, sharedFolderIds, starredDocs, directlySharedDocIds, storageBytes, page, pageSize, totalDocs, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const isOwner = role === "owner" || role === "admin";
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
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const isEmpty = folders.length === 0 && documents.length === 0;

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: workspace.id }}
      workspaceName={personalWsName}
      workspaceId={personalWsId}
      rootFolders={sidebarRootFolders}
      rootDocs={sidebarRootDocs}
      teamspaces={teamspaces}
      sharedCount={sharedCount}
      storageBytes={storageBytes}
    />
  );

  return (
    <DndProvider onMove={handleMove} allFolders={allFolders}>
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <ImportDropZone onImport={handleImport} onUploadFile={handleUploadFile} onUploadFiles={handleUploadFiles}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6" onClick={handleContainerClick}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TeamspaceIconPicker
              name={workspace.name}
              icon={workspace.icon ?? null}
              editable={isOwner}
              size="md"
            />
            <h1 className="section-header">{workspace.name} <span className="font-normal">teamspace</span></h1>
          </div>

          <div className="flex items-center gap-4">
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
                className="flex flex-1 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left text-xs font-medium text-fg/40 hover:text-fg/70"
              >
                Name {sortCol === "name" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </button>
              <button
                type="button"
                onClick={() => toggleSort("created")}
                className="hidden w-20 shrink-0 cursor-pointer items-center justify-end gap-1 border-none bg-transparent p-0 text-right text-xs font-medium text-fg/40 hover:text-fg/70 sm:flex"
              >
                Created {sortCol === "created" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </button>
              <button
                type="button"
                onClick={() => toggleSort("modified")}
                className="flex w-20 shrink-0 cursor-pointer items-center justify-end gap-1 border-none bg-transparent p-0 text-right text-xs font-medium text-fg/40 hover:text-fg/70"
              >
                Modified {sortCol === "modified" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </button>
              <span className="w-10 shrink-0" />
            </div>

            {/* New folder inline row */}
            {creatingNewFolder && (
              <NewFolderRow onDone={() => setCreatingNewFolder(false)} />
            )}

            {/* Folders */}
            {sortedFolders.map((f, i) => (
              <FolderRow
                key={f.id}
                folder={f}
                href={`/t/${workspace.id}/folder/${f.id}`}
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
                onClick={(e) => handleRowClick(e, `/t/${workspace.id}/folder/${f.id}`)}
              />
            ))}

            {/* Documents */}
            {sortedDocuments.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                href={`/t/${workspace.id}/doc/${doc.id}`}
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
                onClick={(e) => handleRowClick(e, `/t/${workspace.id}/doc/${doc.id}`)}
              />
            ))}

            {/* Pagination */}
            {(totalDocs > 0) && (
              <div className="pagination">
                <span className="flex-1">Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  {hasPrevPage && (
                    <Link to={`/t/${workspace.id}?page=${page - 1}`} className="pagination-link">Previous</Link>
                  )}
                  {hasNextPage && (
                    <Link to={`/t/${workspace.id}?page=${page + 1}`} className="pagination-link">Next</Link>
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
            currentWorkspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "team" }}
            otherWorkspaces={[
              { id: personalWsId, name: personalWsName || "My workspace", type: "personal" as const },
              ...teamspaces.filter((t) => t.id !== workspace.id).map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const })),
            ]}
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
              confirmAction.type === "delete-doc" ? "Move to trash" :
              confirmAction.type === "delete-folder" ? "Move folder to trash" :
              confirmAction.type === "unshare-doc" ? "Remove public access" :
              "Remove all shares"
            }
            message={
              confirmAction.type === "delete-doc"
                ? `Move "${confirmAction.title}" to trash? You can restore it within 30 days.`
                : confirmAction.type === "delete-folder"
                ? `Move "${confirmAction.title}" and all its contents to trash? You can restore it within 30 days.`
                : confirmAction.type === "unshare-doc"
                ? `Remove public access from "${confirmAction.title}"? Anyone with the link will lose access.`
                : `Remove all shares from "${confirmAction.title}"? Shared users will lose access.`
            }
            confirmLabel={
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
