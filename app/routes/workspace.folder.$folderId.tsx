import { Form, redirect, useLoaderData, useActionData, useFetcher, Link } from "react-router";
import { useToast } from "~/components/Toast";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/workspace.folder.$folderId";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getWorkspace,
  getMembership,
  getWorkspaceOwnerName,
} from "~/lib/workspace.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import {
  getWorkspaceDocumentsPage,
  getStarredDocs,
} from "~/lib/document.server";
import {
  getFolder,
  getFoldersAtLevel,
  getFolderPath,
  getAllWorkspaceFolders,
} from "~/lib/folder.server";
import { getUserGroups } from "~/lib/group.server";
import { getFolderShares, getSharedFolderIdsInWorkspace, hasSharedAccess } from "~/lib/sharing.server";
import { appError } from "~/lib/errors";
import { getDirectlySharedDocIds } from "~/lib/doc-sharing.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { AppShell } from "~/components/AppShell";
import { ConfirmModal } from "~/components/ConfirmModal";
import { UserMenu } from "~/components/UserMenu";
import { MoveDialog } from "~/components/MoveDialog";
import { ShareDialog } from "~/components/ShareDialog";
import { DndProvider } from "~/components/dnd/DndProvider";
import { Droppable } from "~/components/dnd/Droppable";
import { useDndMove } from "~/components/dnd/useDndMove";
import { ChevronRight, ShareIcon, HomeIcon, FolderIcon, SharedFolderIcon, DocIcon } from "~/components/icons";
import { ImportDropZone } from "~/components/ImportDropZone";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { NewButton } from "~/components/NewButton";
import { armUndoCreate } from "~/lib/undoCreate";
import { FolderRow } from "~/components/FolderRow";
import { DocRow } from "~/components/DocRow";
import { NewFolderRow } from "~/components/NewFolderRow";
import { useSessionUser } from "~/root";
import { useState, useMemo } from "react";
import { useImport } from "~/components/hooks/useImport";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as { folder?: { name?: string }; workspace?: { name?: string } } | undefined;
  return [
    { title: `${d?.folder?.name ?? "Folder"} — ${d?.workspace?.name ?? "Workspace"} — loica` },
  ];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const url = new URL(request.url);
  const pageParam = parseInt(url.searchParams.get("page") ?? "1");
  const page = Math.max(1, pageParam);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const folder = getFolder(params.folderId);
  if (!folder) throw appError("folder_not_found");

  const workspace = getWorkspace(folder.workspace_id);
  if (!workspace) throw appError("workspace_not_found");

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) {
    // Not a member — but they may still hold a share on this folder, in which case
    // the shared view is the right home for them rather than a dead end (#93).
    if (hasSharedAccess(folder.id, user.id)) throw redirect(`/shared/folder/${folder.id}`);
    throw appError("no_folder_access", {
      subject: folder.name,
      owner: getWorkspaceOwnerName(workspace.id),
    });
  }

  const folders = getFoldersAtLevel(workspace.id, folder.id);
  const { documents, total } = getWorkspaceDocumentsPage(workspace.id, folder.id, pageSize, offset, user.id);
  const folderPath = getFolderPath(folder.id);
  const allFolders = getAllWorkspaceFolders(workspace.id);
  const folderShares = getFolderShares(folder.id);
  const userGroups = getUserGroups(user.id);

  const sharedFolderIds = Array.from(getSharedFolderIdsInWorkspace(workspace.id));
  const starredDocs = getStarredDocs(user.id);
  const directlySharedDocIds = Array.from(getDirectlySharedDocIds(workspace.id));
  const teamspaces = getTeamspacesForUser(user.id);
  return { workspace, role, folder, folders, documents, folderPath, allFolders, folderShares, userGroups, sharedFolderIds, starredDocs, directlySharedDocIds, page, pageSize, totalDocs: total, teamspaces };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const folder = getFolder(params.folderId);
  if (!folder) throw appError("folder_not_found");

  const workspace = getWorkspace(folder.workspace_id);
  if (!workspace) throw appError("workspace_not_found");

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw appError("no_folder_access", { subject: folder.name, owner: getWorkspaceOwnerName(workspace.id) });
  if (role === "viewer") throw appError("read_only", { subject: workspace.name, owner: getWorkspaceOwnerName(workspace.id) });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace, role, form, request };

  return dispatchAction(ctx, intent, {
    folderId: folder.id,
    docUrl: (id) => `/w/doc/${id}`,
    ownerRoles: ["owner"],
    folderRedirect: {
      currentFolderId: folder.id,
      redirectPath: (target) => target ? `/w/folder/${target}` : `/w`,
    },
  });
}

