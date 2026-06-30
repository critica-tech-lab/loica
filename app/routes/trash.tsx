import { redirect, useLoaderData, data } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/trash";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getTrashedDocuments,
  purgeExpiredTrash,
  getWorkspaceStorageBytes,
} from "~/lib/document.server";
import { getUserWorkspaces } from "~/lib/workspace.server";
import { getTrashedFolders, getFoldersAtLevel } from "~/lib/folder.server";
import { db, prep } from "~/lib/db.server";
import { handleRestoreDoc, handleRestoreFolder, handlePurgeDoc, handlePurgeFolder } from "~/lib/actions/trash-actions.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { TrashView } from "~/components/TrashView";
import { useSessionUser } from "~/root";

export const meta: MetaFunction = () => [{ title: "Trash — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);
  purgeExpiredTrash();
  const documents = getTrashedDocuments(user.id);
  const folders = getTrashedFolders(user.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const workspaces = getUserWorkspaces(user.id);
  const workspaceId = workspaces.length > 0 ? workspaces[0].id : null;
  const storageBytes = workspaceId ? getWorkspaceStorageBytes(workspaceId) : 0;
  const teamspaces = getTeamspacesForUser(user.id);
  const rootFolders = workspaceId ? getFoldersAtLevel(workspaceId, null) : [];
  const rootDocs = workspaceId ? prep<{ id: string; title: string }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(workspaceId) : [];
  return { documents, folders, sharedCount, storageBytes, teamspaces, rootFolders, rootDocs, workspaceId };
}

export async function action({ request }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw data("Unauthorized", { status: 401 });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "restore-doc") return handleRestoreDoc(form);
  if (intent === "restore-folder") return handleRestoreFolder(form);
  if (intent === "purge-doc") return handlePurgeDoc(form);
  if (intent === "purge-folder") return handlePurgeFolder(form);

  if (intent === "empty-trash") {
    db.transaction(() => {
      db.prepare("DELETE FROM documents WHERE deleted_by = ? AND deleted_at IS NOT NULL").run(user.id);
      db.prepare("DELETE FROM folders WHERE deleted_by = ? AND deleted_at IS NOT NULL").run(user.id);
    })();
    return { ok: true };
  }

  throw data("Unknown intent", { status: 400 });
}

export default function Trash() {
  const { documents, folders, sharedCount, storageBytes, teamspaces, rootFolders, rootDocs, workspaceId } = useLoaderData<typeof loader>();
  const user = useSessionUser();

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = workspaceId ? (
    <FolderTreeSidebar activeSection={{ type: "workspace", id: workspaceId }} activeView="trash" workspaceName="" storageBytes={storageBytes} sharedCount={sharedCount} teamspaces={teamspaces} workspaceId={workspaceId} rootFolders={rootFolders} rootDocs={rootDocs} />
  ) : undefined;

  return (
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <TrashView documents={documents} folders={folders} />
    </AppShell>
  );
}
