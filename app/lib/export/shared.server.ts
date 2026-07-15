// Shared export plumbing for the pure-JS PDF/DOCX renderers.
//
// Both renderers start from the same canonical intermediate: a `marked` token
// tree (GFM tables + footnotes). This keeps PDF and DOCX output structurally
// in sync and means the core needs no external binaries — only npm deps
// (marked, sharp, pdfmake, docx). Opinionated pipelines (e.g. Critica's
// pandoc/LaTeX house style) live in drop-in plugins via `globalExporters`.

import { Marked, type Token, type Tokens } from "marked";
import markedFootnote, { type Footnote } from "marked-footnote";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import sharp from "sharp";

export interface LexedDoc {
  tokens: Token[];
  /** Footnote bodies in reference order; index 0 = `[^1]`. */
  footnotes: Footnote[];
}

/**
 * Tokenize markdown into the shared intermediate. Footnote definitions are
 * pulled out of the token stream and returned separately so each renderer can
 * place them as it prefers (PDF: endnotes section; DOCX: real Word footnotes).
 */
export function lexDoc(markdown: string): LexedDoc {
  // Strip legacy `{width=Npx}` image markers (an old pandoc Lua-filter syntax);
  // marked has no link-attribute syntax, so left in they'd render as literal
  // text after the image. Images now fit to the content box automatically.
  const cleaned = markdown.replace(/(!\[[^\]]*\]\([^)]+\))\{width=\d+px\}/g, "$1");
  const marked = new Marked().use(markedFootnote());
  const tokens = marked.lexer(cleaned);

  let footnotes: Footnote[] = [];
  // marked-footnote appends a single `footnotes` block token at the end.
  const idx = tokens.findIndex((t) => t.type === "footnotes");
  if (idx !== -1) {
    footnotes = (tokens[idx] as unknown as Tokens.Generic & { items: Footnote[] }).items ?? [];
    tokens.splice(idx, 1);
  }
  return { tokens, footnotes };
}

const NATIVE = new Set([".png", ".jpg", ".jpeg"]);

export interface ResolvedImage {
  buffer: Buffer;
  /** image/png or image/jpeg — what the buffer actually is after conversion. */
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/**
 * Resolve a markdown image `src` to bytes + intrinsic dimensions. Only local
 * `/api/uploads/*` paths are read (no remote fetches). Non-native formats are
 * transcoded to PNG via sharp; native PNG/JPEG pass through but are still
 * probed for dimensions. Returns null when the file is missing or unreadable.
 */
export async function resolveImage(src: string): Promise<ResolvedImage | null> {
  const m = /^\/api\/uploads\/(.+)$/.exec(src);
  if (!m) return null;
  const srcPath = join(process.cwd(), "uploads", m[1]);
  if (!existsSync(srcPath)) return null;

  try {
    const ext = extname(srcPath).toLowerCase();
    if (NATIVE.has(ext)) {
      const meta = await sharp(srcPath).metadata();
      const { default: fs } = await import("node:fs");
      return {
        buffer: fs.readFileSync(srcPath),
        mime: ext === ".png" ? "image/png" : "image/jpeg",
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      };
    }
    const out = await sharp(srcPath).png().toBuffer({ resolveWithObject: true });
    return { buffer: out.data, mime: "image/png", width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

/**
 * Collect every distinct `/api/uploads/*` image referenced in the token tree
 * and resolve them once, up front (so the renderers stay synchronous). Returns
 * a map from original src → resolved image.
 */
export async function resolveImages(tokens: Token[]): Promise<Map<string, ResolvedImage>> {
  const srcs = new Set<string>();
  const walk = (toks: Token[] | undefined) => {
    for (const t of toks ?? []) {
      if (t.type === "image") srcs.add((t as Tokens.Image).href);
      walk((t as Tokens.Generic).tokens);
      // table cells nest tokens under header/rows
      const tbl = t as Tokens.Table;
      if (t.type === "table") {
        for (const c of tbl.header) walk(c.tokens);
        for (const row of tbl.rows) for (const c of row) walk(c.tokens);
      }
      const list = t as Tokens.List;
      if (t.type === "list") for (const item of list.items) walk(item.tokens);
    }
  };
  walk(tokens);

  const entries = await Promise.all(
    [...srcs].map(async (src) => [src, await resolveImage(src)] as const),
  );
  const map = new Map<string, ResolvedImage>();
  for (const [src, img] of entries) if (img) map.set(src, img);
  return map;
}

/**
 * Flatten a footnote body (block tokens — paragraph(s), maybe leading space)
 * into a single inline token stream, so renderers can emit it as one run of
 * text. Paragraph breaks become a single space.
 */
export function footnoteInline(content: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of content) {
    if (t.type === "space") continue;
    if (t.type === "paragraph") {
      if (out.length) out.push({ type: "text", raw: " ", text: " " } as Token);
      out.push(...((t as Tokens.Paragraph).tokens ?? []));
    } else {
      out.push(t);
    }
  }
  return out;
}

// Callouts are serialized as GitHub alerts (`> [!NOTE]`), which `marked` lexes
// as an ordinary blockquote. Both renderers detect that shape here so the `[!X]`
// marker doesn't leak into the page as literal text. The exported callout is a
// plain quote for now — giving it a printed style is a separate job.
const ALERT_RE = /^\[!(note|tip|important|warning|caution|danger)\][ \t]*\n?/i;
const ALERT_VARIANT: Record<string, string> = {
  note: "note", important: "note", tip: "tip",
  warning: "warning", caution: "danger", danger: "danger",
};

/**
 * If `bq` is a GitHub alert, return its variant plus the body tokens with the
 * `[!X]` label stripped off. Returns null for a plain blockquote.
 */
export function matchCallout(bq: Tokens.Blockquote): { variant: string; tokens: Token[] } | null {
  const [first, ...rest] = bq.tokens ?? [];
  if (first?.type !== "paragraph") return null;
  const para = first as Tokens.Paragraph;
  const m = ALERT_RE.exec(para.text ?? "");
  if (!m) return null;

  // Strip the label from the paragraph's text and from its leading inline text
  // token (marked keeps the whole first line in that token's `text`).
  const inline = [...(para.tokens ?? [])];
  const lead = inline[0] as Tokens.Text | undefined;
  if (lead?.type === "text") {
    const stripped = (lead.text ?? "").replace(ALERT_RE, "");
    if (stripped) inline[0] = { ...lead, text: stripped, raw: stripped } as Token;
    else inline.shift();
  }
  const body: Token[] = inline.length
    ? [{ ...para, text: (para.text ?? "").replace(ALERT_RE, ""), tokens: inline } as Token, ...rest]
    : rest;

  return { variant: ALERT_VARIANT[m[1].toLowerCase()] ?? "note", tokens: body };
}

/** Cap an image's render width to fit the page content box (in pt). */
export function fitWidth(img: ResolvedImage, maxWidth: number): number {
  if (!img.width) return maxWidth;
  // Assume 96dpi source pixels → pt (×0.75). Never upscale past intrinsic.
  const ptWidth = img.width * 0.75;
  return Math.min(ptWidth, maxWidth);
}

/** Sanitize a document title into a safe download filename (no extension). */
export function safeFilename(title: string): string {
  return (title || "Untitled").replace(/[^a-zA-Z0-9_\-. ]/g, "_");
}
