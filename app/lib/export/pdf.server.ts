// Pure-JS PDF renderer: marked tokens → pdfmake document → PDF buffer.
// No external binaries. Opinionated house styles live in plugins, not here —
// a plugin's `globalExporters.pdf` calls `renderPdf(..., style)` with its own
// `PdfStyle`; every field is optional and falls back to the core defaults.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Token, Tokens } from "marked";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { lexDoc, resolveImages, fitWidth, footnoteInline, matchCallout, type ResolvedImage } from "./shared.server";

// pdfmake's node entry (PdfPrinter) is CJS with internal requires; load it via
// createRequire so the SSR bundler leaves it external.
const require = createRequire(import.meta.url);

const fontsDir = resolve(process.cwd(), "assets/fonts");
const fonts = {
  IBMPlexSans: {
    normal: `${fontsDir}/IBMPlexSans-Regular.otf`,
    bold: `${fontsDir}/IBMPlexSans-Bold.otf`,
    italics: `${fontsDir}/IBMPlexSans-Italic.otf`,
    bolditalics: `${fontsDir}/IBMPlexSans-BoldItalic.otf`,
  },
  IBMPlexMono: {
    normal: `${fontsDir}/IBMPlexMono-Regular.otf`,
    bold: `${fontsDir}/IBMPlexMono-Bold.otf`,
    italics: `${fontsDir}/IBMPlexMono-Italic.otf`,
    bolditalics: `${fontsDir}/IBMPlexMono-BoldItalic.otf`,
  },
};

type Margins = [number, number, number, number];
type Six = [number, number, number, number, number, number];

/** House-style overrides for `renderPdf`. Omitted fields use the core defaults. */
export interface PdfStyle {
  fontSize?: number;
  lineHeight?: number;
  /** [left, top, right, bottom] in pt. */
  pageMargins?: Margins;
  /** h1..h6 font sizes in pt. */
  headingSizes?: Six;
  /** h1..h6 space above / below in pt. */
  headingMargins?: { top: Six; bottom: Six };
  colors?: {
    body?: string;
    link?: string;
    codeBg?: string;
    codeFg?: string;
    quote?: string;
    footnote?: string;
    rule?: string;
  };
  codeFontSize?: number;
  /** Render date-like text (2026-03-02, 03/02/2026, March 2 2026…) in monospace. */
  dateInMono?: boolean;
  /** Render paragraphs starting with "Source" as small, muted captions. */
  sourceCaptions?: boolean;
  pageNumbers?: false | "left" | "center" | "right";
}

type Style = Required<Omit<PdfStyle, "colors">> & { colors: Required<NonNullable<PdfStyle["colors"]>> };

const DEFAULT_STYLE: Style = {
  fontSize: 11,
  lineHeight: 1.35,
  pageMargins: [50, 50, 50, 50],
  headingSizes: [22, 18, 15, 13, 12, 11],
  headingMargins: { top: [12, 12, 8, 8, 8, 8], bottom: [4, 4, 4, 4, 4, 4] },
  colors: {
    body: "#000000",
    link: "#0b62d6",
    codeBg: "#f4f4f4",
    codeFg: "#000000",
    quote: "#555555",
    footnote: "#333333",
    rule: "#cccccc",
  },
  codeFontSize: 9,
  dateInMono: false,
  sourceCaptions: false,
  pageNumbers: false,
};

function resolveStyle(style: PdfStyle = {}): Style {
  return {
    ...DEFAULT_STYLE,
    ...style,
    headingMargins: style.headingMargins ?? DEFAULT_STYLE.headingMargins,
    colors: { ...DEFAULT_STYLE.colors, ...style.colors },
  };
}

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
// Same patterns as critica-pdf's date-code.lua: ISO, slash, dot, and spelled-out months.
const DATE_RE = new RegExp(
  [
    "\\d{4}[-–]\\d{2}[-–]\\d{2}",
    "\\d{1,2}/\\d{1,2}/\\d{4}",
    "\\d{4}/\\d{1,2}/\\d{1,2}",
    "\\d{1,2}\\.\\d{1,2}\\.\\d{4}",
    `${MONTH} \\d{1,2},? \\d{4}`,
    `\\d{1,2} ${MONTH} \\d{4}`,
  ].map((p) => `\\b${p}\\b`).join("|"),
  "g",
);

