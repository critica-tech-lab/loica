// Pure-JS DOCX renderer: marked tokens → docx primitives → .docx buffer.
// No external binaries (replaces the old pandoc path). Shares the same token
// intermediate as the PDF renderer so the two stay structurally aligned.

import type { Token, Tokens } from "marked";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink,
  Table, TableRow, TableCell, WidthType, ImageRun, FootnoteReferenceRun, AlignmentType,
  TableLayoutType, CommentRangeStart, CommentRangeEnd, CommentReference,
} from "docx";
import { lexDoc, resolveImages, fitWidth, footnoteInline, type ResolvedImage } from "./shared.server";
import type { CommentThread } from "~/lib/comments.server";

const HEADING = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
];

type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean; font?: string };
type InlineRun = TextRun | ExternalHyperlink | FootnoteReferenceRun | ImageRun;
// Paragraph children incl. comment range markers (inserted around anchored text).
type ParaChild = InlineRun | CommentRangeStart | CommentRangeEnd;

// Inline content as splittable specs: `text` carries plain text (so it can be
// cut at comment char-offsets while keeping its style); `atomic` is an opaque
// run (link/image/footnote/break) that counts `len` visible chars but is never
// split.
type RunSpec =
  | { kind: "text"; text: string; style: RunStyle }
  | { kind: "atomic"; node: InlineRun; len: number };

function inlineSpecs(
  tokens: Token[] | undefined,
  images: Map<string, ResolvedImage>,
  style: RunStyle = {},
): RunSpec[] {
  const out: RunSpec[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const tk = t as Tokens.Text;
        if (tk.tokens?.length) out.push(...inlineSpecs(tk.tokens, images, style));
        else out.push({ kind: "text", text: tk.text, style });
        break;
      }
      case "escape":
        out.push({ kind: "text", text: (t as Tokens.Escape).text, style });
        break;
      case "strong":
        out.push(...inlineSpecs((t as Tokens.Strong).tokens, images, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineSpecs((t as Tokens.Em).tokens, images, { ...style, italics: true }));
        break;
      case "del":
        out.push(...inlineSpecs((t as Tokens.Del).tokens, images, { ...style, strike: true }));
        break;
      case "codespan":
        out.push({ kind: "text", text: (t as Tokens.Codespan).text, style: { ...style, font: "IBM Plex Mono" } });
        break;
      case "link": {
        const lk = t as Tokens.Link;
        const childRuns = specsToRuns(inlineSpecs(lk.tokens, images, style)).filter((r) => r instanceof TextRun) as TextRun[];
        out.push({ kind: "atomic", node: new ExternalHyperlink({ link: lk.href, children: childRuns }), len: lk.text?.length ?? 0 });
        break;
      }
      case "br":
        out.push({ kind: "atomic", node: new TextRun({ text: "", break: 1 }), len: 0 });
        break;
      case "footnoteRef":
        out.push({ kind: "atomic", node: new FootnoteReferenceRun(Number((t as Tokens.Generic).id)), len: 0 });
        break;
      case "image": {
        const run = imageRun(t as Tokens.Image, images, 450);
        if (run) out.push({ kind: "atomic", node: run, len: 0 });
        break;
      }
      default: {
        const txt = (t as Tokens.Generic).text;
        if (typeof txt === "string") out.push({ kind: "text", text: txt, style });
      }
    }
  }
  return out;
}

function specsToRuns(specs: RunSpec[]): InlineRun[] {
  return specs.map((s) => (s.kind === "text" ? new TextRun({ text: s.text, ...s.style }) : s.node));
}

function renderInline(
  tokens: Token[] | undefined,
  images: Map<string, ResolvedImage>,
  style: RunStyle = {},
): InlineRun[] {
  return specsToRuns(inlineSpecs(tokens, images, style));
}

/** Plain text of a spec list (for matching comment anchor_text). */
function specsText(specs: RunSpec[]): string {
  return specs.map((s) => (s.kind === "text" ? s.text : "x".repeat(s.len))).join("");
}

/**
 * Materialize specs to runs, inserting Word comment range markers at the given
 * char ranges. Ranges are non-overlapping, sorted by start; boundaries that
 * fall inside a `text` spec split it, boundaries inside an `atomic` snap to its
 * nearest edge.
 */
