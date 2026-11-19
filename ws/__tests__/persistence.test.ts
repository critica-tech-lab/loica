import { test, expect, describe, spyOn } from "bun:test";
import * as Y from "yjs";
import { getDocContent, loadDocumentState, saveIfSafe, type PersistenceStatements } from "../persistence";

// A deleted document (permanentlyDeleteDocument) can still have a live room
// debouncing saves against it — the UPDATE just matches 0 rows and silently
// drops the edit. Stub only what saveIfSafe actually touches (no real DB
// needed) to check it now logs instead of failing silently.
function fakeStmts(changes: number, storedContent?: string) {
  const calls = { saveDoc: 0, saveDocStateOnly: 0 };
  const stmts = {
    getStoredContent: { get: () => (storedContent === undefined ? undefined : { content: storedContent }) },
    saveDoc: { run: () => { calls.saveDoc++; return { changes, lastInsertRowid: 0 }; } },
    saveDocStateOnly: { run: () => { calls.saveDocStateOnly++; return { changes, lastInsertRowid: 0 }; } },
  } as unknown as PersistenceStatements;
  return { stmts, calls };
}

describe("saveIfSafe", () => {
  test("warns when the UPDATE matches 0 rows (doc deleted while its room was open)", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ok = saveIfSafe(fakeStmts(0).stmts, "doc-1", "content", Buffer.from(""), null);
      expect(ok).toBe(true); // the save attempt itself still "succeeds" — it's just a no-op
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("doc-1");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("does not warn when the row was updated normally", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      saveIfSafe(fakeStmts(1).stmts, "doc-1", "content", Buffer.from(""), null);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("rewrites content only when it changed (keeps the FTS trigger idle otherwise)", () => {
    const same = fakeStmts(1, "content");
    saveIfSafe(same.stmts, "doc-1", "content", Buffer.from(""), null);
    expect(same.calls).toEqual({ saveDoc: 0, saveDocStateOnly: 1 });

    const changed = fakeStmts(1, "old");
    saveIfSafe(changed.stmts, "doc-1", "new", Buffer.from(""), null);
    expect(changed.calls).toEqual({ saveDoc: 1, saveDocStateOnly: 0 });
  });

  test("warns on a 0-row UPDATE in the state-only path too", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      saveIfSafe(fakeStmts(0, "content").stmts, "doc-1", "content", Buffer.from(""), null);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ProseMirror always shows one (empty) paragraph, but a blank document's
// Yjs fragment starts with none. The first typing then creates the paragraph
// as an undoable edit, and undoing it empties Yjs again; the next transaction
// writes a fresh empty paragraph, which the undo manager counts as a new edit
// and so drops the redo stack. A paragraph that exists from the start is never
// part of an undo step.
describe("loadDocumentState", () => {
  function loadWith(row: { content: string; yjs_state: Buffer | null } | undefined) {
    const stmts = { loadDoc: { get: () => row } } as unknown as PersistenceStatements;
    const db = { prepare: () => ({ all: () => [] }) } as never;
    const doc = new Y.Doc();
    loadDocumentState(db, stmts, doc, "doc-1");
    return doc;
  }

  test("starts a blank document with one empty paragraph", () => {
    const doc = loadWith({ content: "", yjs_state: null });

    const fragment = doc.getXmlFragment("prosemirror");
    expect(fragment.length).toBe(1);
    expect(fragment.toString()).toBe("<paragraph></paragraph>");
  });

  test("leaves a stored document without a fragment alone (older documents keep their Y.Text)", () => {
    const stored = new Y.Doc();
    stored.getText("content").insert(0, "legacy text");
    const state = Buffer.from(Y.encodeStateAsUpdate(stored));

    const doc = loadWith({ content: "legacy text", yjs_state: state });

    expect(doc.getXmlFragment("prosemirror").length).toBe(0);
  });
});

describe("a blank document after loadDocumentState", () => {
  test("still projects to empty markdown, so cleanup and auto-versioning see it as blank", () => {
    const doc = new Y.Doc();
    const stmts = { loadDoc: { get: () => ({ content: "", yjs_state: null }) } } as unknown as PersistenceStatements;
    loadDocumentState({ prepare: () => ({ all: () => [] }) } as never, stmts, doc, "doc-1");

    expect(getDocContent(doc)).toBe("");
  });
});
