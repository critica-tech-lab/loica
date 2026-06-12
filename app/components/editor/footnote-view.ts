import { EditorView } from "prosemirror-view";
import { EditorState, Selection } from "prosemirror-state";
import { StepMap } from "prosemirror-transform";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { undo, redo } from "y-prosemirror";

// Inline footnote NodeView (adapted from the canonical ProseMirror footnote
// example). The footnote's body lives as inline content inside the atom node,
// so it rides along with the main doc through y-prosemirror / Yjs sync.
//
// The marker (`<footnote>`) shows a CSS counter. Selecting it opens a popup
// hosting a nested EditorView whose doc IS the footnote's content; inner steps
// are remapped by the node's position and dispatched to the outer view, which
// is where Yjs observes them. Remote/outer edits flow back in via update().
export class FootnoteView {
  dom: HTMLElement;
  node: any;
  outerView: any;
  getPos: () => number | undefined;
  innerView: any;

  constructor(node: any, view: any, getPos: () => number | undefined) {
    this.node = node;
    this.outerView = view;
    this.getPos = getPos;
    this.dom = document.createElement("footnote");
    this.innerView = null;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
    if (!this.innerView) this.open();
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
    if (this.innerView) this.close();
  }

  open() {
    const tooltip = this.dom.appendChild(document.createElement("div"));
    tooltip.className = "footnote-tooltip";
    this.innerView = new EditorView(tooltip, {
      state: EditorState.create({
        doc: this.node,
        plugins: [
          keymap({
            // y-prosemirror undo/redo drive the shared yUndoManager via the
            // outer state alone — no dispatch arg.
            "Mod-z": () => undo(this.outerView.state),
            "Mod-y": () => redo(this.outerView.state),
            "Mod-Shift-z": () => redo(this.outerView.state),
            // Enter commits the note and returns to the main editor (instead of
            // inserting a hard break, which inline-only footnote content can't
            // hold anyway). Shift-Enter still does the baseKeymap default.
            "Enter": () => { this.closeToOuter(); return true; },
          }),
          keymap(baseKeymap),
        ],
      }),
      dispatchTransaction: this.dispatchInner.bind(this),
      handleDOMEvents: {
        mousedown: () => {
          // Kludge from the PM example: focus the inner editor when the outer
          // one would otherwise steal it on the same click.
          if (this.outerView.hasFocus()) this.innerView.focus();
          return false;
        },
      },
    });
    this.innerView.focus();
  }

  close() {
    this.innerView.destroy();
    this.innerView = null;
    this.dom.textContent = "";
  }

  // Commit the note: move the outer selection just past the footnote node.
  // That deselects the node, which fires deselectNode() → close(), tearing down
  // the popup; then refocus the main editor so typing continues in the body.
  closeToOuter() {
    const pos = this.getPos();
    const outer = this.outerView;
    if (pos != null) {
      const after = pos + this.node.nodeSize;
      const sel = Selection.near(outer.state.doc.resolve(after));
      outer.dispatch(outer.state.tr.setSelection(sel).scrollIntoView());
    }
    outer.focus();
  }

  dispatchInner(tr: any) {
    const { state, transactions } = this.innerView.state.applyTransaction(tr);
    this.innerView.updateState(state);

    if (!tr.getMeta("fromOutside")) {
      const pos = this.getPos();
      if (pos == null) return;
      const outerTr = this.outerView.state.tr;
      const offsetMap = StepMap.offset(pos + 1);
      for (let i = 0; i < transactions.length; i++) {
        const steps = transactions[i].steps;
        for (let j = 0; j < steps.length; j++) {
          outerTr.step(steps[j].map(offsetMap));
        }
      }
      if (outerTr.docChanged) this.outerView.dispatch(outerTr);
    }
  }

  update(node: any) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    if (this.innerView) {
      const state = this.innerView.state;
      const start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let { a: endA, b: endB } = node.content.findDiffEnd(state.doc.content);
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
          endA += overlap;
          endB += overlap;
        }
        this.innerView.dispatch(
          state.tr
            .replace(start, endB, node.slice(start, endA))
            .setMeta("fromOutside", true)
        );
      }
    }
    return true;
  }

  destroy() {
    if (this.innerView) this.close();
  }

  stopEvent(event: Event) {
    return !!(this.innerView && this.innerView.dom.contains(event.target as Node));
  }

  ignoreMutation() {
    return true;
  }
}

export function makeFootnoteView(node: any, view: any, getPos: () => number | undefined) {
  return new FootnoteView(node, view, getPos);
}
