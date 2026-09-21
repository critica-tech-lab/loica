import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
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
import { prep } from "~/lib/db.server";
import { AppShell } from "~/components/AppShell";
import { DndProvider } from "~/components/dnd/DndProvider";
import { useDndMove } from "~/components/dnd/useDndMove";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { useSessionUser } from "~/root";
import { WorkspaceListView } from "~/components/WorkspaceListView";
import { TeamspaceIconPicker } from "~/components/TeamspaceIconPicker";


export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const d = loaderData as { workspace?: { name?: string } } | undefined;
  return [{ title: `${d?.workspace?.name ?? "Teamspace"} teamspace — loica` }];
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
  if (!user) throw loginRedirect(request);

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

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

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

  const headerContent = (
    <div className="flex items-center gap-3">
      <TeamspaceIconPicker
        name={workspace.name}
        icon={workspace.icon ?? null}
        editable={isOwner}
        size="md"
      />
      <h1 className="section-header">{workspace.name} <span className="font-normal">teamspace</span></h1>
    </div>
  );

  return (
    <DndProvider onMove={handleMove} allFolders={allFolders}>
      <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
        <WorkspaceListView
          basePath={`/t/${workspace.id}`}
          headerContent={headerContent}
          documents={documents}
          folders={folders}
          allFolders={allFolders}
          sharedFolderIds={sharedFolderIds}
          starredDocs={starredDocs}
          directlySharedDocIds={directlySharedDocIds}
          canEdit={canEdit}
          isOwner={isOwner}
          page={page}
          pageSize={pageSize}
          totalDocs={totalDocs}
          currentWorkspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon, type: "team" }}
          otherWorkspaces={[
            { id: personalWsId, name: personalWsName || "My workspace", type: "personal" as const },
            ...teamspaces.filter((t) => t.id !== workspace.id).map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "team" as const })),
          ]}
        />
      </AppShell>
    </DndProvider>
  );
}
