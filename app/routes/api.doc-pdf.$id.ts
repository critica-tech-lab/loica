import type { Route } from "./+types/api.doc-pdf.$id";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import sharp from "sharp";
import { homedir } from "node:os";
import { join, extname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { getSessionUser } from "~/lib/auth.server";
import { uploadsDir } from "~/lib/paths.server";
import { getDocument } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { parseFrontmatter, fixListIndentation, renumberFootnotesForDisplay } from "~/lib/templates";
import { ensurePluginsLoaded, getServerExtensionForDocType, getActivePdfStyle } from "~/extensions/index.server";
import type { PdfStyle } from "~/extensions/types";

// Vendored new.css assets — the bare-metal default PDF look (classless CSS via
// WeasyPrint). Opinionated styling (e.g. Critica's LaTeX house style) is added
// by a drop-in plugin's `pdfStyle`, never baked into core.
const newcssDir = resolve(process.cwd(), "assets/pdf-newcss");
const newcssTemplate = join(newcssDir, "template.html");
const newcssStyle = join(newcssDir, "new.min.css");
const newcssPrint = join(newcssDir, "print.css");
// Applies a resized image's `{width=Npx}` marker (emitted by the markdown
// serializer) as a real width attribute, for both HTML and LaTeX output.
const imageWidthFilter = resolve(process.cwd(), "assets/image-width.lua");

// Snap-confined tectonic can only access non-hidden dirs under $HOME.
// Using $HOME/loica-tmp instead of /tmp or a dot-prefixed project dir.
const loicaTmpDir = join(homedir(), "loica-tmp");

// WeasyPrint is the engine for the default new.css PDF. It may be absent on a
// given host; detect once and fall back to plain pandoc/LaTeX so export never
// breaks.
let weasyAvailable: boolean | null = null;
function hasWeasyprint(): boolean {
  if (weasyAvailable !== null) return weasyAvailable;
  try {
    execFileSync("weasyprint", ["--version"], { stdio: "ignore", timeout: 5000 });
    weasyAvailable = true;
  } catch {
    weasyAvailable = false;
  }
  return weasyAvailable;
}

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

async function generatePdf(
  rawContent: string,
  title: string,
  landscape = false,
  pdfStyle: PdfStyle | null = null,
): Promise<Response> {
  mkdirSync(loicaTmpDir, { recursive: true });

  const id = nanoid(8);
  const tmpImgDir = join(loicaTmpDir, `loica-img-${id}`);
  const tmpFiles: string[] = [];
  const nativeFormats = new Set([".png", ".jpg", ".jpeg", ".pdf"]);

  // Rewrite /api/uploads/* image paths to absolute filesystem paths (pandoc +
  // WeasyPrint both read local files). Convert non-native formats to PNG.
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
  const htmlPath = join(loicaTmpDir, `loica-${id}.html`);
  const pdfPath = join(loicaTmpDir, `loica-${id}.pdf`);
  const extraTmp: string[] = []; // header/style temp files to clean up

  try {
    // Content prep only (parsing fixes, not styling): list indentation, drop
    // hard <br>, and ensure a blank line before a table that follows text.
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

    writeFileSync(mdPath, prepared, "utf-8");
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: loicaTmpDir };

    if (pdfStyle) {
      // ── Plugin-provided house style: pandoc → LaTeX (tectonic) ──
      if (pdfStyle.fontsDir) env.OSFONTDIR = pdfStyle.fontsDir;
      const args = [
        mdPath, "-f", "gfm+footnotes", "-o", pdfPath,
        "--pdf-engine=tectonic", "--metadata", `title=${title}`,
        "--lua-filter", imageWidthFilter,
      ];
      if (pdfStyle.extraPandocArgs) args.push(...pdfStyle.extraPandocArgs);
      for (const filter of pdfStyle.luaFilters ?? []) args.push("--lua-filter", filter);
      if (pdfStyle.preamblePath) args.push("-H", pdfStyle.preamblePath);

      // Wide-table shrink + landscape geometry pair with the style's preamble.
      const maxTableCols = prepared
        .split("\n")
        .filter((l) => l.trimStart().startsWith("|") && l.trimEnd().endsWith("|"))
        .reduce((max, line) => Math.max(max, line.split("|").length - 2), 0);
      let tableSizeOverride = "";
      if (!landscape) {
        if (maxTableCols >= 8) tableSizeOverride = "\\AtBeginEnvironment{longtable}{\\scriptsize\\setlength{\\tabcolsep}{3pt}}";
        else if (maxTableCols >= 6) tableSizeOverride = "\\AtBeginEnvironment{longtable}{\\footnotesize}";
      }
      if (tableSizeOverride) {
        const p = join(loicaTmpDir, `loica-wide-${id}.tex`);
        writeFileSync(p, tableSizeOverride, "utf-8"); extraTmp.push(p); args.push("-H", p);
      }
      if (landscape) {
        const p = join(loicaTmpDir, `loica-landscape-${id}.tex`);
        writeFileSync(p, "\\geometry{landscape,top=40pt,bottom=50pt,left=50pt,right=50pt}", "utf-8");
        extraTmp.push(p); args.push("-H", p);
      }
      execFileSync("pandoc", args, { timeout: 120000, stdio: "pipe", env });
    } else if (hasWeasyprint()) {
      // ── Bare-metal default: pandoc → HTML (new.css) → WeasyPrint → PDF ──
      execFileSync("pandoc", [
        mdPath, "-f", "gfm+footnotes", "-t", "html5", "-s",
        "--template", newcssTemplate, "--metadata", `title=${title}`,
        "--lua-filter", imageWidthFilter,
        "-o", htmlPath,
      ], { timeout: 120000, stdio: "pipe", env });

      const wargs = [htmlPath, pdfPath, "-s", newcssStyle, "-s", newcssPrint];
      if (landscape) {
        const p = join(loicaTmpDir, `loica-land-${id}.css`);
        writeFileSync(p, "@page { size: A4 landscape; }", "utf-8"); extraTmp.push(p);
        wargs.push("-s", p);
      }
      execFileSync("weasyprint", wargs, { timeout: 120000, stdio: "pipe", env });
    } else {
      // ── Fallback when WeasyPrint is absent: plain pandoc default LaTeX ──
      const args = [
        mdPath, "-f", "gfm+footnotes", "-o", pdfPath,
        "--pdf-engine=tectonic", "--metadata", `title=${title}`,
        "--lua-filter", imageWidthFilter,
      ];
      if (landscape) args.push("-V", "geometry:landscape");
      execFileSync("pandoc", args, { timeout: 120000, stdio: "pipe", env });
    }

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
    for (const f of [mdPath, htmlPath, pdfPath, ...extraTmp, ...tmpFiles]) {
      try { unlinkSync(f); } catch {}
    }
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
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  const title = doc.title || "Untitled";
  const frontmatter = parseFrontmatter(doc.content || "");

  // Per-doc-type exporters take precedence over the core pipeline.
  const ext = getServerExtensionForDocType(frontmatter?.type);
  if (ext?.exporters?.pdf) {
    return ext.exporters.pdf(doc, frontmatter);
  }

  const content = renumberFootnotesForDisplay(doc.content || "");
  return generatePdf(content, title, frontmatter?.orientation === "landscape", getActivePdfStyle());
}

// POST: accepts { content: string } — used by the PM editor to send serialized markdown
export async function action({ request, params }: Route.ActionArgs) {
  await ensurePluginsLoaded();
  const doc = await authorizeDoc(request, params);
  const { content = "" } = await request.json() as { content?: string };
  return generatePdf(content, doc.title || "Untitled", false, getActivePdfStyle());
}
