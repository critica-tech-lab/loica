import { Schema } from "prosemirror-model";
import OrderedMap from "orderedmap";
import { nodes as basicNodes, marks as basicMarks } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";

// Extend image node to carry width/height for ResizableNodeView
const extendedImage = {
  ...basicNodes.image,
  attrs: {
    src: {},
    alt: { default: null },
    title: { default: null },
    width: { default: null },
    height: { default: null },
  },
  toDOM(node: any) {
    const { src, alt, title, width, height } = node.attrs;
    return ["img", { src, alt, title, width, height }] as const;
  },
};

const withTables = OrderedMap.from({ ...basicNodes, image: extendedImage }).append(tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {},
}));

const allNodes = addListNodes(withTables, "paragraph block*", "block");

export const schema = new Schema({
  nodes: allNodes,
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
      toDOM() {
        return ["ins", { class: "tracked-insert" }, 0] as const;
      },
    },
    tracked_delete: {
      attrs: { dataTracked: { default: null } },
      parseDOM: [{ tag: "del.tracked-delete" }],
      toDOM() {
        return ["del", { class: "tracked-delete" }, 0] as const;
      },
    },
  },
});
