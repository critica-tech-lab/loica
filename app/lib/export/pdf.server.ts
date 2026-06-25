// Pure-JS PDF renderer: marked tokens → pdfmake document → PDF buffer.
// No external binaries. Opinionated house styles live in plugins, not here.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Token, Tokens } from "marked";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { lexDoc, resolveImages, fitWidth, footnoteInline, type ResolvedImage } from "./shared.server";

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

const HEADING_SIZE = [22, 18, 15, 13, 12, 11];

type Inline = { text: string } & Record<string, unknown>;

// ── Inline rendering ─────────────────────────────────────────────────────────

function renderInline(tokens: Token[] | undefined, base: Partial<Inline> = {}): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const tk = t as Tokens.Text;
        if (tk.tokens?.length) out.push(...renderInline(tk.tokens, base));
        else out.push({ text: tk.text, ...base });
        break;
      }
      case "escape":
        out.push({ text: (t as Tokens.Escape).text, ...base });
        break;
      case "strong":
        out.push(...renderInline((t as Tokens.Strong).tokens, { ...base, bold: true }));
        break;
      case "em":
        out.push(...renderInline((t as Tokens.Em).tokens, { ...base, italics: true }));
        break;
      case "del":
        out.push(...renderInline((t as Tokens.Del).tokens, { ...base, decoration: "lineThrough" }));
        break;
      case "codespan":
        out.push({ text: (t as Tokens.Codespan).text, font: "IBMPlexMono", ...base });
        break;
      case "link": {
        const lk = t as Tokens.Link;
        const runs = renderInline(lk.tokens, { ...base, color: "#0b62d6", decoration: "underline" });
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

function renderBlocks(tokens: Token[], images: Map<string, ResolvedImage>, contentWidth: number): Content[] {
  const out: Content[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        out.push({
          text: renderInline(h.tokens),
          fontSize: HEADING_SIZE[h.depth - 1] ?? 11,
          bold: true,
          margin: [0, h.depth <= 2 ? 12 : 8, 0, 4],
        });
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        // A paragraph that is a lone image renders as a block image.
        if (p.tokens?.length === 1 && p.tokens[0].type === "image") {
          out.push(...renderImage(p.tokens[0] as Tokens.Image, images, contentWidth));
        } else {
          out.push({ text: renderInline(p.tokens), margin: [0, 0, 0, 8] });
        }
        break;
      }
      case "image":
        out.push(...renderImage(t as Tokens.Image, images, contentWidth));
        break;
      case "list":
        out.push(renderList(t as Tokens.List, images, contentWidth));
        break;
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        out.push({
          margin: [12, 0, 0, 8],
          stack: renderBlocks(bq.tokens, images, contentWidth - 12),
          color: "#555555",
          italics: true,
        });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        out.push({
          text: c.text,
          font: "IBMPlexMono",
          fontSize: 9,
          margin: [0, 0, 0, 8],
          background: "#f4f4f4",
          preserveLeadingSpaces: true,
        });
        break;
      }
      case "table":
        out.push(renderTable(t as Tokens.Table));
        break;
      case "hr":
        out.push({
          canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5, lineColor: "#cccccc" }],
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

function renderList(t: Tokens.List, images: Map<string, ResolvedImage>, contentWidth: number): Content {
  const items: Content[] = t.items.map((item) => {
    const blocks = renderBlocks(item.tokens, images, contentWidth - 15);
    return blocks.length === 1 ? blocks[0] : { stack: blocks };
  });
  return t.ordered
    ? { ol: items, margin: [0, 0, 0, 8] }
    : { ul: items, margin: [0, 0, 0, 8] };
}

function renderTable(t: Tokens.Table): Content {
  const header = t.header.map((c) => ({ text: renderInline(c.tokens), bold: true }));
  const body = t.rows.map((row) => row.map((c) => ({ text: renderInline(c.tokens) })));
  return {
    table: { headerRows: 1, widths: t.header.map(() => "*"), body: [header, ...body] },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 10],
    fontSize: 10,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderPdf(markdown: string, title: string, landscape = false): Promise<Buffer> {
  const { tokens, footnotes } = lexDoc(markdown);
  const images = await resolveImages(tokens);

  // A4 content box width in pt (595/842 page minus 50pt margins each side).
  const contentWidth = (landscape ? 842 : 595) - 100;
  const content = renderBlocks(tokens, images, contentWidth);

  if (footnotes.length) {
    content.push({
      canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5, lineColor: "#cccccc" }],
      margin: [0, 16, 0, 8],
    });
    content.push({
      ol: footnotes.map((fn) => ({ text: renderInline(footnoteInline(fn.content as Token[])) })),
      fontSize: 9,
      color: "#333333",
    });
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [50, 50, 50, 50],
    info: { title },
    defaultStyle: { font: "IBMPlexSans", fontSize: 11, lineHeight: 1.35 },
    content,
  };

  const PdfPrinter = require("pdfmake/src/printer");
  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDefinition);

  return await new Promise<Buffer>((res, rej) => {
    const chunks: Buffer[] = [];
    pdfDoc.on("data", (c: Buffer) => chunks.push(c));
    pdfDoc.on("end", () => res(Buffer.concat(chunks)));
    pdfDoc.on("error", rej);
    pdfDoc.end();
  });
}
