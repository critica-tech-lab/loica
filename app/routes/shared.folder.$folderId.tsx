import { Form, redirect, useLoaderData, useNavigation, useActionData, useFetcher } from "react-router";
import { useToast } from "~/components/Toast";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/shared.folder.$folderId";
import { getSessionUser } from "~/lib/auth.server";
import {
  getWorkspaceDocuments,
  createDocument,
  trashDocument,
  getDocument,
  moveDocument,
  getStarredDocs,
  toggleStar,
  getRecentDocsInFolderTree,
} from "~/lib/document.server";
import {
  getFolder,
  getFoldersAtLevel,
  getFolderPath,
  getSubtreeFolders,
  createFolder,
  trashFolder,
  renameFolder,
  moveFolder,
} from "~/lib/folder.server";
import { getWorkspace } from "~/lib/workspace.server";
import { hasSharedAccess, findSharedRootFolder, getSharedAccessInfo } from "~/lib/sharing.server";
import { AppShell } from "~/components/AppShell";
import { ConfirmModal } from "~/components/ConfirmModal";
import { UserMenu } from "~/components/UserMenu";
import { MoveDialog } from "~/components/MoveDialog";
import { DndProvider } from "~/components/dnd/DndProvider";
import { Draggable } from "~/components/dnd/Draggable";
import { Droppable } from "~/components/dnd/Droppable";
import { useDndMove } from "~/components/dnd/useDndMove";
import { FolderIcon, SharedFolderIcon, DocIcon, PdfIcon, DocAddIcon, FolderAddIcon, ChevronRight, StarIcon } from "~/components/icons";
import { ActionsMenu } from "~/components/ActionsMenu";
import { useSessionUser } from "~/root";
import { useState, useMemo } from "react";
import { timeAgo, randomDocName } from "~/lib/ui-utils";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as Record<string, any> | undefined;
  return [{ title: `${d?.folder.name ?? "Folder"} (shared) — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const folder = getFolder(params.folderId);
  if (!folder) throw new Response("Folder not found", { status: 404 });

  const accessInfo = getSharedAccessInfo(folder.id, user.id);
  if (!accessInfo.hasAccess)
    throw new Response("Forbidden", { status: 403 });

  const workspace = getWorkspace(folder.workspace_id);
  if (!workspace) throw new Response("Workspace not found", { status: 404 });

  const folders = getFoldersAtLevel(workspace.id, folder.id);
  const documents = getWorkspaceDocuments(workspace.id, folder.id);
  const folderPath = getFolderPath(folder.id);

  const sharedRootId = accessInfo.sharedRootId ?? folder.id;
  const allFolders = getSubtreeFolders(sharedRootId);

  const starredDocs = getStarredDocs(user.id);
  const recentDocs = getRecentDocsInFolderTree(folder.id, 5);
  return { workspace, folder, folders, documents, folderPath, starredDocs, recentDocs, sharedRootId, allFolders };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const folder = getFolder(params.folderId);
  if (!folder) throw new Response("Folder not found", { status: 404 });

  if (!hasSharedAccess(folder.id, user.id))
    throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle-star") {
    const docId = String(form.get("docId") || "");
    const newState = toggleStar(user.id, docId);
    return { starred: newState };
  }

  if (intent === "create-doc") {
    const title = String(form.get("title") || randomDocName()).trim();
    const doc = createDocument(folder.workspace_id, user.id, title, folder.id);
    throw redirect(`/shared/doc/${doc.id}`);
  }

  if (intent === "create-folder") {
    const name = String(form.get("name") || "").trim();
    if (name) createFolder(folder.workspace_id, user.id, name, folder.id);
    return null;
  }

  if (intent === "delete-doc") {
    const docId = String(form.get("docId"));
    const doc = getDocument(docId);
    if (doc && doc.workspace_id === folder.workspace_id && doc.folder_id && hasSharedAccess(doc.folder_id, user.id)) {
      trashDocument(docId, user.id);
    }
    return null;
  }

  if (intent === "delete-folder") {
    const fid = String(form.get("folderId"));
    const target = getFolder(fid);
    if (target && target.workspace_id === folder.workspace_id && hasSharedAccess(fid, user.id)) {
      trashFolder(fid, user.id);
      if (fid === folder.id) {
        throw redirect("/shared");
      }
    }
    return null;
  }

  if (intent === "rename-folder") {
    const fid = String(form.get("folderId"));
    const target = getFolder(fid);
    if (!target || target.workspace_id !== folder.workspace_id || !hasSharedAccess(fid, user.id)) return null;
    const name = String(form.get("name") || "").trim();
    if (name) renameFolder(fid, name);
    return null;
  }

  if (intent === "move-doc") {
    const docId = String(form.get("docId"));
    const doc = getDocument(docId);
    if (!doc || doc.workspace_id !== folder.workspace_id) return null;
    // Source must be within the shared subtree
    if (!doc.folder_id || !hasSharedAccess(doc.folder_id, user.id)) return null;
    const targetFolderId = String(form.get("targetFolderId") || "");
    // Must move to a folder (not workspace root — that's outside the shared subtree)
    if (!targetFolderId) return null;
    const tf = getFolder(targetFolderId);
    if (!tf || tf.workspace_id !== folder.workspace_id) return null;
    if (!hasSharedAccess(targetFolderId, user.id)) return null;
    moveDocument(docId, targetFolderId);
    return null;
  }

  if (intent === "move-folder") {
    const fid = String(form.get("folderId"));
    const f = getFolder(fid);
    if (!f || f.workspace_id !== folder.workspace_id) return null;
    if (!hasSharedAccess(fid, user.id)) return null;
    // Find the shared root so we can prevent moving it
    const sharedRootId = findSharedRootFolder(fid, user.id);
    if (fid === sharedRootId) return null; // Can't move the shared root itself
    const targetFolderId = String(form.get("targetFolderId") || "");
    // Must move to a folder within the shared subtree (not workspace root)
    if (!targetFolderId) return null;
    const tf = getFolder(targetFolderId);
    if (!tf || tf.workspace_id !== folder.workspace_id) return null;
    if (!hasSharedAccess(targetFolderId, user.id)) return null;
    try {
      moveFolder(fid, targetFolderId);
    } catch {
      // circular move — ignore
    }
    return null;
  }

  return null;
}

export default function SharedFolderView() {
  const { workspace, folder, folders, documents, folderPath, starredDocs, recentDocs, sharedRootId, allFolders } =
    useLoaderData<typeof loader>();
  const user = useSessionUser();
  const nav = useNavigation();
  const { toast } = useToast();
  const starFetcher = useFetcher();
  const starredSet = useMemo(() => new Set(starredDocs.map((d) => d.id)), [starredDocs]);
  const creatingDoc =
    nav.state === "submitting" && nav.formData?.get("intent") === "create-doc";
  const { handleMove } = useDndMove();
  const [moveItem, setMoveItem] = useState<{
    type: "doc" | "folder";
    id: string;
    currentFolderId: string | null;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete-doc" | "delete-folder";
    id: string;
    title: string;
  } | null>(null);
  const confirmFetcher = useFetcher();

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  return (
    <DndProvider onMove={handleMove} allFolders={allFolders}>
    <AppShell navActions={navActions} scrollable tone="drive">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <nav className="flex flex-wrap items-center gap-1.5 text-xs">
            <a
              href="/shared"
              className="rounded px-1.5 py-0.5 no-underline text-fg/50 hover:bg-fg/5 hover:text-fg/80"
            >
              Shared
            </a>
            {folderPath.map((seg) => (
              <span key={seg.id} className="flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3 text-fg/20" />
                {seg.id === folder.id ? (
                  <span className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-base font-bold text-fg">
                    <SharedFolderIcon className="h-4 w-4 text-sage/70" />
                    {seg.name}
                  </span>
                ) : (
                  <Droppable target={{ type: "folder", id: seg.id }}>
                    {({ dropRef, isOver, isInvalid }) => (
                      <a
                        ref={dropRef}
                        href={`/shared/folder/${seg.id}`}
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
                )}
              </span>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Form method="post">
              <input type="hidden" name="intent" value="create-doc" />
              <button
                type="submit"
                disabled={creatingDoc}
                className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-xs text-accent/40 transition-colors hover:text-accent/70 disabled:opacity-30"
              >
                <DocAddIcon className="h-3.5 w-3.5" />
                {creatingDoc ? "Creating…" : "Doc"}
              </button>
            </Form>
            <button
              type="button"
              onClick={() => setCreatingNewFolder(true)}
              className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-xs text-tawny/40 transition-colors hover:text-tawny/70"
            >
              <FolderAddIcon className="h-3.5 w-3.5" />
              Folder
            </button>
          </div>
        </div>

        {/* Recently modified */}
        {recentDocs.length > 0 && (
          <div>
            <h2 className="m-0 mb-3 text-xs font-medium uppercase tracking-wider text-fg/30">
              Recently modified
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {recentDocs.map((doc) => (
                <a
                  key={doc.id}
                  href={`/shared/doc/${doc.id}`}
                  className="group/recent flex flex-col gap-1 rounded-lg border border-fg/[0.08] px-3 py-2.5 no-underline transition-colors hover:border-fg/15 hover:bg-fg/[0.03]"
                >
                  <span className="flex items-center gap-1.5">
                    {doc.pdf_file ? <PdfIcon className="h-3.5 w-3.5 shrink-0 text-scarlet/60" /> : <DocIcon className="h-3.5 w-3.5 shrink-0 text-fg/25" />}
                    <span className="truncate text-sm font-medium text-fg">
                      {doc.title}
                    </span>
                  </span>
                  <span className="text-[0.65rem] text-fg/30">
                    {timeAgo(doc.updated_at)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Content — unified list (same design as workspace folder view) */}
        <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
          {/* Table header */}
          <div className="flex items-center border-b border-fg/[0.06] bg-fg/[0.02] px-4 py-2 text-xs font-medium text-fg/40">
            <span className="ml-7 flex-1">Name</span>
            <span className="w-24 shrink-0 text-right">Modified</span>
            <span className="w-10 shrink-0" />
          </div>

          {/* New folder inline row */}
          {creatingNewFolder && (
            <Form
              method="post"
              onSubmit={() => setCreatingNewFolder(false)}
              className="flex items-center gap-3 border-b border-fg/[0.06] px-4 py-2.5"
            >
              <input type="hidden" name="intent" value="create-folder" />
              <FolderIcon className="h-4 w-4 shrink-0 text-accent/50" />
              <input
                name="name"
                autoFocus
                placeholder="Folder name…"
                className="flex-1 rounded border border-fg/15 bg-bg px-2 py-1 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
                onBlur={() => setCreatingNewFolder(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setCreatingNewFolder(false);
                }}
              />
            </Form>
          )}

          {/* Subfolders */}
          {folders.map((f, i) => (
            <Draggable
              key={f.id}
              item={{ type: "folder", id: f.id, title: f.name, currentFolderId: f.parent_id }}
            >
              {({ dragRef, isDragging, attributes, listeners }) => (
                <Droppable target={{ type: "folder", id: f.id }}>
                  {({ dropRef, isOver, isInvalid }) => (
                    <div
                      ref={(el) => { dragRef(el); dropRef(el); }}
                      {...attributes}
                      {...listeners}
                      className={`group flex items-center transition-colors
                        ${isDragging ? "opacity-30" : ""}
                        ${isOver && !isInvalid ? "bg-accent/5 ring-2 ring-inset ring-accent/30" : ""}
                        ${isInvalid ? "bg-scarlet/5 ring-2 ring-inset ring-scarlet/30" : ""}
                        ${!isDragging && !isOver ? "hover:bg-fg/[0.04]" : ""}
                        ${(i > 0 || creatingNewFolder) ? "border-t border-fg/[0.06]" : ""}
                      `}
                    >
                      {renamingId === f.id ? (
                        <div className="flex flex-1 items-center gap-3 px-4 py-2.5">
                          <FolderIcon className="h-4 w-4 shrink-0 text-fg/40" />
                          <Form
                            method="post"
                            className="flex-1"
                            onSubmit={() => setRenamingId(null)}
                          >
                            <input type="hidden" name="intent" value="rename-folder" />
                            <input type="hidden" name="folderId" value={f.id} />
                            <input
                              name="name"
                              defaultValue={f.name}
                              autoFocus
                              className="w-full rounded border border-accent/40 bg-bg px-2 py-0.5 text-sm text-fg outline-none"
                              onBlur={() => setRenamingId(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                            />
                          </Form>
                        </div>
                      ) : (
                        <a
                          href={`/shared/folder/${f.id}`}
                          className="flex flex-1 items-center gap-3 px-4 py-2.5 no-underline text-fg"
                        >
                          <FolderIcon className="h-4 w-4 shrink-0 text-fg/40" />
                          <span className="flex-1 truncate text-sm font-medium">{f.name}</span>
                        </a>
                      )}
                      <span className="w-24 shrink-0 text-right text-xs text-fg/30">—</span>
                      <div className="flex w-10 shrink-0 items-center justify-end pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <ActionsMenu
                          itemType="folder"
                          itemId={f.id}
                          canEdit={true}
                          isOwner={false}
                          onRename={() => setRenamingId(f.id)}
                          onMove={() => setMoveItem({ type: "folder", id: f.id, currentFolderId: f.parent_id })}
                          onShare={() => {}}
                          onDelete={() => setConfirmAction({ type: "delete-folder", id: f.id, title: f.name })}
                        />
                      </div>
                    </div>
                  )}
                </Droppable>
              )}
            </Draggable>
          ))}

          {/* Documents */}
          {documents.map((doc) => {
            const isDocShared = !!(doc.public_token || doc.edit_token);
            return (
            <Draggable
              key={doc.id}
              item={{ type: "doc", id: doc.id, title: doc.title, currentFolderId: doc.folder_id }}
            >
              {({ dragRef, isDragging, attributes, listeners }) => (
                <div
                  ref={dragRef}
                  {...attributes}
                  {...listeners}
                  className={`group flex items-center transition-colors
                    ${isDragging ? "opacity-30" : ""}
                    ${!isDragging ? "hover:bg-fg/[0.04]" : ""}
                    border-t border-fg/[0.06]
                  `}
                >
                  <a
                    href={`/shared/doc/${doc.id}`}
                    className="flex flex-1 items-center gap-3 px-4 py-2.5 no-underline text-fg"
                  >
                    {doc.pdf_file ? <PdfIcon className="h-4 w-4 shrink-0 text-scarlet/60" /> : <DocIcon className={`h-4 w-4 shrink-0 ${isDocShared ? "text-accent/50" : "text-fg/25"}`} />}
                    <span className="flex flex-1 items-center gap-2 truncate text-sm font-medium">
                      {starredSet.has(doc.id) && (
                        <StarIcon filled className="h-3.5 w-3.5 shrink-0 text-star" />
                      )}
                      {doc.title}
                      {isDocShared && (
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[0.6rem] text-accent/60">
                          public
                        </span>
                      )}
                    </span>
                  </a>
                  <span className="w-24 shrink-0 text-right text-xs text-fg/30">
                    {timeAgo(doc.updated_at)}
                  </span>
                  <div className="flex w-10 shrink-0 items-center justify-end pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <ActionsMenu
                      itemType="doc"
                      itemId={doc.id}
                      canEdit={true}
                      isOwner={false}
                      isShared={isDocShared}
                      isStarred={starredSet.has(doc.id)}
                      onRename={() => {}}
                      onMove={() => setMoveItem({ type: "doc", id: doc.id, currentFolderId: doc.folder_id })}
                      onShare={() => {}}
                      onDelete={() => setConfirmAction({ type: "delete-doc", id: doc.id, title: doc.title })}
                      onToggleStar={() => starFetcher.submit({ intent: "toggle-star", docId: doc.id }, { method: "post" })}
                    />
                  </div>
                </div>
              )}
            </Draggable>
          )})}

          {/* Empty state */}
          {folders.length === 0 && documents.length === 0 && !creatingNewFolder && (
            <div className="px-4 py-10 text-center">
              <p className="m-0 text-sm opacity-30">This folder is empty.</p>
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
            rootFolderId={sharedRootId}
          />
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          title={
            confirmAction.type === "delete-doc" ? "Delete document" : "Delete folder"
          }
          message={
            confirmAction.type === "delete-doc"
              ? `Are you sure you want to delete "${confirmAction.title}"? This will be moved to trash.`
              : `Are you sure you want to delete "${confirmAction.title}" and all its contents? This will be moved to trash.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const { type, id } = confirmAction;
            if (type === "delete-doc") {
              confirmFetcher.submit(
                { intent: "delete-doc", docId: id },
                { method: "post" },
              );
              toast("Moved to trash", "success");
            } else {
              confirmFetcher.submit(
                { intent: "delete-folder", folderId: id },
                { method: "post" },
              );
              toast("Folder moved to trash", "success");
            }
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </AppShell>
    </DndProvider>
  );
}
