import { test, expect, describe, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { db } from "~/lib/db.server";
import {
  createTeamspace,
  addTeamspaceMember,
  updateTeamspaceMemberRole,
  removeTeamspaceMember,
  deleteTeamspace,
  getTeamspaceMembers,
  LastAdminError,
} from "~/lib/teamspace.server";

const userIds: string[] = [];
function makeUser(name: string): string {
  const id = nanoid(16);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')"
  ).run(id, `${id}@test.local`, name);
  userIds.push(id);
  return id;
}

describe("last-admin guard", () => {
  const adminA = makeUser("Admin A");
  const memberB = makeUser("Member B");
  const ts = createTeamspace(`Roles Test ${nanoid(6)}`, adminA);
  addTeamspaceMember(ts.id, memberB, "editor");

  afterAll(() => {
    deleteTeamspace(ts.id);
    const ph = userIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...userIds);
  });

  test("cannot demote the sole admin", () => {
    expect(() => updateTeamspaceMemberRole(ts.id, adminA, "editor")).toThrow(LastAdminError);
    expect(getTeamspaceMembers(ts.id).find((m) => m.user_id === adminA)?.role).toBe("admin");
  });

  test("cannot remove the sole admin", () => {
    expect(() => removeTeamspaceMember(ts.id, adminA)).toThrow(LastAdminError);
  });

  test("promoting a second admin allows the first to be demoted", () => {
    updateTeamspaceMemberRole(ts.id, memberB, "admin");
    expect(() => updateTeamspaceMemberRole(ts.id, adminA, "editor")).not.toThrow();
    expect(getTeamspaceMembers(ts.id).find((m) => m.user_id === adminA)?.role).toBe("editor");
  });

  test("with two admins, removing one leaves the teamspace with one admin — allowed", () => {
    // Re-promote A so there are two admins again, then remove B.
    updateTeamspaceMemberRole(ts.id, adminA, "admin");
    expect(() => removeTeamspaceMember(ts.id, memberB)).not.toThrow();
    expect(getTeamspaceMembers(ts.id).some((m) => m.user_id === memberB)).toBe(false);
  });
});
