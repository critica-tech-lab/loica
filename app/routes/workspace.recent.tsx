import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/workspace.recent";
import { getSessionUser } from "~/lib/auth.server";
import {
  getUserPersonalWorkspaces,
  getMembership,
} from "~/lib/workspace.server";
import {
  getRecentlyModifiedDocs,
  getStarredDocs,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import type { ActionContext } from "~/lib/actions/doc-actions.server";
import { dispatchAction } from "~/lib/actions/doc-actions.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { db, prep } from "~/lib/db.server";
import { RecentView } from "~/components/RecentView";
import { useSessionUser } from "~/root";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction =() => [{ title: "Recent — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const workspaces = getUserPersonalWorkspaces(user.id);
  if (workspaces.length === 0) throw redirect("/");
  const workspace = workspaces[0];

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const recentDocs = getRecentlyModifiedDocs(workspace.id, 20);
  const starredDocs = getStarredDocs(user.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;

  const storageBytes = getWorkspaceStorageBytes(workspace.id);
  const teamspaces = getTeamspacesForUser(user.id);
  const rootFolders = getFoldersAtLevel(workspace.id, null);
  const rootDocs = prep<{ id: string; title: string }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(workspace.id);
  return { workspace, role, recentDocs, starredDocs, sharedCount, storageBytes, teamspaces, rootFolders, rootDocs };
}

export async function action({ request }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const workspaces = getUserPersonalWorkspaces(user.id);
  if (workspaces.length === 0) throw new Response("Not found", { status: 404 });
  const workspace = workspaces[0];

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");
  const ctx: ActionContext = { user, workspace, role, form, request };

  return dispatchAction(ctx, intent, { docUrl: (id) => `/w/doc/${id}` });
}

export default function RecentPage() {
  const { workspace, role, recentDocs, starredDocs, sharedCount, storageBytes, teamspaces, rootFolders, rootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const canEdit = role === "owner" || role === "editor";

  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

  const sidebar = (
    <FolderTreeSidebar activeSection={{ type: "workspace", id: workspace.id }} activeView="recent" workspaceName={workspace.name} storageBytes={storageBytes} sharedCount={sharedCount} teamspaces={teamspaces} workspaceId={workspace.id} rootFolders={rootFolders} rootDocs={rootDocs} />
  );

  return (
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <RecentView
        recentDocs={recentDocs}
        starredDocs={starredDocs}
        canEdit={canEdit}
        getDocHref={(id) => `/w/doc/${id}`}
        emptyLabel="workspace"
      />
    </AppShell>
  );
}
