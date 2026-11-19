import { test, expect, describe } from "bun:test";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { schema } from "~/components/editor/schema";
import { selectionSafeForUndo } from "~/components/editor/safe-undo";

// y-prosemirror remembers the selection before every transaction, undo
// included, and rebuilds it with NodeSelection.create afterwards. When the undo
// deletes the selected node (a footnote that was just inserted) that call
// receives a position with no node and throws, leaving the view out of sync
// with the Yjs document. Undo therefore starts from a selection that cannot
// point at a node.

const FOOTNOTE_OFFSET = 2; // inside the paragraph, after "a"

function stateWithFootnote(): EditorState {
  const note = schema.nodes.footnote.create(null, schema.text("note"));
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [schema.text("a"), note, schema.text("b")]),
  ]);
  return EditorState.create({ doc, schema });
}

describe("selectionSafeForUndo", () => {
  test("replaces a node selection with a text selection next to it", () => {
    const state = stateWithFootnote();
    const node = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, FOOTNOTE_OFFSET)),
    );

    const safe = selectionSafeForUndo(node);

    expect(safe).not.toBeNull();
    expect(safe).not.toBeInstanceOf(NodeSelection);
    expect(safe!.from).toBe(FOOTNOTE_OFFSET);
  });

  test("leaves a text selection alone", () => {
    const state = stateWithFootnote();
    const text = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

    expect(selectionSafeForUndo(text)).toBeNull();
  });
});
