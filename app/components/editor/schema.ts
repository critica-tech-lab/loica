import { Schema } from "prosemirror-model";
import OrderedMap from "orderedmap";
import { nodes as basicNodes, marks as basicMarks } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";
import { authorTrackColor } from "./types.ts";

// dataTracked is required on all block nodes by @manuscripts/track-changes-plugin
// when track changes is enabled — it stores pending change metadata.
const DT = { dataTracked: { default: null }, textAlign: { default: null } };

function withDT(spec: any): any {
  const origToDOM = spec.toDOM;
  return {
    ...spec,
    attrs: { ...spec.attrs, ...DT },
    toDOM(node: any) {
      const base: any[] = origToDOM ? origToDOM.call(this, node) : ["div", 0];
      const dt = node.attrs?.dataTracked;
      const ta = node.attrs?.textAlign;
      if (!dt?.id && !ta) return base;
      const [tag, ...rest] = base;
      const hasAttrs = rest.length > 0 && rest[0] !== null && typeof rest[0] === "object" && !Array.isArray(rest[0]);
      const existing = hasAttrs ? rest[0] : {};
      const tail = hasAttrs ? rest.slice(1) : rest;
      const attrs: Record<string, any> = { ...existing };
      if (dt?.id) attrs["data-change-id"] = dt.id;
      if (ta) attrs["style"] = `text-align: ${ta}${existing.style ? "; " + existing.style : ""}`;
      return [tag, attrs, ...tail];
    },
  };
}

// Indent: paragraphs and headings carry an integer indent level rendered as
// left margin. Tab/Shift-Tab step it (see plugins.ts). Default 0 = no indent.
export const INDENT_STEP_EM = 2;
export const MAX_INDENT = 8;
function withIndent(spec: any): any {
  const origToDOM = spec.toDOM;
  return {
    ...spec,
    attrs: { ...spec.attrs, indent: { default: 0 } },
    toDOM(node: any) {
      const base: any[] = origToDOM ? origToDOM.call(this, node) : ["div", 0];
      const indent = node.attrs?.indent || 0;
      if (!indent) return base;
      const [tag, ...rest] = base;
      const hasAttrs = rest.length > 0 && rest[0] !== null && typeof rest[0] === "object" && !Array.isArray(rest[0]);
      const existing = hasAttrs ? rest[0] : {};
      const tail = hasAttrs ? rest.slice(1) : rest;
      const style = `margin-left: ${indent * INDENT_STEP_EM}em${existing.style ? "; " + existing.style : ""}`;
      return [tag, { ...existing, style }, ...tail];
    },
  };
}

// Extend block nodes from prosemirror-schema-basic with dataTracked attr
const extendedBasicNodes = {
  ...basicNodes,
  doc:        withDT(basicNodes.doc),
  paragraph:  withIndent(withDT(basicNodes.paragraph)),
  blockquote: withDT(basicNodes.blockquote),
  horizontal_rule: withDT(basicNodes.horizontal_rule),
  heading:    withIndent(withDT(basicNodes.heading)),
  code_block: withDT(basicNodes.code_block),
  // image extended below for width/height
  hard_break: withDT(basicNodes.hard_break),
  text:       basicNodes.text, // text node has no attrs
};

// Extend image node to carry width/height + dataTracked
const extendedImage = {
  ...extendedBasicNodes.image,
  attrs: {
    src: {},
    alt: { default: null },
    title: { default: null },
    width: { default: null },
    height: { default: null },
    ...DT,
  },
  toDOM(node: any) {
    const { src, alt, title, width, height } = node.attrs;
    return ["img", { src, alt, title, width, height }] as const;
  },
};

// Extend table nodes with dataTracked
const rawTableNodes = tableNodes({ tableGroup: "block", cellContent: "block+", cellAttributes: {} });
const extendedTableNodes: Record<string, any> = {};
for (const [name, spec] of Object.entries(rawTableNodes)) {
  extendedTableNodes[name] = withDT(spec);
}

const withTables = OrderedMap.from({ ...extendedBasicNodes, image: extendedImage }).append(extendedTableNodes);