function specsToRunsWithComments(specs: RunSpec[], ranges: { start: number; end: number; id: number }[]): ParaChild[] {
  const startAt = new Map<number, number>();
  const endAt = new Map<number, number>();
  for (const r of ranges) { startAt.set(r.start, r.id); endAt.set(r.end, r.id); }
  const out: ParaChild[] = [];
  const emit = (pos: number) => {
    if (endAt.has(pos)) {
      const id = endAt.get(pos)!;
      out.push(new CommentRangeEnd(id));
      out.push(new TextRun({ children: [new CommentReference(id)] }));
    }
    if (startAt.has(pos)) out.push(new CommentRangeStart(startAt.get(pos)!));
  };
  let off = 0;
  for (const s of specs) {
    if (s.kind === "atomic") {
      emit(off);
      out.push(s.node);
      off += s.len;
      continue;
    }
    const end = off + s.text.length;
    const bounds = [...new Set([...startAt.keys(), ...endAt.keys()])]
      .filter((p) => p > off && p < end)
      .sort((a, b) => a - b);
    let prev = off;
    emit(off);
    for (const p of bounds) {
      const slice = s.text.slice(prev - off, p - off);
      if (slice) out.push(new TextRun({ text: slice, ...s.style }));
      emit(p);
      prev = p;
    }
    const rest = s.text.slice(prev - off);
    if (rest) out.push(new TextRun({ text: rest, ...s.style }));
    off = end;
  }
  emit(off);
  return out;
}

function imageRun(t: Tokens.Image, images: Map<string, ResolvedImage>, maxWidth: number): ImageRun | null {
  const img = images.get(t.href);
  if (!img) return null;
  const width = fitWidth(img, maxWidth);
  const height = img.width ? (img.height / img.width) * width : width;
  return new ImageRun({
    data: img.buffer,
    type: img.mime === "image/png" ? "png" : "jpg",
    transformation: { width: Math.round(width), height: Math.round(height) },
  });
}

// ── Comment anchoring ────────────────────────────────────────────────────────

interface CommentItem {
  id: number;
  author: string;
  date: Date;
  children: Paragraph[];
}

interface CommentCtx {
  pending: { wordId: number; text: string; thread: CommentThread }[];
  used: Set<number>;
  comments: CommentItem[];
}

function buildWordComment(wordId: number, thread: CommentThread): CommentItem {
  const root = thread.root;
  return {
    id: wordId,
    author: root.user_name,
    date: new Date(root.created_at * 1000),
    children: [
      new Paragraph({ children: [new TextRun(root.body)] }),
      ...thread.replies.map((r) =>
        new Paragraph({ children: [new TextRun({ text: `${r.user_name}: ${r.body}`, italics: true })] })),
    ],
  };
}

/**
 * Render inline tokens to runs, wrapping any unmatched comment anchor whose
 * `anchor_text` appears in this block's text with Word comment markers. Each
 * anchor matches at most once (first block containing it wins); unmatched
 * anchors are silently skipped (best-effort, as agreed).
 */
function inlineWithComments(
  tokens: Token[] | undefined,
  images: Map<string, ResolvedImage>,
  ctx: CommentCtx | undefined,
  style: RunStyle = {},
): ParaChild[] {
  const specs = inlineSpecs(tokens, images, style);
  if (!ctx?.pending.length) return specsToRuns(specs);

  const text = specsText(specs);
  const ranges: { start: number; end: number; id: number }[] = [];
  for (const a of ctx.pending) {
    if (ctx.used.has(a.wordId) || !a.text) continue;
    const idx = text.indexOf(a.text);
    if (idx < 0) continue;
    ranges.push({ start: idx, end: idx + a.text.length, id: a.wordId });
    ctx.used.add(a.wordId);
    ctx.comments.push(buildWordComment(a.wordId, a.thread));
  }
  if (!ranges.length) return specsToRuns(specs);

  // Drop overlaps (keep earliest start) so split boundaries stay well-ordered.
  ranges.sort((x, y) => x.start - y.start);
  const clean: typeof ranges = [];
  let lastEnd = -1;
  for (const r of ranges) if (r.start >= lastEnd) { clean.push(r); lastEnd = r.end; }
  return specsToRunsWithComments(specs, clean);
}

