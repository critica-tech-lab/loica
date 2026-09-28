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

const PAGE_WIDTH = { A4: [595, 842], LETTER: [612, 792] } as const;

export interface PdfHeadingStyle {
  fontSize?: number;
  bold?: boolean;
  italics?: boolean;
  /** Render the heading text uppercase. */
  caps?: boolean;
  color?: string;
  characterSpacing?: number;
  /** Space [above, below] in pt. */
  margin?: [number, number];
}

/** House-style overrides for `renderPdf`. Omitted fields use the core defaults. */
export interface PdfStyle {
  pageSize?: keyof typeof PAGE_WIDTH;
  fontSize?: number;
  lineHeight?: number;
  /** [left, top, right, bottom] in pt. */
  pageMargins?: Margins;
  /** Margins for `orientation: landscape` docs. Defaults to `pageMargins`. */
  landscapePageMargins?: Margins;
  /** h1..h6, each merged over the core default for that level. */
  headings?: PdfHeadingStyle[];
  colors?: {
    body?: string;
    link?: string;
    /** Inline code + mono dates. */
    codeBg?: string;
    codeBlockBg?: string;
    codeFg?: string;
    quote?: string;
    footnote?: string;
    rule?: string;
    /** "Source…" captions and page numbers. */
    caption?: string;
  };
  linkUnderline?: boolean;
  /** Inline code + mono dates. */
  codeFontSize?: number;
  codeBlockFontSize?: number;
  quote?: { italics?: boolean; /** [left, right] indent in pt. */ indent?: [number, number] };
  /** "lines": light rule under every row. "booktabs": top, below-header and bottom rules only. */
  tableLayout?: "lines" | "booktabs";
  /** Render date-like text (2026-03-02, 03/02/2026, March 2 2026…) like inline code. */
  dateInMono?: boolean;
  /** Render paragraphs starting with "Source" as small, muted captions. */
  sourceCaptions?: boolean;
  footnoteRefs?: "bracket" | "superscript";
  pageNumbers?: false | "left" | "center" | "right";
}

type Style = Required<Omit<PdfStyle, "colors" | "quote" | "headings" | "landscapePageMargins">> & {
  colors: Required<NonNullable<PdfStyle["colors"]>>;
  quote: Required<NonNullable<PdfStyle["quote"]>>;
  headings: PdfHeadingStyle[];
  landscapePageMargins: Margins;
};

const DEFAULT_HEADINGS: PdfHeadingStyle[] = [22, 18, 15, 13, 12, 11].map((fontSize, i) => ({
  fontSize,
  bold: true,
  margin: [i < 2 ? 12 : 8, 4],
}));

const DEFAULT_STYLE: Omit<Style, "landscapePageMargins"> = {
  pageSize: "A4",
  fontSize: 11,
  lineHeight: 1.35,
  pageMargins: [50, 50, 50, 50],
  headings: DEFAULT_HEADINGS,
  colors: {
    body: "#000000",
    link: "#0b62d6",
    codeBg: "#f4f4f4",
    codeBlockBg: "#f4f4f4",
    codeFg: "#000000",
    quote: "#555555",
    footnote: "#333333",
    rule: "#cccccc",
    caption: "#737373",
  },
  linkUnderline: true,
  codeFontSize: 9,
  codeBlockFontSize: 9,
  quote: { italics: true, indent: [12, 0] },
  tableLayout: "lines",
  dateInMono: false,
  sourceCaptions: false,
  footnoteRefs: "bracket",
  pageNumbers: false,
};

function resolveStyle(style: PdfStyle = {}): Style {
  const pageMargins = style.pageMargins ?? DEFAULT_STYLE.pageMargins;
  return {
    ...DEFAULT_STYLE,
    ...style,
    pageMargins,
    landscapePageMargins: style.landscapePageMargins ?? pageMargins,
    headings: DEFAULT_HEADINGS.map((h, i) => ({ ...h, ...style.headings?.[i] })),
    colors: { ...DEFAULT_STYLE.colors, ...style.colors },
    quote: { ...DEFAULT_STYLE.quote, ...style.quote },
  };
}

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
// Date-like text: ISO, slash, dot, and spelled-out English months.
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

function codeRun(text: string, base: Partial<Inline>, s: Style): Inline {
  return {
    text,
    font: "IBMPlexMono",
    fontSize: s.codeFontSize,
    color: s.colors.codeFg,
    background: s.colors.codeBg,
    ...base,
  };
}