type Inline = { text: string } & Record<string, unknown>;

// ── Inline rendering ─────────────────────────────────────────────────────────

/** A plain text run, split so date-like substrings print in mono when enabled. */
function textRuns(text: string, base: Partial<Inline>, s: Style): Inline[] {
  if (!s.dateInMono) return [{ text, ...base }];
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(DATE_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), ...base });
    out.push({ text: m[0].replace(/–/g, "-"), ...base, font: "IBMPlexMono" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ...base });
  return out.length ? out : [{ text, ...base }];
}

function renderInline(tokens: Token[] | undefined, s: Style, base: Partial<Inline> = {}): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const tk = t as Tokens.Text;
        if (tk.tokens?.length) out.push(...renderInline(tk.tokens, s, base));
        else out.push(...textRuns(tk.text, base, s));
        break;
      }
      case "escape":
        out.push({ text: (t as Tokens.Escape).text, ...base });
        break;
      case "strong":
        out.push(...renderInline((t as Tokens.Strong).tokens, s, { ...base, bold: true }));
        break;
      case "em":
        out.push(...renderInline((t as Tokens.Em).tokens, s, { ...base, italics: true }));
        break;
      case "del":
        out.push(...renderInline((t as Tokens.Del).tokens, s, { ...base, decoration: "lineThrough" }));
        break;
      case "codespan":
        out.push({
          text: (t as Tokens.Codespan).text,
          font: "IBMPlexMono",
          fontSize: s.codeFontSize,
          color: s.colors.codeFg,
          background: s.colors.codeBg,
          ...base,
        });
        break;
      case "link": {
        const lk = t as Tokens.Link;
        const runs = renderInline(lk.tokens, s, { ...base, color: s.colors.link, decoration: "underline" });
        for (const r of runs) (r as Record<string, unknown>).link = lk.href;
        out.push(...runs);
        break;
      }
      case "br":
        out.push({ text: "\n", ...base });
        break;
      case "footnoteRef":
        out.push({ text: ` [${(t as Tokens.Generic).id}]`, fontSize: 8, ...base });
        break;
      default: {
        const txt = (t as Tokens.Generic).text;
        if (typeof txt === "string") out.push({ text: txt, ...base });
      }
    }
  }
  return out.length ? out : [{ text: "", ...base }];
}

// ── Block rendering ──────────────────────────────────────────────────────────

function isSourceCaption(p: Tokens.Paragraph): boolean {
  return /^\s*[*_]*Source/.test(p.text);
}

function renderBlocks(tokens: Token[], images: Map<string, ResolvedImage>, contentWidth: number, s: Style): Content[] {
  const out: Content[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const i = h.depth - 1;
        out.push({
          text: renderInline(h.tokens, s),
          fontSize: s.headingSizes[i] ?? s.fontSize,
          bold: true,
          margin: [0, s.headingMargins.top[i] ?? 8, 0, s.headingMargins.bottom[i] ?? 4],
        });
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        // A paragraph that is a lone image renders as a block image.
        if (p.tokens?.length === 1 && p.tokens[0].type === "image") {
          out.push(...renderImage(p.tokens[0] as Tokens.Image, images, contentWidth));
        } else if (s.sourceCaptions && isSourceCaption(p)) {
          out.push({
            text: renderInline(p.tokens, s),
            fontSize: Math.round(s.fontSize * 0.8 * 10) / 10,
            color: "#737373",
            margin: [0, -4, 0, 8],
          });
        } else {
          out.push({ text: renderInline(p.tokens, s), margin: [0, 0, 0, 8] });
        }
        break;
      }
      case "image":
        out.push(...renderImage(t as Tokens.Image, images, contentWidth));
        break;
      case "list":
        out.push(renderList(t as Tokens.List, images, contentWidth, s));
        break;
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        // A callout prints as a plain quote; matchCallout only strips its
        // `[!NOTE]` marker so it doesn't land on the page as literal text.
        const body = matchCallout(bq)?.tokens ?? bq.tokens;
        out.push({
          margin: [12, 0, 0, 8],
          stack: renderBlocks(body, images, contentWidth - 12, s),
          color: s.colors.quote,
          italics: true,
        });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        out.push({
          text: c.text,
          font: "IBMPlexMono",
          fontSize: s.codeFontSize,
          color: s.colors.codeFg,
          margin: [0, 0, 0, 8],
          background: s.colors.codeBg,
          preserveLeadingSpaces: true,
        });
        break;
      }
      case "table":
        out.push(renderTable(t as Tokens.Table, s));
        break;
      case "hr":
        out.push({
          canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5, lineColor: s.colors.rule }],
          margin: [0, 6, 0, 10],
        });
        break;
      case "space":
        break;
      default: {
        const txt = (t as Tokens.Generic).text;
        if (typeof txt === "string" && txt.trim()) out.push({ text: txt, margin: [0, 0, 0, 8] });
      }
    }
  }
  return out;
}

