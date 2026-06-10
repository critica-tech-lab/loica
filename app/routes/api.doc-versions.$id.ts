import type { Route } from "./+types/api.doc-versions.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument, getDocumentVersions, getDocumentVersion } from "~/lib/document.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Not found", { status: 404 });

  const doc = getDocument(params.id);
  if (!doc) throw new Response("Not found", { status: 404 });

  const workspace = getWorkspace(doc.workspace_id);
  if (!workspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId");

  if (versionId) {
    const version = getDocumentVersion(versionId);
    if (!version || version.document_id !== doc.id) {
      throw new Response("Version not found", { status: 404 });
    }
    // yjs_state is already base64-encoded from getDocumentVersion
    return { version };
  }

  const versions = getDocumentVersions(params.id);
  return { versions };
}
