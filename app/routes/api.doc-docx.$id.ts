import type { Route } from "./+types/api.doc-docx.$id";
import { authorizeDocRead } from "~/lib/doc-access.server";
import { parseFrontmatter, stripFrontmatter } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActiveGlobalExporter } from "~/extensions/index.server";
import { renderDocx } from "~/lib/export/docx.server";
import { safeFilename } from "~/lib/export/shared.server";
import { getDocumentThreads } from "~/lib/comments.server";

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
  const doc = authorizeDocRead(request, params.id);
  return exportDocx(doc, doc.content || "");
}

// POST: accepts { content: string } — the PM editor sends serialized markdown
// so the export reflects unsaved edits.
export async function action({ request, params }: Route.ActionArgs) {
  await ensurePluginsLoaded();
  const doc = authorizeDocRead(request, params.id);
  const { content = "" } = (await request.json()) as { content?: string };
  return exportDocx(doc, content || doc.content || "");
}
