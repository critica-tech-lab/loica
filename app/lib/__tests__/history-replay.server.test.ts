import { test, expect, describe } from "bun:test";
import * as Y from "yjs";
import { buildSessions, type LoggedUpdate } from "~/lib/history-replay.server";

const ALICE = "alice";
const BOB = "bob";
const MINUTE = 60;

// Records every update a doc emits, the way ws-server logs them.
function recorder(doc: Y.Doc): () => Uint8Array {
  let last: Uint8Array = new Uint8Array();
  doc.on("update", (u: Uint8Array) => {
    last = u;
  });
  return () => last;
}

function addParagraph(doc: Y.Doc, text: string) {
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("prosemirror").push([p]);
}

// Appends to the first paragraph, so the update depends on the one that made it.
function extend(doc: Y.Doc, suffix: string) {
  const p = doc.getXmlFragment("prosemirror").get(0) as Y.XmlElement;
  const text = p.get(0) as Y.XmlText;
  text.insert(text.length, suffix);
}

function entry(userId: string, createdAt: number, update: Uint8Array): LoggedUpdate {
  return { userId, userName: userId, createdAt, update };
}

function fullState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

describe("buildSessions", () => {
  test("reconstructs before/after for a complete log", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    const u1 = entry(ALICE, 1000, last());
    addParagraph(doc, "two");
    const u2 = entry(BOB, 1000 + 10 * MINUTE, last());

    const [s1, s2] = buildSessions([u1, u2], null);

    expect(s1).toMatchObject({ contentBefore: "", contentAfter: "one", diffAvailable: true });
    expect(s2).toMatchObject({ contentBefore: "one", contentAfter: "one\ntwo", diffAvailable: true });
  });

  test("flags sessions as unavailable when pruned rows left them without a base", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    extend(doc, "!");
    const u2 = entry(BOB, 2000, last()); // the first row was pruned away

    const [s] = buildSessions([u2], null);

    expect(s.diffAvailable).toBe(false);
  });

  test("replays from a snapshot taken before the oldest kept row", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    const base = { createdAt: 1500, state: fullState(doc), replacesHistory: false };
    extend(doc, "!");
    const u2 = entry(BOB, 2000, last());

    const [s] = buildSessions([u2], base);

    expect(s).toMatchObject({ contentBefore: "one", contentAfter: "one!", diffAvailable: true });
  });

  test("a session that cannot be rebuilt makes every later one unavailable", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    extend(doc, "!");
    const broken = entry(ALICE, 2000, last()); // depends on a pruned row
    extend(doc, "?");
    const later = entry(BOB, 2000 + 10 * MINUTE, last());

    const sessions = buildSessions([broken, later], null);

    expect(sessions.map((s) => s.diffAvailable)).toEqual([false, false]);
  });

  test("history replaced by a restore is not mixed into later sessions", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    const u1 = entry(ALICE, 1000, last());
    const restoredState = fullState(doc); // what the restore will bring back
    addParagraph(doc, "two");
    const u2 = entry(ALICE, 2000, last());

    // Restore: the document becomes the old state again, edited from there.
    const after = new Y.Doc();
    Y.applyUpdate(after, restoredState);
    const lastAfter = recorder(after);
    extend(after, "!");
    const u3 = entry(BOB, 4000, lastAfter());
    const restorePoint = { createdAt: 3000, state: restoredState, replacesHistory: true };

    const [s1, s2, s3] = buildSessions([u1, u2, u3], restorePoint);

    expect(s1.diffAvailable).toBe(false);
    expect(s2.diffAvailable).toBe(false);
    expect(s3).toMatchObject({ contentBefore: "one", contentAfter: "one!", diffAvailable: true });
  });

  test("a restore splits a session by the same user into before and after", () => {
    const doc = new Y.Doc();
    const last = recorder(doc);
    addParagraph(doc, "one");
    const restoredState = fullState(doc);
    addParagraph(doc, "two");
    const before = entry(ALICE, 2000, last());

    const after = new Y.Doc();
    Y.applyUpdate(after, restoredState);
    const lastAfter = recorder(after);
    extend(after, "!");
    // Same user, well inside the 5 minute session gap.
    const post = entry(ALICE, 2000 + MINUTE, lastAfter());
    const restorePoint = { createdAt: 2000 + 30, state: restoredState, replacesHistory: true };

    const [s1, s2] = buildSessions([before, post], restorePoint);

    expect(s1.diffAvailable).toBe(false);
    expect(s2).toMatchObject({ contentBefore: "one", contentAfter: "one!", diffAvailable: true });
  });
});
