import { Schema } from "prosemirror-model";
import OrderedMap from "orderedmap";
import { nodes as basicNodes, marks as basicMarks } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";
import { authorTrackColor } from "./types";

// dataTracked is required on all block nodes by @manuscripts/track-changes-plugin
// when track changes is enabled — it stores pending change metadata.
const DT = { dataTracked: { default: null } };

function withDT(spec: any): any {
  return { ...spec, attrs: { ...spec.attrs, ...DT } };
}

// Extend block nodes from prosemirror-schema-basic with dataTracked attr
const extendedBasicNodes = {
  ...basicNodes,
  doc:        withDT(basicNodes.doc),
  paragraph:  withDT(basicNodes.paragraph),
  blockquote: withDT(basicNodes.blockquote),
  horizontal_rule: withDT(basicNodes.horizontal_rule),
  heading:    withDT(basicNodes.heading),
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

export const schema = new Schema({
  nodes: allNodesWithDT,
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
      attrs: { color: { default: "#fef08a" } },
      parseDOM: [
        {
          tag: "mark",
          getAttrs(node) {
            return { color: (node as HTMLElement).style.backgroundColor || "#fef08a" };
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
