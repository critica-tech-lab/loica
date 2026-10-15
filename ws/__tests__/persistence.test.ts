import { test, expect, describe, spyOn } from "bun:test";
import { saveIfSafe, type PersistenceStatements } from "../persistence";

// A deleted document (permanentlyDeleteDocument) can still have a live room
// debouncing saves against it — the UPDATE just matches 0 rows and silently
// drops the edit. Stub only what saveIfSafe actually touches (no real DB
// needed) to check it now logs instead of failing silently.
function fakeStmts(changes: number): PersistenceStatements {
  return {
    saveDoc: { run: () => ({ changes, lastInsertRowid: 0 }) },
  } as unknown as PersistenceStatements;
}

describe("saveIfSafe", () => {
  test("warns when the UPDATE matches 0 rows (doc deleted while its room was open)", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ok = saveIfSafe(fakeStmts(0), "doc-1", "content", Buffer.from(""), null);
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
      saveIfSafe(fakeStmts(1), "doc-1", "content", Buffer.from(""), null);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
