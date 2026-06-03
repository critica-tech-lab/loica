import type { Route } from "./+types/api.doc-pdf.$id";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import sharp from "sharp";
import { homedir } from "node:os";
import { join, extname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { getSessionUser } from "~/lib/auth.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { parseFrontmatter, fixListIndentation, renumberFootnotesForDisplay } from "~/lib/templates";
import { getServerExtensionForDocType } from "~/extensions/index.server";

const fontsDir = resolve(process.cwd(), "assets/fonts");
const preamblePath = resolve(process.cwd(), "assets/pdf-preamble.tex");
const dateFilterPath = resolve(process.cwd(), "assets/date-code.lua");
const sourceFilterPath = resolve(process.cwd(), "assets/source-caption.lua");

// Snap-confined tectonic can only access non-hidden dirs under $HOME.
// Using $HOME/loica-tmp instead of /tmp or a dot-prefixed project dir.
const loicaTmpDir = join(homedir(), "loica-tmp");

async function convertImage(srcPath: string, pngPath: string): Promise<boolean> {
  try {
    await sharp(srcPath).png().toFile(pngPath);
    return true;
  } catch {}

  const tools: [string, string[]][] = process.platform === "darwin"
    ? [["sips", ["-s", "format", "png", srcPath, "--out", pngPath]]]
    : [["magick", [srcPath, pngPath]], ["convert", [srcPath, pngPath]]];

  for (const [cmd, args] of tools) {
    try {
      execFileSync(cmd, args, { timeout: 10000, stdio: "pipe" });
      return true;
    } catch {}
  }
  return false;
}

async function generatePdf(rawContent: string, title: string, landscape = false): Promise<Response> {
  mkdirSync(loicaTmpDir, { recursive: true });

  const uploadsDir = join(process.cwd(), "uploads");
  const id = nanoid(8);
  const tmpImgDir = join(loicaTmpDir, `loica-img-${id}`);
  const tmpFiles: string[] = [];
  const nativeFormats = new Set([".png", ".jpg", ".jpeg", ".pdf"]);

  // Rewrite /api/uploads/* image paths to absolute filesystem paths for pandoc
  const imgRegex = /!\[([^\]]*)\]\(\/api\/uploads\/([^)]+)\)/g;
  const replacements = await Promise.all(
    Array.from(rawContent.matchAll(imgRegex)).map(async (m) => {
      const [match, alt, file] = m;
      const srcPath = join(uploadsDir, file);
      if (!existsSync(srcPath)) return { match, replacement: `![${alt}]()` };

      const ext = extname(file).toLowerCase();
      if (nativeFormats.has(ext)) {
        return { match, replacement: `![${alt}](${srcPath})` };
      }

      mkdirSync(tmpImgDir, { recursive: true });
      const pngName = file.replace(/\.[^.]+$/, ".png");
      const pngPath = join(tmpImgDir, pngName);

      if (await convertImage(srcPath, pngPath)) {
        tmpFiles.push(pngPath);
        return { match, replacement: `![${alt}](${pngPath})` };
      }
      return { match, replacement: `![${alt}]()` };
    })
  );
  let content = rawContent;
  for (const { match, replacement } of replacements) {
    content = content.replace(match, replacement);
  }

  const mdPath = join(loicaTmpDir, `loica-${id}.md`);
  const pdfPath = join(loicaTmpDir, `loica-${id}.pdf`);
  let wideTableHeaderPath: string | null = null;
  let landscapeHeaderPath: string | null = null;

  try {
    const prepared = fixListIndentation(content)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/^(\|.+\|)\s*$/gm, (match, _row, offset, str) => {
        const before = str.lastIndexOf("\n", offset - 1);
        const prevLine = before >= 0 ? str.slice(str.lastIndexOf("\n", before - 1) + 1, before) : "";
        if (prevLine.length > 0 && !prevLine.trimStart().startsWith("|")) {
          return "\n" + match;
        }
        return match;
      });

    const maxTableCols = prepared
      .split("\n")
      .filter((l) => l.trimStart().startsWith("|") && l.trimEnd().endsWith("|"))
      .reduce((max, line) => Math.max(max, line.split("|").length - 2), 0);

    let tableSizeOverride = "";
    if (!landscape) {
      if (maxTableCols >= 8) {
        tableSizeOverride = "\\AtBeginEnvironment{longtable}{\\scriptsize\\setlength{\\tabcolsep}{3pt}}";
      } else if (maxTableCols >= 6) {
        tableSizeOverride = "\\AtBeginEnvironment{longtable}{\\footnotesize}";
      }
    }
    if (tableSizeOverride) {
      wideTableHeaderPath = join(loicaTmpDir, `loica-wide-${id}.tex`);
      writeFileSync(wideTableHeaderPath, tableSizeOverride, "utf-8");
    }

    if (landscape) {
      landscapeHeaderPath = join(loicaTmpDir, `loica-landscape-${id}.tex`);
      writeFileSync(landscapeHeaderPath, "\\geometry{landscape,top=40pt,bottom=50pt,left=50pt,right=50pt}", "utf-8");
    }

    writeFileSync(mdPath, prepared, "utf-8");

    const env = { ...process.env, OSFONTDIR: fontsDir, TMPDIR: loicaTmpDir };

    const pandocArgs = [
      mdPath,
      "-f", "gfm+footnotes",
      "-o", pdfPath,
      "--pdf-engine=tectonic",
      "-V", "mainfont=IBM Plex Sans",
      "-V", "sansfont=IBM Plex Sans",
      "-V", "monofont=IBM Plex Mono",
      "-V", "fontsize=11pt",
      "-V", "colorlinks=true",
      "-V", "urlcolor=linkblue",
      "-V", "linkcolor=body",
      "--highlight-style=kate",
      "--lua-filter", dateFilterPath,
      "--lua-filter", sourceFilterPath,
      "--metadata", `title=${title}`,
      "-H", preamblePath,
    ];
    if (wideTableHeaderPath) pandocArgs.push("-H", wideTableHeaderPath);
    if (landscapeHeaderPath) pandocArgs.push("-H", landscapeHeaderPath);

    execFileSync("pandoc", pandocArgs, { timeout: 120000, stdio: "pipe", env });

    const pdf = readFileSync(pdfPath);
    const filename = title.replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".pdf";

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("PDF generation failed:", err.stderr?.toString() || err.message);
    throw new Response("PDF generation failed", { status: 500 });
  } finally {
    try { unlinkSync(mdPath); } catch {}
    try { unlinkSync(pdfPath); } catch {}
    if (wideTableHeaderPath) { try { unlinkSync(wideTableHeaderPath); } catch {} }
    if (landscapeHeaderPath) { try { unlinkSync(landscapeHeaderPath); } catch {} }
    for (const f of tmpFiles) { try { unlinkSync(f); } catch {} }
    try { rmSync(tmpImgDir, { recursive: true }); } catch {}
  }
}

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

export async function loader({ request, params }: Route.LoaderArgs) {
  const doc = await authorizeDoc(request, params);
  const title = doc.title || "Untitled";
  const frontmatter = parseFrontmatter(doc.content || "");

  const ext = getServerExtensionForDocType(frontmatter?.type);
  if (ext?.exporters?.pdf) {
    return ext.exporters.pdf(doc, frontmatter);
  }

  const content = renumberFootnotesForDisplay(doc.content || "");
  return generatePdf(content, title, frontmatter?.orientation === "landscape");
}

// POST: accepts { content: string } — used by PM editor to send serialized markdown
export async function action({ request, params }: Route.ActionArgs) {
  const doc = await authorizeDoc(request, params);
  const { content = "" } = await request.json() as { content?: string };
  return generatePdf(content, doc.title || "Untitled");
}
