import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { reassignCreatedBy } from "~/lib/workspace-successor.server";

const LEAVING = "leaving";

// Minimal slice of the real schema (app/lib/db.server.ts). created_by is NOT
// NULL there, which is why a missing successor aborts the whole user removal.
// bun:sqlite, not better-sqlite3: Bun crashes loading its native addon.
function createDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, created_by TEXT NOT NULL);
    CREATE TABLE folders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by TEXT NOT NULL);
    CREATE TABLE documents (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by TEXT NOT NULL);
    CREATE TABLE workspace_members (workspace_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER);
  `);
  return db;
}

let db: Database;

beforeEach(() => {
  db = createDb();
});

function workspace(id: string, createdBy = LEAVING) {
  db.prepare("INSERT INTO workspaces VALUES (?, ?)").run(id, createdBy);
}

function member(workspaceId: string, userId: string, role: string, joinedAt = 100) {
  db.prepare("INSERT INTO workspace_members VALUES (?, ?, ?, ?)").run(workspaceId, userId, role, joinedAt);
}

function creatorOf(table: "workspaces" | "folders" | "documents", id: string): string {
  const row = db.prepare(`SELECT created_by FROM ${table} WHERE id = ?`).get(id) as { created_by: string };
  return row.created_by;
}

describe("reassignCreatedBy", () => {
  test("hands a shared workspace to its other owner", () => {
    workspace("w1");
    member("w1", LEAVING, "owner");
    member("w1", "bob", "owner");

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("workspaces", "w1")).toBe("bob");
  });

  test("hands a Teamspace to another Teamspace admin", () => {
    workspace("t1");
    member("t1", LEAVING, "admin", 100);
    member("t1", "dave", "editor", 200);
    member("t1", "erin", "admin", 300);

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("workspaces", "t1")).toBe("erin");
  });

  test("without another admin, hands it to the oldest member", () => {
    workspace("t1");
    member("t1", LEAVING, "admin", 100);
    member("t1", "newer", "editor", 300);
    member("t1", "older", "viewer", 200);

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("workspaces", "t1")).toBe("older");
  });

  test("an owner is preferred over an admin", () => {
    workspace("w1");
    member("w1", LEAVING, "admin", 100);
    member("w1", "adam", "admin", 200);
    member("w1", "olga", "owner", 300);

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("workspaces", "w1")).toBe("olga");
  });

  test("folders and documents follow the same successor", () => {
    workspace("t1");
    member("t1", LEAVING, "admin", 100);
    member("t1", "erin", "admin", 200);
    db.prepare("INSERT INTO folders VALUES ('f1', 't1', ?)").run(LEAVING);
    db.prepare("INSERT INTO documents VALUES ('d1', 't1', ?)").run(LEAVING);

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("folders", "f1")).toBe("erin");
    expect(creatorOf("documents", "d1")).toBe("erin");
  });

  test("leaves rows created by other users alone", () => {
    workspace("t1", "dave");
    member("t1", LEAVING, "admin", 100);
    member("t1", "dave", "admin", 200);
    db.prepare("INSERT INTO documents VALUES ('d1', 't1', 'dave')").run();

    reassignCreatedBy(db, LEAVING);

    expect(creatorOf("workspaces", "t1")).toBe("dave");
    expect(creatorOf("documents", "d1")).toBe("dave");
  });
});
