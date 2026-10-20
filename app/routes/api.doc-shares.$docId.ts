import type { Route } from "./+types/api.doc-shares.$docId";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getUserDocAccess } from "~/lib/doc-access.server";
import { getDocShares, getDocGroupShares, getExternalDocShares } from "~/lib/doc-sharing.server";
import { getUserGroups } from "~/lib/group.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Not found", { status: 404 });

  const doc = getDocument(params.docId);
  if (!doc) throw new Response("Not found", { status: 404 });

  if (!getUserDocAccess(doc, user)) throw new Response("Not found", { status: 404 });

  const shares = getDocShares(doc.id);
  const groupShares = getDocGroupShares(doc.id);
  const externalShares = getExternalDocShares(doc.id);
  const userGroups = getUserGroups(user.id);

  return Response.json({ shares, groupShares, externalShares, userGroups });
}
