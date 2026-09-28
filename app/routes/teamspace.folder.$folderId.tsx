import { useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace.folder.$folderId";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getWorkspace,
  getMembership,
  getUserPersonalWorkspaces,
} from "~/lib/workspace.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { getDirectlySharedDocIds } from "~/lib/doc-sharing.server";
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
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { FolderListView } from "~/components/FolderListView";
import { useSessionUser } from "~/root";


export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const d = loaderData as { folder?: { name?: string }; workspace?: { name?: string } } | undefined;
  return [
    { title: `${d?.folder?.name ?? "Folder"} — ${d?.workspace?.name ?? "Teamspace"} teamspace — loica` },
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

  const workspace = getWorkspace(params.workspaceId);
  if (!workspace || workspace.type !== "team") throw new Response("Teamspace not found", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const folder = getFolder(params.folderId);
  if (!folder) throw new Response("Folder not found", { status: 404 });
  if (folder.workspace_id !== workspace.id) throw new Response("Folder not found", { status: 404 });

  const folders = getFoldersAtLevel(workspace.id, folder.id);
  const { documents, total } = getWorkspaceDocumentsPage(workspace.id, folder.id, pageSize, offset, user.id);
  const folderPath = getFolderPath(folder.id);
  const allFolders = getAllWorkspaceFolders(workspace.id);
  const userGroups = getUserGroups(user.id);

  const starredDocs = getStarredDocs(user.id);
  const directlySharedDocIds = Array.from(getDirectlySharedDocIds(workspace.id));
  const personalWorkspaces = getUserPersonalWorkspaces(user.id);
  const personalWsId = personalWorkspaces.length > 0 ? personalWorkspaces[0].id : workspace.id;
  const personalWsName = personalWorkspaces.length > 0 ? personalWorkspaces[0].name : "";
  const teamspaces = getTeamspacesForUser(user.id);
  return { workspace, role, folder, folders, documents, folderPath, allFolders, userGroups, starredDocs, directlySharedDocIds, page, pageSize, totalDocs: total, personalWsId, personalWsName, teamspaces };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const workspace = getWorkspace(params.workspaceId);
  if (!workspace || workspace.type !== "team") throw new Response("Teamspace not found", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  const folder = getFolder(params.folderId);
  if (!folder) throw new Response("Folder not found", { status: 404 });
  if (folder.workspace_id !== workspace.id) throw new Response("Folder not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace, role, form, request };

  return dispatchAction(ctx, intent, {
    folderId: folder.id,
    docUrl: (id) => `/t/${workspace.id}/doc/${id}`,
    ownerRoles: ["owner", "admin"],
    folderRedirect: {
      currentFolderId: folder.id,
      redirectPath: (target) => target ? `/t/${workspace.id}/folder/${target}` : `/t/${workspace.id}`,
    },
  });
}

export default function TeamspaceFolderView() {
  const { workspace, role, folder, folders, documents, folderPath, allFolders, starredDocs, directlySharedDocIds, page, pageSize, totalDocs, personalWsId, personalWsName, teamspaces } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string; success?: string } | undefined;
  const user = useSessionUser();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const isOwner = role === "owner" || role === "admin";

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: workspace.id }}
      activeItemId={folder.id}
      workspaceName={personalWsName}
      workspaceId={personalWsId}
      lazy
    />
  );

  return (
    <FolderListView
      basePath={`/t/${workspace.id}`}
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
      canShareFolders={false}
      currentWorkspaceForMove={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "team" }}
      otherWorkspacesForMove={[
        { id: personalWsId, name: personalWsName || "My workspace", type: "personal" as const },
        ...teamspaces.filter((t) => t.id !== workspace.id).map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const })),
      ]}
    />
  );
}