function renderBlocks(tokens: Token[], images: Map<string, ResolvedImage>, ctx?: CommentCtx, listCtx?: { ordered: boolean; level: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        out.push(new Paragraph({ heading: HEADING[h.depth - 1], children: inlineWithComments(h.tokens, images, ctx) }));
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        const isImage = p.tokens?.length === 1 && p.tokens[0].type === "image";
        out.push(new Paragraph({
          children: inlineWithComments(p.tokens, images, ctx),
          alignment: isImage ? AlignmentType.CENTER : undefined,
        }));
        break;
      }
      case "image": {
        const run = imageRun(t as Tokens.Image, images, 450);
        if (run) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run] }));
        break;
      }
      case "list": {
        const list = t as Tokens.List;
        const level = listCtx ? listCtx.level + 1 : 0;
        for (const item of list.items) {
          // A list item mixes inline content (tight items are `text` tokens,
          // loose items are `paragraph` tokens) with nested blocks (sub-lists,
          // code, …). Emit one numbered/bulleted paragraph for the inline part,
          // then render nested blocks after it.
          const inline: Token[] = [];
          const blocks: Token[] = [];
          for (const child of item.tokens ?? []) {
            if (child.type === "text") {
              const tk = child as Tokens.Text;
              inline.push(...(tk.tokens ?? [{ type: "text", text: tk.text } as Token]));
            } else if (child.type === "paragraph") {
              if (inline.length) inline.push({ type: "text", raw: " ", text: " " } as Token);
              inline.push(...((child as Tokens.Paragraph).tokens ?? []));
            } else {
              blocks.push(child);
            }
          }
          out.push(new Paragraph({
            children: inlineWithComments(inline, images, ctx),
            ...(list.ordered ? { numbering: { reference: "ol", level } } : { bullet: { level } }),
          }));
          for (const b of blocks) out.push(...renderBlocks([b], images, ctx, { ordered: !!list.ordered, level }));
        }
        break;
      }
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        for (const block of renderBlocks(bq.tokens, images, ctx)) {
          if (block instanceof Paragraph) out.push(block);
        }
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        for (const line of c.text.split("\n")) {
          out.push(new Paragraph({ children: [new TextRun({ text: line, font: "IBM Plex Mono", size: 18 })] }));
        }
        break;
      }
      case "table":
        out.push(renderTable(t as Tokens.Table, images));
        break;
      case "hr":
        out.push(new Paragraph({ border: { bottom: { style: "single", size: 6, color: "CCCCCC" } }, children: [] }));
        break;
      case "space":
        break;
      default: {
        const txt = (t as Tokens.Generic).text;
        if (typeof txt === "string" && txt.trim()) out.push(new Paragraph({ children: [new TextRun(txt)] }));
      }
    }
  }
  return out;
}

// 6.5in content box = 9360 twips. Use explicit, even column widths + a fixed
// layout so columns render uniformly (a percentage width with no grid makes
// Word collapse columns to ~nothing).
const TABLE_WIDTH = 9360;

function renderTable(t: Tokens.Table, images: Map<string, ResolvedImage>): Table {
  const n = Math.max(1, t.header.length);
  const colW = Math.floor(TABLE_WIDTH / n);
  const widths = Array(n).fill(colW);
  const cell = (tokens: Token[], bold: boolean) =>
    new TableCell({
      width: { size: colW, type: WidthType.DXA },
      children: [new Paragraph({ children: renderInline(tokens, images, bold ? { bold: true } : {}) })],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: t.header.map((c) => cell(c.tokens, true)) }),
    ...t.rows.map((row) => new TableRow({ children: row.map((c) => cell(c.tokens, false)) })),
  ];
  return new Table({
    rows,
    columnWidths: widths,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  });
}

export async function renderDocx(markdown: string, title: string, threads: CommentThread[] = []): Promise<Buffer> {
  const { tokens, footnotes } = lexDoc(markdown);
  const images = await resolveImages(tokens);

  // Comment threads → Word comments, anchored by matching their anchor_text in
  // the rendered text. Word comment ids start at 1.
  const ctx: CommentCtx = {
    pending: threads
      .filter((th) => th.root.anchor_text)
      .map((th, i) => ({ wordId: i + 1, text: th.root.anchor_text as string, thread: th })),
    used: new Set(),
    comments: [],
  };

  const children = renderBlocks(tokens, images, ctx);

  // Real Word footnotes, keyed by reference number (1-based, matches refs).
  const footnoteMap: Record<number, { children: Paragraph[] }> = {};
  footnotes.forEach((fn, i) => {
    footnoteMap[i + 1] = { children: [new Paragraph({ children: renderInline(footnoteInline(fn.content as Token[]), images) })] };
  });

  const doc = new Document({
    title,
    // One explicit baseline for every paragraph (incl. the built-in
    // `ListParagraph` style, which otherwise inherits Word's app default and
    // renders at a different size). 22 half-points = 11pt, matching the PDF.
    styles: {
      default: {
        document: {
          run: { font: "IBM Plex Sans", size: 22 },
          paragraph: { spacing: { after: 160, line: 276 } },
        },
      },
    },
    numbering: {
      config: [{
        reference: "ol",
        levels: [0, 1, 2, 3].map((level) => ({
          level, format: "decimal", text: `%${level + 1}.`, alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    footnotes: Object.keys(footnoteMap).length ? footnoteMap : undefined,
    comments: ctx.comments.length ? { children: ctx.comments } : undefined,
    sections: [{ children }],
  });

  return await Packer.toBuffer(doc);
}
