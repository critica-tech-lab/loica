/**
 * Undo/redo that survives a selected node and reveals what it changed.
 *
 * y-prosemirror records the selection before each Yjs transaction and rebuilds
 * it afterwards. For a node selection (e.g. a footnote) whose node the undo
 * deletes, that rebuild throws inside the transaction observer and the view
 * stops matching the document. Moving to a text selection first avoids it:
 * the rebuild for text selections skips positions that no longer resolve.
 *
 *   Mod-Z with footnote selected
 *     -> selection becomes a text cursor next to it
 *     -> y-prosemirror undo
 *     -> scroll to the restored selection, so an off-screen change shows
 *
 * Nothing here may dispatch after the undo ran: see revealSelection.
 */

import { NodeSelection, Selection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type * as Y from "yjs";
import { undo, redo, ySyncPluginKey } from "y-prosemirror";

type YStep = (state: EditorState) => boolean;

// The selection is changed only to dodge the rebuild above, so it must not
// become an undo step of its own.
const ADD_TO_HISTORY = "addToHistory";

/** A selection undo can start from, or null when the current one is already safe. */
export function selectionSafeForUndo(state: EditorState): Selection | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) {
    return null;
  }

  return Selection.near(state.doc.resolve(selection.from));
}

function run(view: EditorView, step: YStep): boolean {
  const safe = selectionSafeForUndo(view.state);
  if (safe) {
    view.dispatch(view.state.tr.setSelection(safe).setMeta(ADD_TO_HISTORY, false));
  }

  const changed = step(view.state);
  if (!changed) {
    return false;
  }

  dropStaleSelection(view);
  revealSelection(view);
  return true;
}

/**
 * After an undo, y-prosemirror parks the popped stack item's saved selection in
 * `binding.beforeTransactionSelection`. It belongs to the undo that just ran,
 * but the next Yjs transaction reuses it, and when that one deletes the node the
 * old selection pointed at (a footnote undone twice in a row) the rebuild throws.
 * Clearing it is what the library does itself after every ordinary transaction.
 */
function dropStaleSelection(view: EditorView): void {
  const binding = ySyncPluginKey.getState(view.state)?.binding;
  if (binding) {
    binding.beforeTransactionSelection = null;
  }
}

/**
 * y-prosemirror only scrolls when the cursor was already in view. This scrolls
 * the DOM directly: a dispatch would re-sync through ySyncPlugin inside a
 * tracked Yjs transaction, and the UndoManager would drop the redo stack.
 */
function revealSelection(view: EditorView): void {
  const { node } = view.domAtPos(view.state.selection.head);
  const element = node instanceof Element ? node : node.parentElement;
  element?.scrollIntoView({ block: "nearest" });
}

/**
 * Make comment changes (add, reply, edit, resolve, delete) undoable.
 *
 * y-prosemirror's UndoManager only covers the document fragment and only
 * transactions it originates. Comments live in their own Y.Map and are written
 * with plain `map.set`, which carries no origin, so both must be added. Edits
 * from other users arrive with their own origin and stay out of this user's
 * history.
 */
export function trackCommentsInUndo(undoManager: Y.UndoManager, comments: Y.Map<unknown>): void {
  undoManager.addToScope(comments);
  undoManager.trackedOrigins.add(null);
}

/** Undo against the shared Yjs history of `view`. */
export function undoSafely(view: EditorView): boolean {
  return run(view, undo);
}

/** Redo against the shared Yjs history of `view`. */
export function redoSafely(view: EditorView): boolean {
  return run(view, redo);
}

/** Keymap command: undo needs the view to dispatch, so it falls back without one. */
export const undoCommand: Command = (state, _dispatch, view) =>
  view ? undoSafely(view) : undo(state);

export const redoCommand: Command = (state, _dispatch, view) =>
  view ? redoSafely(view) : redo(state);
