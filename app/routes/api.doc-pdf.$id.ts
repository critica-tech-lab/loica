import type { Route } from "./+types/api.doc-pdf.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { parseFrontmatter, stripFrontmatter } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActiveGlobalExporter } from "~/extensions/index.server";
import { renderPdf } from "~/lib/export/pdf.server";
import { safeFilename } from "~/lib/export/shared.server";

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

async function exportPdf(doc: any, content: string): Promise<Response> {
  const frontmatter = parseFrontmatter(doc.content || "");

  const typeExporter = getServerExtensionForDocType(frontmatter?.type)?.exporters?.pdf;
  if (typeExporter) return typeExporter(doc, frontmatter, content);

  const body = stripFrontmatter(content);

  const globalExporter = getActiveGlobalExporter("pdf");
  if (globalExporter) return globalExporter(doc, frontmatter, body);

  const landscape = frontmatter?.orientation === "landscape";
  const pdf = await renderPdf(body, doc.title || "Untitled", landscape);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename(doc.title)}.pdf"`,
    },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  return exportPdf(doc, doc.content || "");
}

export async function action({ request, params }: Route.ActionArgs) {
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  const { content = "" } = (await request.json()) as { content?: string };
  return exportPdf(doc, content || doc.content || "");
}
