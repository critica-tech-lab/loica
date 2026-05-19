import { data } from "react-router";
import type { Route } from "./+types/api.folder-children.$workspaceId";
import { getSessionUser } from "~/lib/auth.server";
import { getMembership } from "~/lib/workspace.server";
import { getFoldersAtLevel, getAllWorkspaceFolders } from "~/lib/folder.server";
import { db, prep } from "~/lib/db.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw data("Unauthorized", { status: 401 });

  const role = getMembership(params.workspaceId, user.id, user.is_admin);
  if (!role) throw data("Forbidden", { status: 403 });

  const url = new URL(request.url);

  // ?all=1 returns all folders for the workspace (used by MoveDialog cross-workspace)
  if (url.searchParams.get("all") === "1") {
    const folders = getAllWorkspaceFolders(params.workspaceId);
    return { folders, docs: [] };
  }

  const parentId = url.searchParams.get("parentId") || null;

  const folders = getFoldersAtLevel(params.workspaceId, parentId);

  let docs: { id: string; title: string; pdf_file: string | null }[];
  if (parentId) {
    docs = prep<{ id: string; title: string; pdf_file: string | null }, [string, string]>(
        `SELECT id, title, pdf_file FROM documents
         WHERE workspace_id = ? AND folder_id = ? AND deleted_at IS NULL
         ORDER BY title ASC`
      )
      .all(params.workspaceId, parentId);
  } else {
    docs = prep<{ id: string; title: string; pdf_file: string | null }, [string]>(
        `SELECT id, title, pdf_file FROM documents
         WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL
         ORDER BY title ASC`
      )
      .all(params.workspaceId);
  }

  return { folders, docs };
}
