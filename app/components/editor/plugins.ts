import { keymap } from "prosemirror-keymap";
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
import { undo, redo } from "y-prosemirror";
import {
  inputRules,
  InputRule,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis,
} from "prosemirror-inputrules";
import { trailingNode } from "prosemirror-trailing-node";
import type { Schema } from "prosemirror-model";
import type { Plugin, Command } from "prosemirror-state";

// Toggle a heading level: if the cursor is already in a heading of that level,
// revert to a paragraph; otherwise convert to the heading.
function toggleHeading(schema: Schema, level: number): Command {
  return (state, dispatch, view) => {
    const parent = state.selection.$from.parent;
    const isSame = parent.type === schema.nodes.heading && parent.attrs.level === level;
    const target = isSame
      ? setBlockType(schema.nodes.paragraph)
      : setBlockType(schema.nodes.heading, { level });
    return target(state, dispatch, view);
  };
}

function markInputRule(regexp: RegExp, markType: any, guardPrecedingChar?: string) {
  return new InputRule(regexp, (state, match, start, end) => {
    if (guardPrecedingChar && start > 0 && state.doc.textBetween(start - 1, start) === guardPrecedingChar) {
      return null;
    }
    const tr = state.tr;
    const textStart = start + match[0].indexOf(match[1]);
    const textEnd = textStart + match[1].length;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    tr.addMark(start, start + match[1].length, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

function buildInputRules(schema: Schema): Plugin {
  const rules = [
    ...smartQuotes,
    ellipsis,
    emDash,
    // Inline marks — double-delimiter rules must come before single
    markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.strong),
    markInputRule(/\*([^*]+)\*$/, schema.marks.em, "*"),
    markInputRule(/__([^_]+)__$/, schema.marks.underline),
    markInputRule(/_([^_]+)_$/, schema.marks.em, "_"),
    markInputRule(/~~([^~]+)~~$/, schema.marks.strikethrough),
    markInputRule(/`([^`]+)`$/, schema.marks.code),
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
    // --- → horizontal rule (slide break). The `emDash` rule above rewrites the
    // first `--` to an em-dash, so by the third hyphen the block reads `—-`;
    // match both that and a literal `---` (e.g. from paste).
    new InputRule(/^(?:---|—-)$/, (state, _match, start) => {
      const $start = state.doc.resolve(start);
      const nodeStart = $start.before();
      const nodeEnd = $start.after();
      const hr = schema.nodes.horizontal_rule.create({ dataTracked: null });
      return state.tr.replaceWith(nodeStart, nodeEnd, hr);
    }),
  ];
  return inputRules({ rules });
}

export function buildPlugins(schema: Schema, readOnly: boolean): Plugin[] {
  if (readOnly) {
    return [gapCursor()];
  }

  return [
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
      "Mod-Alt-1": toggleHeading(schema, 1),
      "Mod-Alt-2": toggleHeading(schema, 2),
      "Mod-Alt-3": toggleHeading(schema, 3),
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
