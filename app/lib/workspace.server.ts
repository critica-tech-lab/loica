import { nanoid } from "nanoid";
import { db, prep } from "./db.server";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  type: "personal" | "team";
  icon: string | null;
};

export type WorkspaceMembership = Workspace & { role: WorkspaceRole };

// ─── Slug generation ──────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function uniqueSlug(base: string): string {
  let slug = base || "workspace";
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

// ─── Create workspace ─────────────────────────────────────

export function createWorkspace(
  name: string,
  userId: string
): Workspace {
  const id = nanoid(16);
  const slug = uniqueSlug(toSlug(name));

  db.prepare(
    "INSERT INTO workspaces (id, name, slug, created_by) VALUES (?, ?, ?, ?)"
  ).run(id, name, slug, userId);

  db.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')"
  ).run(id, userId);

  return { id, name, slug, created_by: userId, type: "personal" as const, icon: null };
}

// ─── Queries ──────────────────────────────────────────────

export function getUserWorkspaces(userId: string): WorkspaceMembership[] {
  return prep<WorkspaceMembership, [string]>(
      `SELECT w.id, w.name, w.slug, w.created_by, w.type, w.icon, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.created_at ASC`
    )
    .all(userId);
}

/** Get only personal workspaces for user (excludes team workspaces). */
export function getUserPersonalWorkspaces(userId: string): WorkspaceMembership[] {
  return prep<WorkspaceMembership, [string]>(
      `SELECT w.id, w.name, w.slug, w.created_by, w.type, w.icon, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ? AND w.type = 'personal'
       ORDER BY w.created_at ASC`
    )
    .all(userId);
}

export function getWorkspace(id: string): Workspace | null {
  return (
    prep<Workspace, [string]>(
        "SELECT id, name, slug, created_by, type, icon FROM workspaces WHERE id = ?"
      )
      .get(id) ?? null
  );
}

export function getWorkspaceBySlug(slug: string): Workspace | null {
  return (
    prep<Workspace, [string]>(
        "SELECT id, name, slug, created_by, type, icon FROM workspaces WHERE slug = ?"
      )
      .get(slug) ?? null
  );
}

const stmtGetMembership = prep<{ role: WorkspaceRole }, [string, string]>(
  "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
);

export function getMembership(
  workspaceId: string,
  userId: string,
  isAdmin?: boolean
): WorkspaceRole | null {
  const row = stmtGetMembership.get(workspaceId, userId);
  if (row) return row.role;
  if (isAdmin) return "owner";
  return null;
}

// ─── Permission helper ────────────────────────────────────

export function requireRole(
  workspaceId: string,
  userId: string,
  allowed: WorkspaceRole[]
): WorkspaceRole {
  const role = getMembership(workspaceId, userId);
  if (!role || !allowed.includes(role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return role;
}
