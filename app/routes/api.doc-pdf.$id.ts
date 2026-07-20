import type { Route } from "./+types/api.doc-pdf.$id";
import { authorizeDocRead } from "~/lib/doc-access.server";
import { parseFrontmatter, stripFrontmatter } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActiveGlobalExporter } from "~/extensions/index.server";
import { renderPdf } from "~/lib/export/pdf.server";
import { safeFilename } from "~/lib/export/shared.server";

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
  const doc = authorizeDocRead(request, params.id);
  return exportPdf(doc, doc.content || "");
}

export async function action({ request, params }: Route.ActionArgs) {
  await ensurePluginsLoaded();
  const doc = authorizeDocRead(request, params.id);
  const { content = "" } = (await request.json()) as { content?: string };
  return exportPdf(doc, content || doc.content || "");
}
