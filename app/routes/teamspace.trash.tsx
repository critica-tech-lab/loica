import { redirect, useLoaderData, data } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace.trash";
import { getSessionUser } from "~/lib/auth.server";
import { getMembership, getUserPersonalWorkspaces } from "~/lib/workspace.server";
import { getTeamspace, getTeamspacesForUser } from "~/lib/teamspace.server";
import {
  getTrashedDocumentsForWorkspace,
  purgeExpiredTrash,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import { getTrashedFoldersForWorkspace, getFoldersAtLevel } from "~/lib/folder.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { db, prep } from "~/lib/db.server";
import { handleRestoreDoc, handleRestoreFolder, handlePurgeDoc, handlePurgeFolder } from "~/lib/actions/trash-actions.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { TrashView } from "~/components/TrashView";
import { useSessionUser } from "~/root";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as Record<string, any> | undefined;
  return [{ title: `Trash — ${d?.teamspace.name ?? "Teamspace"} teamspace — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  purgeExpiredTrash();
  const documents = getTrashedDocumentsForWorkspace(user.id, teamspace.id);
  const folders = getTrashedFoldersForWorkspace(user.id, teamspace.id);
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

  return { teamspace, role, documents, folders, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw data("Unauthorized", { status: 401 });

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw data("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role) throw data("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "restore-doc") return handleRestoreDoc(form);
  if (intent === "restore-folder") return handleRestoreFolder(form);
  if (intent === "purge-doc") return handlePurgeDoc(form);
  if (intent === "purge-folder") return handlePurgeFolder(form);

  if (intent === "empty-trash") {
    db.transaction(() => {
      db.prepare(
        "DELETE FROM documents WHERE deleted_by = ? AND deleted_at IS NOT NULL AND workspace_id = ?"
      ).run(user.id, teamspace.id);
      db.prepare(
        "DELETE FROM folders WHERE deleted_by = ? AND deleted_at IS NOT NULL AND workspace_id = ?"
      ).run(user.id, teamspace.id);
    })();
    return { ok: true };
  }

  throw data("Unknown intent", { status: 400 });
}

export default function TeamspaceTrash() {
  const { teamspace, role, documents, folders, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: teamspace.id }}
      activeView="trash"
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
      <TrashView documents={documents} folders={folders} />
    </AppShell>
  );
}