function renderImage(t: Tokens.Image, images: Map<string, ResolvedImage>, contentWidth: number): Content[] {
  const img = images.get(t.href);
  if (!img) return [];
  const dataUrl = `data:${img.mime};base64,${img.buffer.toString("base64")}`;
  return [{ image: dataUrl, width: fitWidth(img, contentWidth), margin: [0, 0, 0, 8] }];
}

function renderList(t: Tokens.List, images: Map<string, ResolvedImage>, contentWidth: number, s: Style): Content {
  const items: Content[] = t.items.map((item) => {
    const blocks = renderBlocks(item.tokens, images, contentWidth - 15, s);
    return blocks.length === 1 ? blocks[0] : { stack: blocks };
  });
  return t.ordered
    ? { ol: items, margin: [0, 0, 0, 8] }
    : { ul: items, margin: [0, 0, 0, 8] };
}

function renderTable(t: Tokens.Table, s: Style): Content {
  const header = t.header.map((c) => ({ text: renderInline(c.tokens, s), bold: true }));
  const body = t.rows.map((row) => row.map((c) => ({ text: renderInline(c.tokens, s) })));
  return {
    table: { headerRows: 1, widths: t.header.map(() => "*"), body: [header, ...body] },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 10],
    fontSize: Math.min(10, s.fontSize),
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderPdf(markdown: string, title: string, landscape = false, style?: PdfStyle): Promise<Buffer> {
  const s = resolveStyle(style);
  const { tokens, footnotes } = lexDoc(markdown);
  const images = await resolveImages(tokens);

  // A4 content box width in pt: page width minus left/right margins.
  const [ml, , mr] = s.pageMargins;
  const contentWidth = (landscape ? 842 : 595) - ml - mr;
  const content = renderBlocks(tokens, images, contentWidth, s);

  if (footnotes.length) {
    content.push({
      canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5, lineColor: s.colors.rule }],
      margin: [0, 16, 0, 8],
    });
    content.push({
      ol: footnotes.map((fn) => ({ text: renderInline(footnoteInline(fn.content as Token[]), s) })),
      fontSize: 9,
      color: s.colors.footnote,
    });
  }

  const pageNumbers = s.pageNumbers;
  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: s.pageMargins,
    info: { title },
    defaultStyle: { font: "IBMPlexSans", fontSize: s.fontSize, lineHeight: s.lineHeight, color: s.colors.body },
    footer: pageNumbers
      ? (currentPage: number) => ({
          text: String(currentPage),
          alignment: pageNumbers,
          fontSize: 8.5,
          margin: [ml, 20, mr, 0],
        })
      : undefined,
    content,
  };

  const PdfPrinter = require("pdfmake/js/Printer").default;
  const URLResolver = require("pdfmake/js/URLResolver").default;
  const vfs = require("pdfmake/js/virtual-fs").default;
  // Fonts are local file paths, never remote URLs, so the resolver never
  // actually fetches anything — pdfmake just requires one to be present.
  const printer = new PdfPrinter(fonts, vfs, new URLResolver(vfs));
  const pdfDoc = await printer.createPdfKitDocument(docDefinition);

  return await new Promise<Buffer>((res, rej) => {
    const chunks: Buffer[] = [];
    pdfDoc.on("data", (c: Buffer) => chunks.push(c));
    pdfDoc.on("end", () => res(Buffer.concat(chunks)));
    pdfDoc.on("error", rej);
    pdfDoc.end();
  });
}
