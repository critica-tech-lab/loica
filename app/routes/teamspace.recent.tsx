import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace.recent";
import { getSessionUser } from "~/lib/auth.server";
import { getMembership, getUserPersonalWorkspaces } from "~/lib/workspace.server";
import { getTeamspace, getTeamspacesForUser } from "~/lib/teamspace.server";
import {
  getRecentlyModifiedDocs,
  getStarredDocsForWorkspace,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { db, prep } from "~/lib/db.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { RecentView } from "~/components/RecentView";
import { useSessionUser } from "~/root";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as Record<string, any> | undefined;
  return [{ title: `Recent — ${d?.teamspace.name ?? "Teamspace"} teamspace — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const recentDocs = getRecentlyModifiedDocs(teamspace.id, 20);
  const starredDocs = getStarredDocsForWorkspace(user.id, teamspace.id);
  const storageBytes = getWorkspaceStorageBytes(teamspace.id);
  const personalWorkspaces = getUserPersonalWorkspaces(user.id);
  const personalWsId = personalWorkspaces.length > 0 ? personalWorkspaces[0].id : teamspace.id;
  const personalWsName = personalWorkspaces.length > 0 ? personalWorkspaces[0].name : "";
  const teamspaces = getTeamspacesForUser(user.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const sidebarRootFolders = getFoldersAtLevel(personalWsId, null);
  const sidebarRootDocs = prep<{ id: string; title: string; pdf_file?: string | null }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(personalWsId);

  return { teamspace, role, recentDocs, starredDocs, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace: teamspace, role, form, request };

  return dispatchAction(ctx, intent, { docUrl: (id) => `/t/${teamspace.id}/doc/${id}` });
}

export default function TeamspaceRecentPage() {
  const { teamspace, role, recentDocs, starredDocs, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const canEdit = role === "owner" || role === "admin" || role === "editor";

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: teamspace.id }}
      activeView="recent"
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
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <RecentView
        recentDocs={recentDocs}
        starredDocs={starredDocs}
        canEdit={canEdit}
        getDocHref={(id) => `/t/${teamspace.id}/doc/${id}`}
        emptyLabel="teamspace"
      />
    </AppShell>
  );
}