/** A plain text run, split so date-like substrings print as code when enabled. */
function textRuns(text: string, base: Partial<Inline>, s: Style): Inline[] {
  if (!s.dateInMono) return [{ text, ...base }];
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(DATE_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), ...base });
    out.push(codeRun(m[0].replace(/–/g, "-"), base, s));
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
        out.push(codeRun((t as Tokens.Codespan).text, base, s));
        break;
      case "link": {
        const lk = t as Tokens.Link;
        const runs = renderInline(lk.tokens, s, { ...base, color: s.colors.link, ...(s.linkUnderline && { decoration: "underline" }) });
        for (const r of runs) (r as Record<string, unknown>).link = lk.href;
        out.push(...runs);
        break;
      }
      case "br":
        out.push({ text: "\n", ...base });
        break;
      case "footnoteRef": {
        const id = (t as Tokens.Generic).id;
        out.push(
          s.footnoteRefs === "superscript"
            ? { text: String(id), sup: true, fontSize: 7.5, ...base }
            : { text: ` [${id}]`, fontSize: 8, ...base },
        );
        break;
      }
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
        const hs = s.headings[h.depth - 1] ?? s.headings[5];
        let runs = renderInline(h.tokens, s);
        if (hs.caps) runs = runs.map((r) => ({ ...r, text: r.text.toUpperCase() }));
        const [above, below] = hs.margin ?? [8, 4];
        out.push({
          text: runs,
          fontSize: hs.fontSize ?? s.fontSize,
          bold: !!hs.bold,
          italics: !!hs.italics,
          color: hs.color,
          characterSpacing: hs.characterSpacing,
          margin: [0, above, 0, below],
        });
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        // A paragraph that is a lone image renders as a block image.
        if (p.tokens?.length === 1 && p.tokens[0].type === "image") {
          out.push(...renderImage(p.tokens[0] as Tokens.Image, images, contentWidth));
        } else if (s.sourceCaptions && isSourceCaption(p)) {
          out.push({ text: renderInline(p.tokens, s), fontSize: 9, color: s.colors.caption, margin: [0, 2, 0, 8] });
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
        const [left, right] = s.quote.indent;
        out.push({
          margin: [left, 0, right, 8],
          stack: renderBlocks(body, images, contentWidth - left - right, s),
          color: s.colors.quote,
          italics: s.quote.italics,
        });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        // A one-cell table so the background fills a padded box, not just the text lines.
        out.push({
          table: {
            widths: ["*"],
            body: [[{
              text: c.text,
              font: "IBMPlexMono",
              fontSize: s.codeBlockFontSize,
              color: s.colors.codeFg,
              preserveLeadingSpaces: true,
            }]],
          },
          layout: {
            defaultBorder: false,
            fillColor: () => s.colors.codeBlockBg,
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
          margin: [0, 2, 0, 9],
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
  const table = { headerRows: 1, widths: t.header.map(() => "*"), body: [header, ...body] };
  if (s.tableLayout === "booktabs") {
    const cols = t.header.length;
    return {
      table,
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
          i === 0 || i === 1 || i === node.table.body.length ? 0.4 : 0,
        vLineWidth: () => 0,
        hLineColor: () => s.colors.rule,
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: (i: number) => (i === 0 ? 0 : 6),
        paddingRight: () => 6,
      },
      // Shrink wide tables so they fit the text column.
      fontSize: cols >= 8 ? 7.5 : cols >= 6 ? 8.5 : 9,
      margin: [0, 2, 0, 11],
    };
  }
  return { table, layout: "lightHorizontalLines", margin: [0, 0, 0, 10], fontSize: Math.min(10, s.fontSize) };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderPdf(markdown: string, title: string, landscape = false, style?: PdfStyle): Promise<Buffer> {
  const s = resolveStyle(style);
  const { tokens, footnotes } = lexDoc(markdown);
  const images = await resolveImages(tokens);

  // Content box width in pt: page width minus left/right margins.
  const pageMargins = landscape ? s.landscapePageMargins : s.pageMargins;
  const [ml, , mr] = pageMargins;
  const contentWidth = PAGE_WIDTH[s.pageSize][landscape ? 1 : 0] - ml - mr;
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
    pageSize: s.pageSize,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins,
    info: { title },
    defaultStyle: { font: "IBMPlexSans", fontSize: s.fontSize, lineHeight: s.lineHeight, color: s.colors.body },
    footer: pageNumbers
      ? (currentPage: number) => ({
          text: String(currentPage),
          alignment: pageNumbers,
          fontSize: 8,
          color: s.colors.caption,
          margin: [ml, 16, mr, 0],
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
