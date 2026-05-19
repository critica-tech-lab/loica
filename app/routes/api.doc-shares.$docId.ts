import type { Route } from "./+types/api.doc-shares.$docId";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { getDocShares, getDocGroupShares, getExternalDocShares, hasDocSharedAccess } from "~/lib/doc-sharing.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { getUserGroups } from "~/lib/group.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Not found", { status: 404 });

  const doc = getDocument(params.docId);
  if (!doc) throw new Response("Not found", { status: 404 });

  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  const hasFolderAccess = doc.folder_id && hasSharedAccess(doc.folder_id, user.id);
  const hasDocAccess = hasDocSharedAccess(doc.id, user.id);
  if (!role && !hasFolderAccess && !hasDocAccess) throw new Response("Not found", { status: 404 });

  const shares = getDocShares(doc.id);
  const groupShares = getDocGroupShares(doc.id);
  const externalShares = getExternalDocShares(doc.id);
  const userGroups = getUserGroups(user.id);

  return Response.json({ shares, groupShares, externalShares, userGroups });
}
