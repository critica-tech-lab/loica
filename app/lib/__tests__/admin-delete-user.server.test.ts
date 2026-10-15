import { test, expect, describe, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { db } from "~/lib/db.server";
import { createWorkspace } from "~/lib/workspace.server";
import { createDocument } from "~/lib/document.server";
import { createFolder } from "~/lib/folder.server";
import { getUserDeletionImpact } from "~/lib/admin.server";

const userIds: string[] = [];
const workspaceIds: string[] = [];

function makeUser(name: string): string {
  const id = nanoid(16);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')"
  ).run(id, `${id}@test.local`, name);
  userIds.push(id);
  return id;
}

afterAll(() => {
  if (workspaceIds.length > 0) {
    const ph = workspaceIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM workspaces WHERE id IN (${ph})`).run(...workspaceIds);
  }
  if (userIds.length > 0) {
    const ph = userIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...userIds);
  }
});

describe("getUserDeletionImpact", () => {
  test("counts docs and folders in workspaces the user solely owns", () => {
    const u1 = makeUser("Solo Owner");
    const ws = createWorkspace("Solo WS", u1);
    workspaceIds.push(ws.id);

    createDocument(ws.id, u1, "Doc 1");
    createDocument(ws.id, u1, "Doc 2");
    createFolder(ws.id, u1, "Folder A");

    const impact = getUserDeletionImpact(u1);
    expect(impact.soloWorkspaces.length).toBe(1);
    expect(impact.soloWorkspaces[0].id).toBe(ws.id);
    expect(impact.totalDocs).toBe(2);
    expect(impact.totalFolders).toBe(1);
  });

  test("returns no impact when the user owns nothing solely", () => {
    const u1 = makeUser("No Content");
    const impact = getUserDeletionImpact(u1);
    expect(impact.soloWorkspaces.length).toBe(0);
    expect(impact.totalDocs).toBe(0);
    expect(impact.totalFolders).toBe(0);
  });

  test("excludes workspaces co-owned by another owner", () => {
    const u1 = makeUser("Co Owner 1");
    const u2 = makeUser("Co Owner 2");
    const ws = createWorkspace("Shared WS", u1);
    workspaceIds.push(ws.id);
    db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')"
    ).run(ws.id, u2);
    createDocument(ws.id, u1, "Shared doc");

    const impact = getUserDeletionImpact(u1);
    expect(impact.soloWorkspaces.length).toBe(0);
    expect(impact.totalDocs).toBe(0);
  });
});
