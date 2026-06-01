import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
} from "prosemirror-commands";
import {
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { tableEditing, columnResizing, goToNextCell } from "prosemirror-tables";
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis,
} from "prosemirror-inputrules";
import { trailingNode } from "prosemirror-trailing-node";
import type { Schema } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

function buildInputRules(schema: Schema): Plugin {
  const rules = [
    ...smartQuotes,
    ellipsis,
    emDash,
    // ## → heading
    ...[1, 2, 3, 4, 5, 6].map((level) =>
      textblockTypeInputRule(
        new RegExp(`^(#{${level}})\\s$`),
        schema.nodes.heading,
        () => ({ level })
      )
    ),
    // > → blockquote
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    // - / * / + → bullet list
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
    // 1. → ordered list
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) =>
        node.childCount + node.attrs.order === Number(match[1])
    ),
    // ``` → code block
    textblockTypeInputRule(/^```$/, schema.nodes.code_block),
  ];
  return inputRules({ rules });
}

export function buildPlugins(schema: Schema, readOnly: boolean): Plugin[] {
  if (readOnly) {
    return [gapCursor()];
  }

  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
      "Mod-b": toggleMark(schema.marks.strong),
      "Mod-i": toggleMark(schema.marks.em),
      "Mod-u": toggleMark(schema.marks.underline),
      "Mod-`": toggleMark(schema.marks.code),
      "Mod-Shift-x": toggleMark(schema.marks.strikethrough),
      "Tab": goToNextCell(1),
      "Shift-Tab": goToNextCell(-1),
      "Enter": splitListItem(schema.nodes.list_item),
      "Mod-[": liftListItem(schema.nodes.list_item),
      "Mod-]": sinkListItem(schema.nodes.list_item),
      // Heading shortcuts
      "Mod-Alt-1": setBlockType(schema.nodes.heading, { level: 1 }),
      "Mod-Alt-2": setBlockType(schema.nodes.heading, { level: 2 }),
      "Mod-Alt-3": setBlockType(schema.nodes.heading, { level: 3 }),
      "Mod-Alt-0": setBlockType(schema.nodes.paragraph),
      // Blockquote
      "Mod-Shift->": wrapIn(schema.nodes.blockquote),
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    columnResizing(),
    tableEditing(),
    buildInputRules(schema),
    trailingNode({ nodeName: "paragraph", ignoredNodes: ["paragraph"] }),
  ];
}
