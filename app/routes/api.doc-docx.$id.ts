import type { Route } from "./+types/api.doc-docx.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { fixListIndentation, parseFrontmatter } from "~/lib/templates";
import { getServerExtensionForDocType } from "~/extensions/index.server";
import { uploadsDir } from "~/lib/paths.server";

const fontsDir = resolve(process.cwd(), "assets/fonts");

export async function loader({ request, params }: Route.LoaderArgs) {
  const doc = getDocument(params.id);
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

  // Extension-provided exporters take precedence over core markdown→DOCX.
  const ext = getServerExtensionForDocType(frontmatter?.type);
  if (ext?.exporters?.docx) {
    return ext.exporters.docx(doc, frontmatter);
  }

  // Core fallback — markdown via pandoc. Requires `pandoc` on PATH.

  // Rewrite image paths to absolute for pandoc
  const content = (doc.content || "").replace(
    /!\[([^\]]*)\]\(\/api\/uploads\/([^)]+)\)/g,
    (_match, alt: string, file: string) => {
      const srcPath = join(uploadsDir, file);
      if (!existsSync(srcPath)) return `![${alt}]()`;
      return `![${alt}](${srcPath})`;
    }
  );

  const id = nanoid(8);
  const mdPath = join(tmpdir(), `loica-${id}.md`);
  const docxPath = join(tmpdir(), `loica-${id}.docx`);

  try {
    writeFileSync(mdPath, fixListIndentation(content), "utf-8");

    const env = { ...process.env, OSFONTDIR: fontsDir };

    execFileSync("pandoc", [
      mdPath,
      "-o", docxPath,
      "--metadata", `title=${title}`,
    ], { timeout: 60000, stdio: "pipe", env });

    const docx = readFileSync(docxPath);
    const filename = title.replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".docx";

    return new Response(docx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("DOCX generation failed:", err.stderr?.toString() || err.message);
    throw new Response("DOCX generation failed", { status: 500 });
  } finally {
    try { unlinkSync(mdPath); } catch {}
    try { unlinkSync(docxPath); } catch {}
  }
}
