import { redirect, useLoaderData, useActionData } from "react-router";
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
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { FolderListView } from "~/components/FolderListView";
import { useSessionUser } from "~/root";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const d = loaderData as { folder?: { name?: string }; workspace?: { name?: string } } | undefined;
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
  const { workspace, role, folder, folders, documents, folderPath, allFolders, folderShares, sharedFolderIds, starredDocs, directlySharedDocIds, page, pageSize, totalDocs, teamspaces } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string; success?: string } | undefined;
  const user = useSessionUser();
  const canEdit = role === "owner" || role === "editor";
  const isOwner = role === "owner";

  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

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
    <FolderListView
      basePath="/w"
      folder={folder}
      folders={folders}
      documents={documents}
      folderPath={folderPath}
      allFolders={allFolders}
      starredDocs={starredDocs}
      directlySharedDocIds={directlySharedDocIds}
      page={page}
      pageSize={pageSize}
      totalDocs={totalDocs}
      canEdit={canEdit}
      isOwner={isOwner}
      actionError={actionData && "error" in actionData ? actionData.error : undefined}
      actionSuccess={actionData && "success" in actionData && typeof actionData.success === "string" ? actionData.success : undefined}
      navActions={navActions}
      sidebar={sidebar}
      canShareFolders
      sharedFolderIds={sharedFolderIds}
      folderShareCount={folderShares.length}
      currentWorkspaceForMove={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "personal" }}
      otherWorkspacesForMove={teamspaces.map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const }))}
    />
  );
}