export default function FolderView() {
  const { workspace, role, folder, folders, documents, folderPath, allFolders, folderShares, userGroups, sharedFolderIds, starredDocs, directlySharedDocIds, page, pageSize, totalDocs, teamspaces } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string; success?: string } | undefined;
  const user = useSessionUser();
  const { toast } = useToast();
  const starFetcher = useFetcher();
  const starredSet = useMemo(() => new Set(starredDocs.map((d) => d.id)), [starredDocs]);
  const directlySharedSet = useMemo(() => new Set(directlySharedDocIds), [directlySharedDocIds]);
  const canEdit = role === "owner" || role === "editor";
  const sharedSet = new Set(sharedFolderIds);
  const isOwner = role === "owner";
  const { handleMove } = useDndMove();
  const totalPages = Math.ceil(totalDocs / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;
  const [moveItem, setMoveItem] = useState<{
    type: "doc" | "folder";
    id: string;
    currentFolderId: string | null;
  } | null>(null);
  const [shareItem, setShareItem] = useState<{ type: "doc" | "folder"; id: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete-doc" | "delete-folder" | "unshare-doc" | "unshare-folder";
    id: string;
    title: string;
  } | null>(null);
  const confirmFetcher = useFetcher();
  const { handleImport, handleUploadFile, handleUploadFiles, duplicatePrompt, confirmDuplicate, cancelDuplicate } = useImport();

  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

  const createDocFetcher = useFetcher();
  const duplicateFetcher = useFetcher();
  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "workspace", id: workspace.id }}
      activeItemId={folder.id}
      workspaceName={workspace.name}
      workspaceId={workspace.id}
      expandAncestors={folderPath.map((seg) => seg.id)}
      lazy
    />
  );

  return (
    <DndProvider onMove={handleMove} allFolders={allFolders}>
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <ImportDropZone onImport={handleImport} onUploadFile={handleUploadFile} onUploadFiles={handleUploadFiles}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        {/* Compact breadcrumb */}
        <nav className="flex flex-wrap items-center gap-1 text-xs">
          <Droppable target={{ type: "root", id: null }} disabled={!canEdit}>
            {({ dropRef, isOver, isInvalid }) => (
              <a
                ref={dropRef}
                href="/w"
                className={`rounded px-1.5 py-0.5 no-underline transition-all
                  ${isOver && !isInvalid ? "bg-accent/10 text-fg ring-1 ring-accent/30" : ""}
                  ${isInvalid ? "bg-scarlet/5 text-fg ring-1 ring-scarlet/30" : ""}
                  ${!isOver ? "text-fg/50 hover:bg-fg/5 hover:text-fg/80" : ""}
                `}
              >
                <HomeIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </Droppable>
          {folderPath.slice(0, -1).map((seg) => (
            <span key={seg.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-fg/20" />
              <Droppable target={{ type: "folder", id: seg.id }} disabled={!canEdit}>
                {({ dropRef, isOver, isInvalid }) => (
                  <a
                    ref={dropRef}
                    href={`/w/folder/${seg.id}`}
                    className={`rounded px-1.5 py-0.5 no-underline transition-all
                      ${isOver && !isInvalid ? "bg-accent/10 text-fg ring-1 ring-accent/30" : ""}
                      ${isInvalid ? "bg-scarlet/5 text-fg ring-1 ring-scarlet/30" : ""}
                      ${!isOver ? "text-fg/50 hover:bg-fg/5 hover:text-fg/80" : ""}
                    `}
                  >
                    {seg.name}
                  </a>
                )}
              </Droppable>
            </span>
          ))}
        </nav>

        {/* Folder "place" header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-fg/10 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            {sharedSet.has(folder.id) ? (
              <SharedFolderIcon className="h-8 w-8 shrink-0 text-tawny/70" />
            ) : (
              <FolderIcon className="h-8 w-8 shrink-0 text-tawny/70" />
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-fg">{folder.name}</h1>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg/50">
                <span>{folders.length} {folders.length === 1 ? "folder" : "folders"}</span>
                <span className="text-fg/20">·</span>
                <span>{totalDocs} {totalDocs === 1 ? "doc" : "docs"}</span>
                {sharedSet.has(folder.id) && (
                  <>
                    <span className="text-fg/20">·</span>
                    <span className="rounded-full bg-sage/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-sage/70">
                      Shared
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowSharePanel((p) => !p)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-fg/10 bg-bg px-2.5 py-1.5 text-xs transition-colors ${
                  showSharePanel
                    ? "border-sage/40 text-sage"
                    : "text-fg/60 hover:border-sage/30 hover:text-sage"
                }`}
              >
                <ShareIcon className="h-3.5 w-3.5" />
                Share{folderShares.length > 0 ? ` · ${folderShares.length}` : ""}
              </button>
            )}
            {canEdit && (
              <NewButton
                onCreateDoc={() => {
                  armUndoCreate("doc", location.pathname);
                  createDocFetcher.submit({ intent: "create-doc" }, { method: "post" });
                }}
                onCreateFromTemplate={(templateId) => {
                  armUndoCreate(templateId, location.pathname);
                  createDocFetcher.submit({ intent: "create-doc", template: templateId }, { method: "post" });
                }}
                onCreateFolder={() => setCreatingNewFolder(true)}
                onImport={handleImport}
                onUploadFile={handleUploadFile}
                onUploadFiles={handleUploadFiles}
              />
            )}
          </div>
        </div>

        {/* Share feedback */}
        {actionData && "error" in actionData && (
          <div className="rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
            {actionData.error}
          </div>
        )}
        {actionData && "success" in actionData && typeof actionData.success === "string" && (
          <div className="rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage">
            {actionData.success}
          </div>
        )}

        {/* Share dialog modal */}
        {showSharePanel && isOwner && (
          <ShareDialog
            itemType="folder"
            itemId={folder.id}
            onClose={() => setShowSharePanel(false)}
          />
        )}

        {/* Doc share dialog */}
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

        {/* Content — unified list */}
        <div className="archive-list">
          {/* Table header */}
          <div className="archive-header">
            <span className="flex-1">Name</span>
            <span className="hidden w-20 shrink-0 text-right sm:block">Created</span>
            <span className="w-20 shrink-0 text-right">Modified</span>
            <span className="w-10 shrink-0" />
          </div>

          {/* New folder inline row */}
          {creatingNewFolder && (
            <NewFolderRow onDone={() => setCreatingNewFolder(false)} />
          )}

          {/* Subfolders */}
          {folders.map((f, i) => (
            <FolderRow
              key={f.id}
              folder={f}
              href={`/w/folder/${f.id}`}
              canEdit={canEdit}
              isOwner={isOwner}
              isShared={sharedSet.has(f.id)}
              isRenaming={renamingId === f.id}
              showBorder={i > 0 || creatingNewFolder}
              onRename={() => setRenamingId(f.id)}
              onRenameCancel={() => setRenamingId(null)}
              onMove={() => setMoveItem({ type: "folder", id: f.id, currentFolderId: f.parent_id })}
              onShare={() => {}}
              onDelete={() => setConfirmAction({ type: "delete-folder", id: f.id, title: f.name })}
              onUnshare={() => setConfirmAction({ type: "unshare-folder", id: f.id, title: f.name })}
            />
          ))}

          {/* Documents */}
          {documents.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              href={`/w/doc/${doc.id}`}
              canEdit={canEdit}
              isOwner={isOwner}
              pdfFile={doc.pdf_file}
              isStarred={starredSet.has(doc.id)}
              isDirectlyShared={directlySharedSet.has(doc.id)}
              isRenaming={renamingId === doc.id}
              onRename={() => setRenamingId(doc.id)}
              onRenameCancel={() => setRenamingId(null)}
              onShare={() => setShareItem({ type: "doc", id: doc.id })}
              onMove={() => setMoveItem({ type: "doc", id: doc.id, currentFolderId: doc.folder_id })}
              onDelete={() => setConfirmAction({ type: "delete-doc", id: doc.id, title: doc.title })}
              onUnshare={() => setConfirmAction({ type: "unshare-doc", id: doc.id, title: doc.title })}
              onToggleStar={() => starFetcher.submit({ intent: "toggle-star", docId: doc.id }, { method: "post" })}
              onDuplicate={() => duplicateFetcher.submit({ intent: "duplicate-doc", docId: doc.id }, { method: "post" })}
            />
          ))}

          {/* Pagination */}
          {(totalDocs > 0) && (
            <div className="pagination">
              <span className="flex-1">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-2">
                {hasPrevPage && (
                  <Link to={`/w/folder/${folder.id}?page=${page - 1}`} className="pagination-link">Previous</Link>
                )}
                {hasNextPage && (
                  <Link to={`/w/folder/${folder.id}?page=${page + 1}`} className="pagination-link">Next</Link>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {folders.length === 0 && documents.length === 0 && !creatingNewFolder && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="relative">
                <FolderIcon className="h-14 w-14 text-tawny/30" />
                <div className="absolute inset-0 animate-pulse rounded-full bg-tawny/5 blur-xl" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-fg/70">This folder is empty</p>
                {canEdit && (
                  <p className="text-xs text-fg/40">Create a doc, folder, or drop files in to get started.</p>
                )}
              </div>
              {canEdit && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      armUndoCreate("doc", location.pathname);
                      createDocFetcher.submit({ intent: "create-doc" }, { method: "post" });
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-cyan/30 bg-cyan/5 px-3 py-1.5 text-xs text-cyan hover:bg-cyan/10"
                  >
                    <DocIcon className="h-3.5 w-3.5" />
                    New doc
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingNewFolder(true)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-tawny/30 bg-tawny/5 px-3 py-1.5 text-xs text-tawny hover:bg-tawny/10"
                  >
                    <FolderIcon className="h-3.5 w-3.5" />
                    New folder
                  </button>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-fg/10 bg-bg px-3 py-1.5 text-xs text-fg/70 hover:border-fg/20 hover:text-fg">
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile(file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

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
                confirmFetcher.submit({ intent: "delete-doc", docId: id }, { method: "post" });
                toast("Moved to trash", "success");
              } else if (type === "delete-folder") {
                confirmFetcher.submit({ intent: "delete-folder", folderId: id }, { method: "post" });
                toast("Folder moved to trash", "success");
              } else if (type === "unshare-doc") {
                confirmFetcher.submit({ intent: "unshare-doc", docId: id }, { method: "post" });
                toast("Public access removed", "success");
              } else if (type === "unshare-folder") {
                confirmFetcher.submit({ intent: "unshare-all-folder", folderId: id }, { method: "post" });
                toast("Sharing removed", "success");
              }
              setConfirmAction(null);
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
