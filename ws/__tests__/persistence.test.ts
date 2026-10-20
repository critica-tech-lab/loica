import { test, expect, describe, spyOn } from "bun:test";
import { saveIfSafe, type PersistenceStatements } from "../persistence";

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
