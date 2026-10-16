import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { resolveDocAccess, isShareAccess } from "~/lib/doc-permission.server";

const WORKSPACE = "ws1";
const OTHER_WORKSPACE = "ws2";
const USER = "u1";
const STRANGER = "u2";

// Minimal slice of the real schema (app/lib/db.server.ts): only the tables and
// columns the access decision reads. bun:sqlite, not better-sqlite3: Bun
// crashes loading better-sqlite3's native addon.
function createDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workspace_members (workspace_id TEXT, user_id TEXT, role TEXT);
    CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE group_members (group_id TEXT, user_id TEXT, status TEXT DEFAULT 'accepted');
    CREATE TABLE folder_shares (folder_id TEXT, user_id TEXT, group_id TEXT, permission TEXT DEFAULT 'editor', status TEXT DEFAULT 'accepted');
    CREATE TABLE document_shares (document_id TEXT, user_id TEXT, group_id TEXT, permission TEXT DEFAULT 'editor', status TEXT DEFAULT 'accepted');
  `);
  return db;
}

const doc = (folderId: string | null = null) => ({
  id: "d1",
  workspace_id: WORKSPACE,
  folder_id: folderId,
});

const user = (id = USER, isAdmin = false) => ({ id, is_admin: isAdmin });

let db: Database;

beforeEach(() => {
  db = createDb();
});

function member(role: string, userId = USER, workspaceId = WORKSPACE) {
  db.prepare("INSERT INTO workspace_members VALUES (?, ?, ?)").run(workspaceId, userId, role);
}

function folder(id: string, parentId: string | null = null) {
  db.prepare("INSERT INTO folders VALUES (?, ?)").run(id, parentId);
}

function folderShare(folderId: string, opts: { user?: string; group?: string; permission?: string; status?: string }) {
  db.prepare("INSERT INTO folder_shares VALUES (?, ?, ?, ?, ?)").run(
    folderId,
    opts.user ?? null,
    opts.group ?? null,
    opts.permission ?? "editor",
    opts.status ?? "accepted",
  );
}

function docShare(opts: { user?: string; group?: string; permission?: string; status?: string }) {
  db.prepare("INSERT INTO document_shares VALUES (?, ?, ?, ?, ?)").run(
    "d1",
    opts.user ?? null,
    opts.group ?? null,
    opts.permission ?? "editor",
    opts.status ?? "accepted",
  );
}

function groupMember(groupId: string, userId: string, status = "accepted") {
  db.prepare("INSERT INTO group_members VALUES (?, ?, ?)").run(groupId, userId, status);
}

describe("workspace access", () => {
  test("admin without membership gets write via admin", () => {
    expect(resolveDocAccess(db, doc(), user(STRANGER, true))).toEqual({
      level: "write",
      via: ["admin"],
    });
  });

  test("owner and editor members get write via member", () => {
    member("owner");
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "write", via: ["member"] });

    db.exec("DELETE FROM workspace_members");
    member("editor");
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "write", via: ["member"] });
  });

  test("viewer member gets read", () => {
    member("viewer");
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "read", via: ["member"] });
  });

  test("membership in a different workspace grants nothing", () => {
    member("owner", USER, OTHER_WORKSPACE);
    expect(resolveDocAccess(db, doc(), user())).toBeNull();
  });

  test("member access is not widened by a share", () => {
    member("viewer");
    docShare({ user: USER, permission: "editor" });
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "read", via: ["member"] });
  });

  test("stranger with no shares gets null", () => {
    member("owner");
    expect(resolveDocAccess(db, doc(), user(STRANGER))).toBeNull();
  });
});

describe("folder shares", () => {
  test("share on the document's own folder", () => {
    folder("f1");
    folderShare("f1", { user: USER, permission: "viewer" });
    expect(resolveDocAccess(db, doc("f1"), user())).toEqual({ level: "read", via: ["folder-share"] });
  });

  test("share inherited from an ancestor folder", () => {
    folder("root");
    folder("mid", "root");
    folder("leaf", "mid");
    folderShare("root", { user: USER, permission: "editor" });
    expect(resolveDocAccess(db, doc("leaf"), user())).toEqual({ level: "write", via: ["folder-share"] });
  });

  test("share on a sibling or child folder does not leak upward", () => {
    folder("root");
    folder("child", "root");
    folderShare("child", { user: USER });
    expect(resolveDocAccess(db, doc("root"), user())).toBeNull();
  });

  test("highest permission across the ancestor chain wins", () => {
    folder("root");
    folder("leaf", "root");
    folderShare("root", { user: USER, permission: "viewer" });
    folderShare("leaf", { user: USER, permission: "editor" });
    expect(resolveDocAccess(db, doc("leaf"), user())).toEqual({ level: "write", via: ["folder-share"] });
  });

  test("pending share grants nothing", () => {
    folder("f1");
    folderShare("f1", { user: USER, status: "pending" });
    expect(resolveDocAccess(db, doc("f1"), user())).toBeNull();
  });

  test("share to a group applies to accepted members only", () => {
    folder("f1");
    folderShare("f1", { group: "g1", permission: "viewer" });
    groupMember("g1", USER);
    groupMember("g1", STRANGER, "pending");
    expect(resolveDocAccess(db, doc("f1"), user())).toEqual({ level: "read", via: ["folder-share"] });
    expect(resolveDocAccess(db, doc("f1"), user(STRANGER))).toBeNull();
  });

  test("document outside any folder ignores folder shares", () => {
    folder("f1");
    folderShare("f1", { user: USER });
    expect(resolveDocAccess(db, doc(null), user())).toBeNull();
  });
});

describe("document shares", () => {
  test("direct share respects permission level", () => {
    docShare({ user: USER, permission: "viewer" });
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "read", via: ["doc-share"] });

    db.exec("DELETE FROM document_shares");
    docShare({ user: USER, permission: "editor" });
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "write", via: ["doc-share"] });
  });

  test("pending share grants nothing", () => {
    docShare({ user: USER, status: "pending" });
    expect(resolveDocAccess(db, doc(), user())).toBeNull();
  });

  test("group share applies to accepted members", () => {
    docShare({ group: "g1" });
    groupMember("g1", USER);
    expect(resolveDocAccess(db, doc(), user())).toEqual({ level: "write", via: ["doc-share"] });
    expect(resolveDocAccess(db, doc(), user(STRANGER))).toBeNull();
  });

  test("isShareAccess separates share recipients from members and admins", () => {
    expect(isShareAccess({ level: "write", via: ["admin"] })).toBe(false);
    expect(isShareAccess({ level: "write", via: ["member"] })).toBe(false);
    expect(isShareAccess({ level: "read", via: ["folder-share"] })).toBe(true);
    expect(isShareAccess({ level: "write", via: ["doc-share"] })).toBe(true);
  });

  test("folder viewer plus document editor resolves to write, naming both sources", () => {
    folder("f1");
    folderShare("f1", { user: USER, permission: "viewer" });
    docShare({ user: USER, permission: "editor" });
    expect(resolveDocAccess(db, doc("f1"), user())).toEqual({
      level: "write",
      via: ["folder-share", "doc-share"],
    });
  });
});
