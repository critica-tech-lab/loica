import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/workspace";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getUserPersonalWorkspaces,
  getWorkspace,
  getMembership,
  getWorkspaceOwnerName,
} from "~/lib/workspace.server";
import { appError } from "~/lib/errors";
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
import { prep } from "~/lib/db.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { AppShell } from "~/components/AppShell";
import { DndProvider } from "~/components/dnd/DndProvider";
import { useDndMove } from "~/components/dnd/useDndMove";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { useSessionUser } from "~/root";
import { WorkspaceListView } from "~/components/WorkspaceListView";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: `${loaderData?.workspace.name ?? "Workspace"} — loica` },
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
  if (!role)
    throw appError("no_workspace_access", {
      subject: workspace.name,
      owner: getWorkspaceOwnerName(workspace.id),
    });

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
  if (!role)
    throw appError("no_workspace_access", {
      subject: workspace.name,
      owner: getWorkspaceOwnerName(workspace.id),
    });
  if (role === "viewer")
    throw appError("read_only", {
      subject: workspace.name,
      owner: getWorkspaceOwnerName(workspace.id),
    });

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
  const canEdit = role === "owner" || role === "editor";
  const isOwner = role === "owner";
  const { handleMove } = useDndMove();

  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

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
        <WorkspaceListView
          basePath="/w"
          headerContent={<h1 className="section-header">{workspace.name}</h1>}
          documents={documents}
          folders={folders}
          allFolders={allFolders}
          sharedFolders={sharedFolders}
          sharedFolderIds={sharedFolderIds}
          starredDocs={starredDocs}
          directlySharedDocIds={directlySharedDocIds}
          canEdit={canEdit}
          isOwner={isOwner}
          page={page}
          pageSize={pageSize}
          totalDocs={totalDocs}
          currentWorkspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "personal" }}
          otherWorkspaces={teamspaces.map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const }))}
        />
      </AppShell>
    </DndProvider>
  );
}
