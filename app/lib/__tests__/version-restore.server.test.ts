import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as Y from "yjs";
import {
  restoreVersion,
  snapshotDocument,
  VersionKind,
  type RoomControl,
} from "~/lib/version-restore.server";

const DOC = "doc1";
const USER = "user1";
const COMMENTS_MAP = "comments";

// Minimal slice of the real schema (app/lib/db.server.ts).
// bun:sqlite, not better-sqlite3: Bun crashes loading its native addon.
function createDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      yjs_state BLOB, updated_at INTEGER
    );
    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, yjs_state BLOB, created_by TEXT,
      auto INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

// A Yjs state holding one paragraph per entry, plus optional comments.
function state(paragraphs: string[], comments: Record<string, unknown> = {}): Buffer {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment("prosemirror");
  for (const text of paragraphs) {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    frag.push([p]);
  }
  const map = ydoc.getMap(COMMENTS_MAP);
  for (const [id, value] of Object.entries(comments)) map.set(id, value);
  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
}

function load(blob: Uint8Array): Y.Doc {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, blob);
  return ydoc;
}

function paragraphsOf(blob: Uint8Array): string[] {
  const frag = load(blob).getXmlFragment("prosemirror");
  return frag.toArray().map((p) => (p as Y.XmlElement).toString().replace(/[<>]/g, ""));
}

function commentIdsOf(blob: Uint8Array): string[] {
  return Array.from(load(blob).getMap(COMMENTS_MAP).keys()).sort();
}

let db: Database;
let calls: string[];

// Records call order; `onFlush` simulates the ws room writing its live edits.
function room(onFlush: () => void = () => {}): RoomControl {
  return {
    async flush() {
      calls.push("flush");
      onFlush();
    },
    async reset() {
      calls.push("reset");
    },
  };
}

function setDoc(title: string, content: string, yjs: Buffer | null) {
  db.prepare(
    "INSERT OR REPLACE INTO documents (id, title, content, yjs_state) VALUES (?, ?, ?, ?)",
  ).run(DOC, title, content, yjs);
}

function addVersion(id: string, content: string, yjs: Buffer | null, auto = 1) {
  db.prepare(
    "INSERT INTO document_versions (id, document_id, title, content, yjs_state, auto) VALUES (?, ?, 'Old title', ?, ?, ?)",
  ).run(id, DOC, content, yjs, auto);
}

function docRow() {
  return db.prepare("SELECT title, content, yjs_state FROM documents WHERE id = ?").get(DOC) as {
    title: string;
    content: string;
    yjs_state: Uint8Array;
  };
}

function versionRow(id: string) {
  return db.prepare("SELECT * FROM document_versions WHERE id = ?").get(id) as
    | { content: string; yjs_state: Uint8Array | null; auto: number }
    | undefined;
}

beforeEach(() => {
  db = createDb();
  calls = [];
});

describe("snapshotDocument", () => {
  test("copies the Yjs state, so a manual version is restorable", () => {
    setDoc("T", "A", state(["A"]));

    const id = snapshotDocument(db, DOC, USER, VersionKind.Manual);

    const row = versionRow(id)!;
    expect(row.yjs_state).not.toBeNull();
    expect(paragraphsOf(row.yjs_state!)).toEqual(["A"]);
    expect(row.auto).toBe(VersionKind.Manual);
  });
});

describe("restoreVersion", () => {
  test("restores the Yjs state of the version", async () => {
    setDoc("Now", "A\n\nB", state(["A", "B"]));
    addVersion("v1", "A", state(["A"]));

    const out = await restoreVersion(db, room(), DOC, "v1", USER);

    expect(out.status).toBe("restored");
    expect(paragraphsOf(docRow().yjs_state)).toEqual(["A"]);
    expect(docRow().title).toBe("Old title");
  });

  test("flushes the live room before snapshotting, then resets it", async () => {
    setDoc("Now", "A", state(["A"]));
    addVersion("v1", "A", state(["A"]));

    await restoreVersion(db, room(), DOC, "v1", USER);

    expect(calls).toEqual(["flush", "reset"]);
  });

  test("backup holds the edits the room flushed, not the stale DB row", async () => {
    setDoc("Now", "A", state(["A"]));
    addVersion("v1", "old", state(["old"]));
    const live = room(() => setDoc("Now", "A\n\nLIVE", state(["A", "LIVE"])));

    const out = await restoreVersion(db, live, DOC, "v1", USER);
    if (out.status !== "restored") throw new Error("expected restored");

    const backup = versionRow(out.backupVersionId)!;
    expect(backup.auto).toBe(1);
    expect(backup.content).toBe("A\n\nLIVE");
    expect(paragraphsOf(backup.yjs_state!)).toEqual(["A", "LIVE"]);
  });

  test("restoring the backup returns the document to its pre-restore state", async () => {
    setDoc("Now", "A\n\nB", state(["A", "B"]));
    addVersion("v1", "A", state(["A"]));

    const first = await restoreVersion(db, room(), DOC, "v1", USER);
    if (first.status !== "restored") throw new Error("expected restored");
    await restoreVersion(db, room(), DOC, first.backupVersionId, USER);

    expect(paragraphsOf(docRow().yjs_state)).toEqual(["A", "B"]);
  });

  test("comments created after the version survive the restore", async () => {
    setDoc("Now", "A", state(["A"], { c1: { body: "late comment" } }));
    addVersion("v1", "A", state(["A"]));

    await restoreVersion(db, room(), DOC, "v1", USER);

    expect(commentIdsOf(docRow().yjs_state)).toEqual(["c1"]);
  });

  test("comments deleted after the version stay deleted", async () => {
    setDoc("Now", "A", state(["A"]));
    addVersion("v1", "A", state(["A"], { gone: { body: "deleted since" } }));

    await restoreVersion(db, room(), DOC, "v1", USER);

    expect(commentIdsOf(docRow().yjs_state)).toEqual([]);
  });

  test("refuses a version without a Yjs snapshot and changes nothing", async () => {
    setDoc("Now", "A\n\nB", state(["A", "B"]));
    addVersion("legacy", "A", null);

    const out = await restoreVersion(db, room(), DOC, "legacy", USER);

    expect(out.status).toBe("no-snapshot");
    expect(paragraphsOf(docRow().yjs_state)).toEqual(["A", "B"]);
    expect(calls).toEqual([]);
    const count = db.prepare("SELECT count(*) AS n FROM document_versions").get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("marks the restore in the history with a restore point of the new state", async () => {
    setDoc("Now", "A\n\nB", state(["A", "B"]));
    addVersion("v1", "A", state(["A"]));

    await restoreVersion(db, room(), DOC, "v1", USER);

    const points = db
      .prepare("SELECT yjs_state FROM document_versions WHERE auto = ?")
      .all(VersionKind.RestorePoint) as { yjs_state: Uint8Array }[];
    expect(points).toHaveLength(1);
    expect(paragraphsOf(points[0].yjs_state)).toEqual(["A"]);
  });

  test("the backup is an ordinary auto version, not a restore point", async () => {
    setDoc("Now", "A", state(["A"]));
    addVersion("v1", "A", state(["A"]));

    const out = await restoreVersion(db, room(), DOC, "v1", USER);
    if (out.status !== "restored") throw new Error("expected restored");

    expect(versionRow(out.backupVersionId)!.auto).toBe(VersionKind.Auto);
  });

  test("reports an unknown version", async () => {
    setDoc("Now", "A", state(["A"]));

    const out = await restoreVersion(db, room(), DOC, "missing", USER);

    expect(out.status).toBe("not-found");
    expect(calls).toEqual([]);
  });
});
