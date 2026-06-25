import type { Route } from "./+types/api.doc-docx.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { parseFrontmatter, stripFrontmatter } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActiveGlobalExporter } from "~/extensions/index.server";
import { renderDocx } from "~/lib/export/docx.server";
import { safeFilename } from "~/lib/export/shared.server";
import { getDocumentThreads } from "~/lib/comments.server";

async function authorizeDoc(request: Request, params: { id?: string }) {
  const doc = getDocument(params.id!);
  if (!doc) throw new Response("Not found", { status: 404 });

  const isPublic = !!(doc.public_token || doc.edit_token);
  if (!isPublic) {
    const user = getSessionUser(request);
    if (!user) throw new Response("Not found", { status: 404 });
    const role = getMembership(doc.workspace_id, user.id, user.is_admin);
    const shared = doc.folder_id ? hasSharedAccess(doc.folder_id, user.id) : false;
    if (!role && !shared) throw new Response("Not found", { status: 404 });
  }

  return doc;
}

async function exportDocx(doc: any, content: string): Promise<Response> {
  const frontmatter = parseFrontmatter(doc.content || "");

  const typeExporter = getServerExtensionForDocType(frontmatter?.type)?.exporters?.docx;
  if (typeExporter) return typeExporter(doc, frontmatter, content);

  // Global exporter mirrors the core renderer's input (stripped body);
  // per-doc-type exporters above get raw content.
  const body = stripFrontmatter(content);

  const globalExporter = getActiveGlobalExporter("docx");
  if (globalExporter) return globalExporter(doc, frontmatter, body);

  // Unresolved comment threads → native Word comments, anchored by text match.
  const threads = getDocumentThreads(doc.id).filter((th) => !th.root.resolved);
  const docx = await renderDocx(body, doc.title || "Untitled", threads);
  return new Response(new Uint8Array(docx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeFilename(doc.title)}.docx"`,
    },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  return exportDocx(doc, doc.content || "");
}

// POST: accepts { content: string } — the PM editor sends serialized markdown
// so the export reflects unsaved edits.
export async function action({ request, params }: Route.ActionArgs) {
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  const { content = "" } = (await request.json()) as { content?: string };
  return exportDocx(doc, content || doc.content || "");
}