const allNodes = addListNodes(withTables, "paragraph block*", "block");

// addListNodes adds bullet_list, ordered_list, list_item — extend those too
const allNodesWithDT = allNodes.update("bullet_list",  withDT(allNodes.get("bullet_list")!))
                               .update("ordered_list", withDT(allNodes.get("ordered_list")!))
                               .update("list_item",    withDT(allNodes.get("list_item")!));

// Inline footnote: an atom node carrying its own inline content (the note body).
// Rendered as a superscript counter via CSS + an editing popup (FootnoteView).
// Serialized to markdown as `[^N]` refs with `[^N]: …` definitions at doc end.
const footnoteSpec = {
  group: "inline",
  content: "inline*",
  inline: true,
  atom: true,
  toDOM() { return ["footnote", 0] as const; },
  parseDOM: [{ tag: "footnote" }],
};

const allNodesWithFootnote = allNodesWithDT.addToEnd("footnote", footnoteSpec);

// Callout (admonition): a tinted block that wraps other blocks, e.g. a note or
// a warning. The variant label is rendered by CSS (::before on data-variant),
// so the node carries no extra content of its own.
// Serialized to markdown as a GitHub alert (`> [!NOTE]`).
export const CALLOUT_VARIANTS = ["note", "tip", "warning", "danger"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

function asVariant(v: unknown): CalloutVariant {
  return (CALLOUT_VARIANTS as readonly string[]).includes(v as string)
    ? (v as CalloutVariant)
    : "note";
}

const calloutSpec = {
  group: "block",
  // Every block *except* callout — spelled out rather than `block+` so a
  // callout can't nest inside a callout (paste is the only way to try).
  content: "(paragraph | heading | blockquote | code_block | horizontal_rule | bullet_list | ordered_list | table)+",
  defining: true,
  attrs: { variant: { default: "note" } },
  toDOM(node: any) {
    return ["div", { class: "pm-callout", "data-variant": asVariant(node.attrs.variant) }, 0];
  },
  parseDOM: [
    {
      tag: "div.pm-callout",
      getAttrs(dom: any) {
        return { variant: asVariant(dom.getAttribute("data-variant")) };
      },
    },
  ],
};

const allNodesWithCallout = allNodesWithFootnote.addToEnd("callout", withDT(calloutSpec));

export const schema = new Schema({
  nodes: allNodesWithCallout,
  marks: {
    ...basicMarks,
    underline: {
      parseDOM: [
        { tag: "u" },
        { style: "text-decoration=underline", consuming: false },
      ],
      toDOM() { return ["u", 0] as const; },
    },
    strikethrough: {
      parseDOM: [
        { tag: "s" },
        { tag: "del" },
        { style: "text-decoration=line-through", consuming: false },
      ],
      toDOM() { return ["s", 0] as const; },
    },
    highlight: {
      attrs: { color: { default: "#fef08a" } }, // allow-hex: persisted highlight-mark color
      parseDOM: [
        {
          tag: "mark",
          getAttrs(node) {
            return { color: (node as HTMLElement).style.backgroundColor || "#fef08a" }; // allow-hex: persisted highlight-mark color
          },
        },
      ],
      toDOM(mark) {
        return ["mark", { style: `background-color: ${mark.attrs.color}` }, 0] as const;
      },
    },
    tracked_insert: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: "ins.tracked-insert" }],
      toDOM(mark: any) {
        const dt = mark.attrs.dataTracked;
        const color = authorTrackColor(dt?.authorID ?? "");
        return ["ins", {
          class: "tracked-insert",
          "data-change-id": dt?.id ?? "",
          style: `--track-color:${color}`,
        }, 0] as const;
      },
    },
    tracked_delete: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: "del.tracked-delete" }],
      toDOM(mark: any) {
        const dt = mark.attrs.dataTracked;
        const color = authorTrackColor(dt?.authorID ?? "");
        return ["del", {
          class: "tracked-delete",
          "data-change-id": dt?.id ?? "",
          style: `--track-color:${color}`,
        }, 0] as const;
      },
    },
  },
});
