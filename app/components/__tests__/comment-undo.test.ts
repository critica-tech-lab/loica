import { test, expect, describe } from "bun:test";
import * as Y from "yjs";
import { trackCommentsInUndo } from "~/components/editor/safe-undo";

// Stands in for ySyncPluginKey, the origin y-prosemirror gives editor edits.
const EDITOR_ORIGIN = {};

function setup() {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("prosemirror");
  const comments = ydoc.getMap<{ body: string; resolved: number }>("comments");
  // The same options y-prosemirror builds, with no capture delay so each edit
  // is its own step.
  const undoManager = new Y.UndoManager(fragment, {
    trackedOrigins: new Set([EDITOR_ORIGIN]),
    captureTimeout: 0,
  });
  return { ydoc, fragment, comments, undoManager };
}

describe("trackCommentsInUndo", () => {
  test("without it, adding a comment cannot be undone", () => {
    const { comments, undoManager } = setup();

    comments.set("c1", { body: "hi", resolved: 0 });
    undoManager.undo();

    expect(comments.has("c1")).toBe(true);
  });

  test("undoes and redoes adding a comment", () => {
    const { comments, undoManager } = setup();
    trackCommentsInUndo(undoManager, comments);

    comments.set("c1", { body: "hi", resolved: 0 });
    undoManager.undo();
    expect(comments.has("c1")).toBe(false);

    undoManager.redo();
    expect(comments.get("c1")?.body).toBe("hi");
  });

  test("undoes resolving a thread", () => {
    const { comments, undoManager } = setup();
    comments.set("c1", { body: "hi", resolved: 0 }); // before tracking: not an undo step
    trackCommentsInUndo(undoManager, comments);

    comments.set("c1", { body: "hi", resolved: 1 });
    undoManager.undo();

    expect(comments.get("c1")?.resolved).toBe(0);
  });

  test("undoes deleting a comment", () => {
    const { comments, undoManager } = setup();
    comments.set("c1", { body: "hi", resolved: 0 });
    trackCommentsInUndo(undoManager, comments);

    comments.delete("c1");
    undoManager.undo();

    expect(comments.get("c1")?.body).toBe("hi");
  });

  test("never undoes a comment that came from another user", () => {
    const { ydoc, comments, undoManager } = setup();
    trackCommentsInUndo(undoManager, comments);

    const peer = new Y.Doc();
    peer.getMap("comments").set("theirs", { body: "from peer", resolved: 0 });
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer), "websocket-provider");
    undoManager.undo();

    expect(comments.has("theirs")).toBe(true);
  });

  test("keeps tracking editor edits", () => {
    const { ydoc, fragment, comments, undoManager } = setup();
    trackCommentsInUndo(undoManager, comments);

    ydoc.transact(() => fragment.insert(0, [new Y.XmlElement("paragraph")]), EDITOR_ORIGIN);
    undoManager.undo();

    expect(fragment.length).toBe(0);
  });
});
