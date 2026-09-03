/**
 * Groups — the set of people behind a teamspace.
 *
 * A group is no longer a thing a user creates or edits on its own. Every group
 * is created by `createTeamspace` and its roster is written only by
 * `teamspace.server`, which updates `group_members` and `workspace_members` in
 * one transaction. This module used to carry a second copy of that logic —
 * add, remove, change role, accept an invitation — each syncing the other
 * table on its own terms, which meant four write paths over one piece of state
 * that had to agree forever. They didn't: the group path created pending
 * invitations, the teamspace path added people outright.
 *
 * What's left here is read-only, plus the user search that share dialogs use.
 */

import { prep } from "./db.server";

// ─── Types ───────────────────────────────────────────────

export type Group = {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  workspace_id: string | null;
};

export type GroupWithMeta = Group & {
  role: "admin" | "member";
  member_count: number;
  workspace_id: string | null;
};

// ─── Read ────────────────────────────────────────────────

export function getGroup(id: string): Group | null {
  return (
    prep<Group, [string]>(
        "SELECT id, name, created_by, created_at, workspace_id FROM groups WHERE id = ?"
      )
      .get(id) ?? null
  );
}

/** The groups a user belongs to — the share targets offered by ShareDialog. */
export function getUserGroups(userId: string): GroupWithMeta[] {
  return prep<GroupWithMeta, [string]>(
      `SELECT g.id, g.name, g.created_by, g.created_at, g.workspace_id,
              gm.role,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND status = 'accepted') as member_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       WHERE gm.status = 'accepted'
       ORDER BY g.name ASC`
    )
    .all(userId);
}

// ─── Search ──────────────────────────────────────────────

export function searchUsers(
  query: string,
  excludeGroupId?: string
): Array<{ id: string; name: string; email: string }> {
  const pattern = `%${query}%`;
  if (excludeGroupId) {
    return prep<{ id: string; name: string; email: string }, [string, string, string]>(
        `SELECT id, name, email FROM users
         WHERE (name LIKE ? OR email LIKE ?)
           AND id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
         ORDER BY name ASC LIMIT 10`
      )
      .all(pattern, pattern, excludeGroupId);
  }
  return prep<{ id: string; name: string; email: string }, [string, string]>(
      `SELECT id, name, email FROM users
       WHERE name LIKE ? OR email LIKE ?
       ORDER BY name ASC LIMIT 10`
    )
    .all(pattern, pattern);
}

/** Search users scoped to those who share at least one group with the searcher */
export function searchUsersInMyGroups(
  userId: string,
  query: string,
  excludeGroupId?: string
): Array<{ id: string; name: string; email: string }> {
  const pattern = `%${query}%`;
  if (excludeGroupId) {
    return prep<{ id: string; name: string; email: string }, [string, string, string, string]>(
        `SELECT DISTINCT u.id, u.name, u.email FROM users u
         JOIN group_members gm ON gm.user_id = u.id AND gm.status = 'accepted'
         WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted')
           AND (u.name LIKE ? OR u.email LIKE ?)
           AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
         ORDER BY u.name ASC LIMIT 10`
      )
      .all(userId, pattern, pattern, excludeGroupId);
  }
  return prep<{ id: string; name: string; email: string }, [string, string, string]>(
      `SELECT DISTINCT u.id, u.name, u.email FROM users u
       JOIN group_members gm ON gm.user_id = u.id AND gm.status = 'accepted'
       WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'accepted')
         AND (u.name LIKE ? OR u.email LIKE ?)
       ORDER BY u.name ASC LIMIT 10`
    )
    .all(userId, pattern, pattern);
}
