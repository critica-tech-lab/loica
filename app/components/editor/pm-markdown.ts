import { defaultMarkdownSerializer, defaultMarkdownParser, MarkdownSerializer } from "prosemirror-markdown";

// Extends defaultMarkdownSerializer to cover the full loica schema:
// - table/table_row/table_cell/table_header → GFM pipe tables
// - callout → GitHub alert blockquote (`> [!NOTE]`)
// - underline, highlight, tracked_insert → emit text only
// - tracked_delete → emit text only (exported as accepted)
// - strikethrough → ~~text~~
export const loicaMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,

    image(state, node) {
      const { src, alt, title } = node.attrs;
      state.write(
        "![" + state.esc(alt || "") + "](" + src.replace(/[()]/g, "\\$&") +
        (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")"
      );
    },

    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const parts: string[] = [];
          cell.forEach((block) => {
            parts.push(block.textContent.replace(/\|/g, "\\|").replace(/\n/g, " "));
          });
          cells.push(parts.join(" "));
        });
        rows.push(cells);
      });
      if (!rows.length) return;
      const colCount = Math.max(...rows.map((r) => r.length));
      const pad = (s: string) => s || " ";
      state.write("| " + rows[0].map(pad).join(" | ") + " |\n");
      state.write("|" + Array(colCount).fill(" --- ").join("|") + "|\n");
      for (let i = 1; i < rows.length; i++) {
        const row = [...rows[i]];
        while (row.length < colCount) row.push("");
        state.write("| " + row.map(pad).join(" | ") + " |\n");
      }
      state.write("\n");
    },
    // Callout → GitHub alert: a blockquote whose first line is `[!VARIANT]`.
    // Renderers that don't know alerts still show it as a blockquote.
    callout(state: any, node: any) {
      state.wrapBlock("> ", null, node, () => {
        state.write(`[!${String(node.attrs.variant || "note").toUpperCase()}]`);
        state.ensureNewLine();
        state.renderContent(node);
      });
    },

    // Footnote: emit a numbered reference `[^N]`. The numbering comes from the
    // order footnotes are encountered (= document order). The matching
    // definitions are appended by serializeWithFootnotes below. Without that
    // collector (e.g. a stray direct serialize call), the ref is still valid
    // markdown, it just lacks a definition.
    footnote(state: any, node: any) {
      const fns = state.options?.footnotes;
      if (!fns) return;
      fns.push(node);
      state.write(`[^${fns.length}]`);
    },

    // Handled wholesale by `table` above; these are never invoked by renderContent
    // but must be registered to avoid "token type not supported" errors.
    table_row() {},
    table_cell() {},
    table_header() {},
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: { open: "", close: "", mixable: true },
    highlight: { open: "", close: "", mixable: true },
    tracked_insert: { open: "", close: "", mixable: true },
    tracked_delete: { open: "", close: "", mixable: true },
  }
);

// Inverse of serializeWithFootnotes: parse markdown into a doc of `schema`,
// reconstructing footnote nodes from `[^N]` references + their `[^N]: …`
// definitions. The default markdown parser doesn't know footnotes, so we:
//   1. strip the definition lines and remember each id → body text,
//   2. parse the remaining markdown normally,
//   3. walk the resulting JSON and replace every `[^id]` text occurrence with a
//      footnote node whose inline content is the parsed definition body.
// Work at the JSON level (not PM nodes) so the markdown-schema output converts
// cleanly into the caller's `schema` via nodeFromJSON — the same cross-schema
// bridge the editor's markdown-paste path already uses. Refs without a matching
// definition are left as literal text. Returns null if the body won't parse.
type FnJSONNode = { type: string; text?: string; content?: FnJSONNode[]; marks?: any[]; attrs?: any };

const FN_DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

// GitHub alerts (`> [!NOTE] …`) parse as plain blockquotes, so rebuild them as
// callout nodes. GitHub's five labels collapse onto our four variants.
const ALERT_RE = /^\[!(note|tip|important|warning|caution|danger)\]\s*/i;
const ALERT_VARIANT: Record<string, string> = {
  note: "note", important: "note", tip: "tip",
  warning: "warning", caution: "danger", danger: "danger",
};

