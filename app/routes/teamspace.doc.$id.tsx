import { redirect } from "react-router";
import type { Route } from "./+types/teamspace.doc.$id";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);
  const doc = getDocument(params.id);
  if (!doc) throw new Response("Not found", { status: 404 });
  const role = getMembership(doc.workspace_id, user.id, user.is_admin);
  if (!role) throw new Response("Not found", { status: 404 });
  // Redirect to the shared doc route which works for both personal and teamspace
  throw redirect(`/w/doc/${params.id}`);
}

export default function TeamspaceDocRedirect() {
  return null;
}
