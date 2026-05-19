import type { Route } from "./+types/api.doc-download.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const doc = getDocument(params.id);
  if (!doc) throw new Response("Not found", { status: 404 });

  // Allow if doc is publicly shared (has view or edit token)
  const isPublic = !!(doc.public_token || doc.edit_token);

  if (!isPublic) {
    const user = getSessionUser(request);
    if (!user) throw new Response("Not found", { status: 404 });
    const role = getMembership(doc.workspace_id, user.id, user.is_admin);
    const shared = doc.folder_id ? hasSharedAccess(doc.folder_id, user.id) : false;
    if (!role && !shared) throw new Response("Not found", { status: 404 });
  }

  const filename = (doc.title || "untitled").replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".md";

  return new Response(doc.content || "", {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
