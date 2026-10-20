import { test, expect, describe, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { db } from "~/lib/db.server";
import { findOrCreateUserViaExternalAuth, updateProfile } from "~/lib/auth.server";

const PROVIDER = "test-idp";
const userIds: string[] = [];

function profile(sub: string, email: string, name: string) {
  return { provider: PROVIDER, sub, email, emailVerified: true, name };
}

function nameOf(id: string): string {
  return (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string }).name;
}

afterAll(() => {
  if (userIds.length === 0) {
    return;
  }
  const ph = userIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM workspaces WHERE id IN (SELECT workspace_id FROM workspace_members WHERE user_id IN (${ph}))`).run(...userIds);
  db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...userIds);
});

describe("external auth keeps the name a user chose", () => {
  test("takes the provider name on first login", () => {
    const sub = nanoid(10);
    const id = findOrCreateUserViaExternalAuth(profile(sub, `${sub}@test.local`, "Provider Name"));
    userIds.push(id);
    expect(nameOf(id)).toBe("Provider Name");
  });

  test("a rename survives the next login of a linked user", () => {
    const sub = nanoid(10);
    const p = profile(sub, `${sub}@test.local`, "Provider Name");
    const id = findOrCreateUserViaExternalAuth(p);
    userIds.push(id);

    updateProfile(id, { name: "My Chosen Name" });
    findOrCreateUserViaExternalAuth(p);

    expect(nameOf(id)).toBe("My Chosen Name");
  });

  test("a rename survives when an email-matched local user links the provider", () => {
    const sub = nanoid(10);
    const email = `${sub}@test.local`;
    const localId = nanoid(16);
    db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')").run(localId, email, "Local Name");
    userIds.push(localId);

    const id = findOrCreateUserViaExternalAuth(profile(sub, email, "Provider Name"));

    expect(id).toBe(localId);
    expect(nameOf(id)).toBe("Local Name");
  });
});
