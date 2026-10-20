import { test, expect, describe } from "bun:test";
import type Database from "better-sqlite3";
import { collectUploadRefsBatched, CLEANUP_BATCH_SIZE } from "../cleanup.ts";

/**
 * Minimal stand-in for better-sqlite3's Database — just enough of
 * `.prepare(sql).all(afterRowId, limit)` for collectUploadRefsBatched to
 * page through. Lets the batching logic be tested without a real SQLite
 * connection (better-sqlite3 itself crashes `bun test` in this environment —
 * see search-query.server.test.ts's note on the same issue).
 */
function fakeDb(rows: { rowid: number; content: string }[]) {
  let calls = 0;
  const db = {
    prepare: (_sql: string) => ({
      all: (afterRowId: number, limit: number) => {
        calls++;
        return rows.filter((r) => r.rowid > afterRowId).slice(0, limit);
      },
    }),
  } as unknown as Database.Database;
  return { db, callCount: () => calls };
}

describe("collectUploadRefsBatched", () => {
  test("collects references across multiple batches", async () => {
    // One more row than a single batch holds, so this exercises a full
    // batch followed by a partial one.
    const rowCount = CLEANUP_BATCH_SIZE + 5;
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      rowid: i + 1,
      content: `See /api/uploads/file-${i}.png for details.`,
    }));
    const { db, callCount } = fakeDb(rows);

    const referenced = new Set<string>();
    await collectUploadRefsBatched(db, "documents", referenced);

    expect(referenced.size).toBe(rowCount);
    expect(referenced.has("file-0.png")).toBe(true);
    expect(referenced.has(`file-${rowCount - 1}.png`)).toBe(true);
    // Exactly 2 round trips: one full batch, one partial, then it stops —
    // it must not keep polling past the last page.
    expect(callCount()).toBe(2);
  });

  test("stops after a single, partial batch when the table is small", async () => {
    const rows = [
      { rowid: 1, content: "/api/uploads/a.png" },
      { rowid: 2, content: "no reference here" },
    ];
    const { db, callCount } = fakeDb(rows);

    const referenced = new Set<string>();
    await collectUploadRefsBatched(db, "document_versions", referenced);

    expect([...referenced]).toEqual(["a.png"]);
    expect(callCount()).toBe(1);
  });

  test("an empty table makes exactly one call and finds nothing", async () => {
    const { db, callCount } = fakeDb([]);

    const referenced = new Set<string>();
    await collectUploadRefsBatched(db, "documents", referenced);

    expect(referenced.size).toBe(0);
    expect(callCount()).toBe(1);
  });

  test("multiple references in one row are all collected", async () => {
    const rows = [
      { rowid: 1, content: "![a](/api/uploads/one.png) and ![b](/api/uploads/two.jpg)" },
    ];
    const { db } = fakeDb(rows);

    const referenced = new Set<string>();
    await collectUploadRefsBatched(db, "documents", referenced);

    expect(referenced).toEqual(new Set(["one.png", "two.jpg"]));
  });
});
