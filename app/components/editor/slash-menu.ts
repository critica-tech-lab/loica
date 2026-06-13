import { Plugin, PluginKey } from "prosemirror-state";
import { setBlockType, wrapIn } from "prosemirror-commands";
import type { EditorApi } from "~/lib/DocumentContext";

// Slash command menu. Typing "/" at the start of a paragraph (or after a space)
// opens a block-insert menu, à la Notion. The plugin's only job is to detect the
// trigger and expose { open, from, to, query } so the React layer can render the
// popup; selection/execution live in the editor component, which already owns
// the EditorApi and the view.

export interface SlashState {
  open: boolean;
  from: number; // doc position of the "/"
  to: number;   // doc position of the caret (end of query)
  query: string;
}

const EMPTY: SlashState = { open: false, from: 0, to: 0, query: "" };

export const slashMenuKey = new PluginKey<SlashState>("slashMenu");

// Trigger only when the "/" sits at block start or right after whitespace, and
// the query that follows has no spaces — so URLs, fractions, and dates don't
// pop the menu mid-word.
const TRIGGER = /(?:^|\s)\/([^\s/]*)$/;

export function slashMenuPlugin(schema: any): Plugin<SlashState> {
  return new Plugin<SlashState>({
    key: slashMenuKey,
    state: {
      init: () => EMPTY,
      apply(tr, _prev, _old, newState): SlashState {
        const sel = newState.selection;
        if (!sel.empty) return EMPTY;
        const $from = sel.$from;
        // Only inside plain paragraphs — not headings, code blocks, tables…
        if ($from.parent.type !== schema.nodes.paragraph) return EMPTY;
        const start = $from.start();
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        const m = TRIGGER.exec(textBefore);
        if (!m) return EMPTY;
        const slashOffset = m.index + m[0].indexOf("/");
        return {
          open: true,
          from: start + slashOffset,
          to: $from.pos,
          query: m[1],
        };
      },
    },
  });
}

// ─── Items ────────────────────────────────────────────────

export interface SlashCtx {
  api: EditorApi;
  view: any;
  schema: any;
}

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string[];
  run: (ctx: SlashCtx) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: "Text", hint: "Plain paragraph", keywords: ["paragraph", "text", "body", "p"],
    run: ({ api }) => api.clearFormatting?.() },
  { title: "Heading 1", hint: "Large section heading", keywords: ["h1", "title", "heading"],
    run: ({ api }) => api.setHeading?.(1) },
  { title: "Heading 2", hint: "Medium section heading", keywords: ["h2", "subtitle", "heading"],
    run: ({ api }) => api.setHeading?.(2) },
  { title: "Heading 3", hint: "Small section heading", keywords: ["h3", "heading"],
    run: ({ api }) => api.setHeading?.(3) },
  { title: "Bulleted list", hint: "Unordered list", keywords: ["bullet", "unordered", "list", "ul"],
    run: ({ api }) => api.toggleBulletList?.() },
  { title: "Numbered list", hint: "Ordered list", keywords: ["numbered", "ordered", "list", "ol"],
    run: ({ api }) => api.toggleOrderedList?.() },
  { title: "Quote", hint: "Blockquote", keywords: ["quote", "blockquote", "citation"],
    run: ({ api }) => api.toggleBlockquote?.() },
  { title: "Code block", hint: "Monospace code", keywords: ["code", "pre", "snippet", "monospace"],
    run: ({ view, schema }) => setBlockType(schema.nodes.code_block)(view.state, view.dispatch) },
  { title: "Table", hint: "Insert a table", keywords: ["table", "grid"],
    run: ({ api }) => api.insertTable?.() },
  { title: "Divider", hint: "Horizontal rule", keywords: ["divider", "hr", "rule", "separator", "line"],
    run: ({ api }) => api.insertHr?.() },
  { title: "Footnote", hint: "Insert a footnote", keywords: ["footnote", "reference"],
    run: ({ api }) => api.insertFootnote?.() },
  { title: "Note callout", hint: "Highlighted info block", keywords: ["callout", "note", "info", "admonition"],
    run: ({ view, schema }) => wrapIn(schema.nodes.callout, { type: "note" })(view.state, view.dispatch) },
  { title: "Tip callout", hint: "Highlighted tip block", keywords: ["callout", "tip", "hint", "admonition"],
    run: ({ view, schema }) => wrapIn(schema.nodes.callout, { type: "tip" })(view.state, view.dispatch) },
  { title: "Important callout", hint: "Highlighted important block", keywords: ["callout", "important", "admonition"],
    run: ({ view, schema }) => wrapIn(schema.nodes.callout, { type: "important" })(view.state, view.dispatch) },
  { title: "Warning callout", hint: "Highlighted warning block", keywords: ["callout", "warning", "admonition"],
    run: ({ view, schema }) => wrapIn(schema.nodes.callout, { type: "warning" })(view.state, view.dispatch) },
  { title: "Caution callout", hint: "Highlighted caution block", keywords: ["callout", "caution", "danger", "admonition"],
    run: ({ view, schema }) => wrapIn(schema.nodes.callout, { type: "caution" })(view.state, view.dispatch) },
  { title: "Image", hint: "Upload an image", keywords: ["image", "picture", "photo", "upload"],
    run: ({ api }) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
      input.onchange = () => { const f = input.files?.[0]; if (f) api.uploadImage?.(f); };
      input.click();
    } },
];

// Substring match on title + keywords, preserving the declared order.
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) => it.title.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))
  );
}
