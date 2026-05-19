import type { Route } from "./+types/api.sidebar-data.$workspaceId";
import { data } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { getMembership } from "~/lib/workspace.server";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { getWorkspaceStorageBytes } from "~/lib/document.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { db, prep } from "~/lib/db.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw data("Unauthorized", { status: 401 });

  const role = getMembership(params.workspaceId, user.id, user.is_admin);
  if (!role) throw data("Forbidden", { status: 403 });

  const rootFolders = getFoldersAtLevel(params.workspaceId, null);
  const rootDocs = prep<{ id: string; title: string; pdf_file: string | null }, [string]>(
      `SELECT id, title, pdf_file FROM documents
       WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL
       ORDER BY title ASC`
    )
    .all(params.workspaceId);

  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const storageBytes = getWorkspaceStorageBytes(params.workspaceId);
  const teamspaces = getTeamspacesForUser(user.id);

  return { rootFolders, rootDocs, sharedCount, storageBytes, teamspaces };
}
