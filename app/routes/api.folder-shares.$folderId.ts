import type { Route } from "./+types/api.folder-shares.$folderId";
import { getSessionUser } from "~/lib/auth.server";
import { getFolder } from "~/lib/folder.server";
import { getMembership } from "~/lib/workspace.server";
import { getFolderShares } from "~/lib/sharing.server";
import { getUserGroups } from "~/lib/group.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const folder = getFolder(params.folderId);
  if (!folder) throw new Response("Not found", { status: 404 });

  const role = getMembership(folder.workspace_id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const shares = getFolderShares(folder.id);
  const groups = getUserGroups(user.id);

  return Response.json({ shares, groups });
}
