import type { Route } from "./+types/api.doc-pdf.$id";
import { authorizeDocRead } from "~/lib/doc-access.server";
import { getSessionUser } from "~/lib/auth.server";
import { parseFrontmatter, stripFrontmatter } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActiveGlobalExporter } from "~/extensions/index.server";
import { renderPdf } from "~/lib/export/pdf.server";
import { safeFilename } from "~/lib/export/shared.server";
import { getRateLimitKey, checkRateLimit } from "~/lib/rate-limit.server";

function rateLimitExport(request: Request): Response | null {
  const user = getSessionUser(request);
  const rl = checkRateLimit(getRateLimitKey(request, user?.id), { windowMs: 5 * 60 * 1000, max: 20, prefix: "export" });
  if (rl.allowed) return null;
  return new Response("Too many export requests. Try again later.", {
    status: 429,
    headers: { "Retry-After": String(rl.retryAfterSeconds) },
  });
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
  const limited = rateLimitExport(request);
  if (limited) return limited;
  await ensurePluginsLoaded();
  const doc = authorizeDocRead(request, params.id);
  return exportPdf(doc, doc.content || "");
}

export async function action({ request, params }: Route.ActionArgs) {
  const limited = rateLimitExport(request);
  if (limited) return limited;
  await ensurePluginsLoaded();
  const doc = authorizeDocRead(request, params.id);
  const { content = "" } = (await request.json()) as { content?: string };
  return exportPdf(doc, content || doc.content || "");
}