function calloutFromBlockquote(node: FnJSONNode): FnJSONNode {
  const [first, ...restBlocks] = node.content ?? [];
  const label = first?.type === "paragraph" ? first.content?.[0] : undefined;
  if (label?.type !== "text" || !label.text) return node;
  const m = ALERT_RE.exec(label.text);
  if (!m) return node;

  // The label sits on its own markdown line, but a soft break renders as a
  // space — so the body usually shares the paragraph. Drop the `[!X]` prefix
  // and keep whatever inline content followed it.
  const tail = label.text.slice(m[0].length);
  const inline = tail
    ? [{ ...label, text: tail }, ...(first!.content ?? []).slice(1)]
    : (first!.content ?? []).slice(1);
  const blocks = inline.length ? [{ ...first!, content: inline }, ...restBlocks] : restBlocks;

  return {
    type: "callout",
    attrs: { variant: ALERT_VARIANT[m[1].toLowerCase()] ?? "note" },
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
}

// `inCallout` guards the schema's no-nesting rule: an alert nested inside
// another alert stays a plain blockquote. Without this, nodeFromJSON (which
// doesn't validate) would hand the editor a doc that fails `check()`.
function convertAlerts(node: FnJSONNode, inCallout = false): FnJSONNode {
  const out = !inCallout && node.type === "blockquote" ? calloutFromBlockquote(node) : node;
  if (!out.content) return out;
  const nested = inCallout || out.type === "callout";
  return { ...out, content: out.content.map((c) => convertAlerts(c, nested)) };
}

export function parseMarkdownWithFootnotes(markdown: string, schema: any): any {
  const defs = new Map<string, string>();
  const bodyLines: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = FN_DEF_RE.exec(line);
    if (m) defs.set(m[1], m[2].trim());
    else bodyLines.push(line);
  }

  const mdDoc = defaultMarkdownParser.parse(bodyLines.join("\n"));
  if (!mdDoc) return null;
  const json: FnJSONNode = convertAlerts(mdDoc.toJSON());
  if (defs.size === 0) return schema.nodeFromJSON(json);

  // Parse each definition's body once into its inline JSON (the first block's
  // content), so a footnote's content carries the def's marks/links.
  const defInline = new Map<string, FnJSONNode[]>();
  for (const [id, text] of defs) {
    let inline: FnJSONNode[] = [];
    try {
      const para = (defaultMarkdownParser.parse(text)?.toJSON() as FnJSONNode | undefined)?.content?.[0];
      if (para?.content) inline = para.content;
    } catch { /* leave empty */ }
    defInline.set(id, inline);
  }

  const REF = /\[\^([^\]\s]+)\]/g;
  const walk = (node: FnJSONNode): FnJSONNode[] => {
    if (node.type === "text" && node.text && node.text.includes("[^")) {
      const text = node.text;
      const out: FnJSONNode[] = [];
      let last = 0;
      let matched = false;
      let m: RegExpExecArray | null;
      REF.lastIndex = 0;
      while ((m = REF.exec(text)) !== null) {
        if (!defs.has(m[1])) continue; // not a real footnote ref — keep as text
        matched = true;
        if (m.index > last) out.push({ ...node, text: text.slice(last, m.index) });
        out.push({ type: "footnote", content: defInline.get(m[1]) ?? [] });
        last = m.index + m[0].length;
      }
      if (!matched) return [node];
      if (last < text.length) out.push({ ...node, text: text.slice(last) });
      return out;
    }
    if (node.content) {
      const content: FnJSONNode[] = [];
      for (const child of node.content) content.push(...walk(child));
      return [{ ...node, content }];
    }
    return [node];
  };

  return schema.nodeFromJSON(walk(json)[0]);
}

// Serialize a doc to markdown with footnote support: `[^N]` references inline
// and `[^N]: …` definitions collected at the end (Pandoc / GFM footnote syntax).
// Use this instead of loicaMarkdownSerializer.serialize when footnotes matter.
export function serializeWithFootnotes(doc: any): string {
  const footnotes: any[] = [];
  let md = loicaMarkdownSerializer.serialize(doc, { footnotes } as any);
  if (footnotes.length) {
    const schema = doc.type.schema;
    md += "\n";
    footnotes.forEach((fn, i) => {
      // Wrap the footnote's inline content in a paragraph so the serializer
      // renders its marks/links properly, then flatten to a single line.
      const wrap = schema.node("doc", null, [schema.node("paragraph", null, fn.content)]);
      const body = loicaMarkdownSerializer.serialize(wrap).trim().replace(/\n+/g, " ");
      md += `\n[^${i + 1}]: ${body}`;
    });
  }
  return md;
}
