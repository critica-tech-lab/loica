import { nanoid } from "nanoid";
import { db, prep } from "./db.server";

// ─── Types ───────────────────────────────────────────────

export type Teamspace = {
  id: string;
  name: string;
  slug: string;
  group_id: string;
  member_count: number;
  icon: string | null;
};

export type TeamspaceMember = {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  joined_at: number;
};

// ─── Slug helpers ───────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function uniqueSlug(base: string): string {
  let slug = base || "teamspace";
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const existing = prep<{ id: string }, [string]>(
        "SELECT id FROM workspaces WHERE slug = ?"
      )
      .get(candidate);
    if (!existing) return candidate;
    attempt++;
  }
}

// ─── Create ─────────────────────────────────────────────

export function createTeamspace(name: string, userId: string): Teamspace {
  const wsId = nanoid(16);
  const groupId = nanoid(12);
  const slug = uniqueSlug(toSlug(name));

  db.transaction(() => {
    // Create team workspace
    db.prepare(
      "INSERT INTO workspaces (id, name, slug, created_by, type) VALUES (?, ?, ?, ?, 'team')"
    ).run(wsId, name, slug, userId);

    // Create linked group
    db.prepare(
      "INSERT INTO groups (id, name, created_by, workspace_id) VALUES (?, ?, ?, ?)"
    ).run(groupId, name, userId, wsId);

    // Add creator as admin in both group and workspace
    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'admin', 'accepted')"
    ).run(groupId, userId);

    db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')"
    ).run(wsId, userId);
  })();

  return { id: wsId, name, slug, group_id: groupId, member_count: 1, icon: null };
}

// ─── Read ───────────────────────────────────────────────

export function getTeamspacesForUser(userId: string): Teamspace[] {
  return prep<Teamspace, [string]>(
      `SELECT w.id, w.name, w.slug, g.id AS group_id,
              (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) AS member_count,
              w.icon
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
       JOIN groups g ON g.workspace_id = w.id
       WHERE w.type = 'team'
       ORDER BY w.name ASC`
    )
    .all(userId);
}

export function getTeamspace(workspaceId: string): Teamspace | null {
  return (
    prep<Teamspace, [string]>(
        `SELECT w.id, w.name, w.slug, g.id AS group_id,
                (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) AS member_count,
                w.icon
         FROM workspaces w
         JOIN groups g ON g.workspace_id = w.id
         WHERE w.id = ? AND w.type = 'team'`
      )
      .get(workspaceId) ?? null
  );
}

// ─── Members ────────────────────────────────────────────

export function getTeamspaceMembers(workspaceId: string): TeamspaceMember[] {
  return prep<TeamspaceMember, [string]>(
      `SELECT wm.user_id, u.name, u.email, wm.role, wm.joined_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?
       ORDER BY wm.role ASC, u.name ASC`
    )
    .all(workspaceId);
}

export function addTeamspaceMember(
  workspaceId: string,
  userId: string,
  role: "admin" | "editor" | "viewer" = "editor"
): void {
  const group = prep<{ id: string }, [string]>(
      "SELECT id FROM groups WHERE workspace_id = ?"
    )
    .get(workspaceId);
  if (!group) return;

  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
    ).run(workspaceId, userId, role);

    const groupRole = role === "admin" ? "admin" : "member";
    db.prepare(
      "INSERT OR IGNORE INTO group_members (group_id, user_id, role, status) VALUES (?, ?, ?, 'accepted')"
    ).run(group.id, userId, groupRole);
  })();
}

export function removeTeamspaceMember(
  workspaceId: string,
  userId: string
): void {
  const group = prep<{ id: string }, [string]>(
      "SELECT id FROM groups WHERE workspace_id = ?"
    )
    .get(workspaceId);
  if (!group) return;

  db.transaction(() => {
    db.prepare(
      "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
    ).run(workspaceId, userId);

    db.prepare(
      "DELETE FROM group_members WHERE group_id = ? AND user_id = ?"
    ).run(group.id, userId);
  })();
}

export function updateTeamspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: "admin" | "editor" | "viewer"
): void {
  const group = prep<{ id: string }, [string]>(
      "SELECT id FROM groups WHERE workspace_id = ?"
    )
    .get(workspaceId);
  if (!group) return;

  db.transaction(() => {
    db.prepare(
      "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?"
    ).run(role, workspaceId, userId);

    const groupRole = role === "admin" ? "admin" : "member";
    db.prepare(
      "UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?"
    ).run(groupRole, group.id, userId);
  })();
}

// ─── Update ─────────────────────────────────────────────

export function renameTeamspace(workspaceId: string, name: string): void {
  const slug = uniqueSlug(toSlug(name));
  db.transaction(() => {
    db.prepare("UPDATE workspaces SET name = ?, slug = ? WHERE id = ?").run(
      name,
      slug,
      workspaceId
    );
    db.prepare(
      "UPDATE groups SET name = ? WHERE workspace_id = ?"
    ).run(name, workspaceId);
  })();
}

// ─── Icon ───────────────────────────────────────────────

export function updateTeamspaceIcon(workspaceId: string, icon: string | null): void {
  db.prepare("UPDATE workspaces SET icon = ? WHERE id = ?").run(icon, workspaceId);
}

// ─── Delete ─────────────────────────────────────────────

export function deleteTeamspace(workspaceId: string): void {
  db.transaction(() => {
    // Delete the linked group first
    db.prepare("DELETE FROM groups WHERE workspace_id = ?").run(workspaceId);
    // Delete workspace (CASCADE handles docs, folders, workspace_members)
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  })();
}
