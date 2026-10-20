import { test, expect, describe, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { db, prep } from "~/lib/db.server";
import { createTeamspace, addTeamspaceMember, deleteTeamspace } from "~/lib/teamspace.server";
import {
  createDocument,
  trashDocument,
  getDocumentIncludingTrashed,
  getTrashedDocumentsForWorkspace,
  purgeExpiredTrash,
} from "~/lib/document.server";
import {
  handleRestoreDoc,
  handlePurgeDoc,
  type TrashActor,
} from "~/lib/actions/trash-actions.server";

// Users created directly via SQL (no email/session plumbing needed for a
// domain-level test). Cleaned up in afterAll.
const userIds: string[] = [];
function makeUser(name: string): TrashActor {
  const id = nanoid(16);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')"
  ).run(id, `${id}@test.local`, name);
  userIds.push(id);
  return { id, is_admin: false };
}

const admin = makeUser("Admin A");
const editor = makeUser("Editor B");
const viewer = makeUser("Viewer C");
const otherEditor = makeUser("Editor D");

const ts = createTeamspace(`Trash Test ${nanoid(6)}`, admin.id);
addTeamspaceMember(ts.id, editor.id, "editor");
addTeamspaceMember(ts.id, viewer.id, "viewer");
addTeamspaceMember(ts.id, otherEditor.id, "editor");

afterAll(() => {
  deleteTeamspace(ts.id);
  if (userIds.length > 0) {
    const ph = userIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...userIds);
  }
});

describe("team workspace trash is shared, not per-deleter", () => {
  test("a doc trashed by one member is visible to the whole team", () => {
    const doc = createDocument(ts.id, admin.id, "Shared doc");
    trashDocument(doc.id, editor.id);

    const trashed = getTrashedDocumentsForWorkspace(ts.id);
    expect(trashed.some((d) => d.id === doc.id)).toBe(true);
    expect(trashed.find((d) => d.id === doc.id)?.deleted_by).toBe(editor.id);

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  });

  test("survives the deleter's account being removed — still visible and restorable by an admin", () => {
    // A throwaway member: deleting a shared user (e.g. `editor`) would also drop
    // their membership and break every later test that uses them.
    const departing = makeUser("Departing E");
    addTeamspaceMember(ts.id, departing.id, "editor");
    const doc = createDocument(ts.id, admin.id, "Orphaned trash");
    trashDocument(doc.id, departing.id);

    // Simulate the deleter leaving/being removed. deleted_by has no FK, so
    // this must not cascade-delete the trashed row.
    db.prepare("DELETE FROM users WHERE id = ?").run(departing.id);
    userIds.splice(userIds.indexOf(departing.id), 1);

    const trashed = getTrashedDocumentsForWorkspace(ts.id);
    const row = trashed.find((d) => d.id === doc.id);
    expect(row).toBeDefined();
    expect(row?.deleted_by_name).toBeNull(); // deleter no longer exists

    // An admin can still restore it even though the original deleter is gone.
    const form = new FormData();
    form.set("docId", doc.id);
    const result = handleRestoreDoc(form, admin);
    expect(result.ok).toBe(true);
    expect(getDocumentIncludingTrashed(doc.id)?.deleted_at).toBeNull();

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  });
});

describe("trash permission rules", () => {
  test("viewers cannot restore", () => {
    const doc = createDocument(ts.id, admin.id, "Viewer restore attempt");
    trashDocument(doc.id, admin.id);

    const form = new FormData();
    form.set("docId", doc.id);
    const result = handleRestoreDoc(form, viewer);
    expect(result.ok).toBe(false);
    expect(getDocumentIncludingTrashed(doc.id)?.deleted_at).not.toBeNull();

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  });

  test("a non-admin member cannot permanently delete someone else's trashed item", () => {
    const doc = createDocument(ts.id, admin.id, "Not mine to purge");
    trashDocument(doc.id, otherEditor.id);

    const form = new FormData();
    form.set("docId", doc.id);
    const result = handlePurgeDoc(form, editor); // editor didn't delete this one
    expect(result.ok).toBe(false);
    expect(getDocumentIncludingTrashed(doc.id)).not.toBeNull(); // still there

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  });

  test("a non-admin member CAN permanently delete their own trashed item", () => {
    const doc = createDocument(ts.id, admin.id, "Mine to purge");
    trashDocument(doc.id, editor.id);

    const form = new FormData();
    form.set("docId", doc.id);
    const result = handlePurgeDoc(form, editor);
    expect(result.ok).toBe(true);
    expect(getDocumentIncludingTrashed(doc.id)).toBeNull();
  });

  test("an admin can permanently delete anyone's trashed item", () => {
    const doc = createDocument(ts.id, admin.id, "Admin purges anything");
    trashDocument(doc.id, otherEditor.id);

    const form = new FormData();
    form.set("docId", doc.id);
    const result = handlePurgeDoc(form, admin);
    expect(result.ok).toBe(true);
    expect(getDocumentIncludingTrashed(doc.id)).toBeNull();
  });
});

describe("purgeExpiredTrash", () => {
  test("purges items older than 30 days but keeps recent ones", () => {
    const old = createDocument(ts.id, admin.id, "Ancient trash");
    const recent = createDocument(ts.id, admin.id, "Recent trash");
    trashDocument(old.id, admin.id);
    trashDocument(recent.id, admin.id);

    const cutoff = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    db.prepare("UPDATE documents SET deleted_at = ? WHERE id = ?").run(cutoff, old.id);

    purgeExpiredTrash();

    expect(getDocumentIncludingTrashed(old.id)).toBeNull();
    expect(getDocumentIncludingTrashed(recent.id)).not.toBeNull();

    db.prepare("DELETE FROM documents WHERE id = ?").run(recent.id);
  });
});
