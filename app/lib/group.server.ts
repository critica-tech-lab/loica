import { nanoid } from "nanoid";
import { db, prep } from "./db.server";
import { sendGroupInviteNotification } from "./email.server";

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

export type GroupMember = {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted";
  joined_at: number;
};

export type PendingGroupInvite = {
  group_id: string;
  group_name: string;
  invited_by_name: string;
};

// ─── Create ──────────────────────────────────────────────

export function createGroup(name: string, userId: string): Group {
  const id = nanoid(12);
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?)"
    ).run(id, name, userId);
    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'admin', 'accepted')"
    ).run(id, userId);
  });
  tx();
  return getGroup(id)!;
}

// ─── Read ────────────────────────────────────────────────

export function getGroup(id: string): Group | null {
  return (
    prep<Group, [string]>(
        "SELECT id, name, created_by, created_at, workspace_id FROM groups WHERE id = ?"
      )
      .get(id) ?? null
  );
}

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

export function getGroupMembers(groupId: string): GroupMember[] {
  return prep<GroupMember, [string]>(
      `SELECT gm.user_id, u.name, u.email, gm.role, gm.status, gm.joined_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.status ASC, gm.role ASC, u.name ASC`
    )
    .all(groupId);
}

export function getGroupMembership(
  groupId: string,
  userId: string
): "admin" | "member" | null {
  const row = prep<{ role: "admin" | "member" }, [string, string]>(
      "SELECT role FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .get(groupId, userId);
  return row?.role ?? null;
}

// ─── Update ──────────────────────────────────────────────

export function addGroupMember(
  groupId: string,
  userId: string,
  role: "admin" | "member" = "member",
  invitedBy?: string,
  inviterIsAdmin = false,
  siteUrl?: string
): void {
  const status = inviterIsAdmin ? "accepted" : "pending";

  // Atomic: insert member + sync workspace membership
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO group_members (group_id, user_id, role, status) VALUES (?, ?, ?, ?)"
    ).run(groupId, userId, role, status);

    if (status === "accepted") {
      const group = prep<{ workspace_id: string | null }, [string]>(
          "SELECT workspace_id FROM groups WHERE id = ?"
        )
        .get(groupId);
      if (group?.workspace_id) {
        const wsRole = role === "admin" ? "admin" : "editor";
        db.prepare(
          "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
        ).run(group.workspace_id, userId, wsRole);
      }
    }
  })();

  // Send email notification outside transaction (side effect)
  if (invitedBy && !inviterIsAdmin) {
    const targetUser = prep<{ email: string; name: string }, [string]>(
        "SELECT email, name FROM users WHERE id = ?"
      )
      .get(userId);
    const group = prep<{ name: string }, [string]>(
        "SELECT name FROM groups WHERE id = ?"
      )
      .get(groupId);
    const inviter = prep<{ name: string }, [string]>(
        "SELECT name FROM users WHERE id = ?"
      )
      .get(invitedBy);
    if (targetUser && group && inviter) {
      sendGroupInviteNotification(
        targetUser.email,
        targetUser.name,
        group.name,
        inviter.name,
        siteUrl
      );
    }
  }
}

/** Check if a user has any membership row (pending or accepted) */
export function hasGroupMemberRow(groupId: string, userId: string): boolean {
  const row = prep<{ cnt: number }, [string, string]>(
      "SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, userId);
  return !!row && row.cnt > 0;
}

export function removeGroupMember(groupId: string, userId: string): void {
  db.transaction(() => {
    db.prepare(
      "DELETE FROM group_members WHERE group_id = ? AND user_id = ?"
    ).run(groupId, userId);

    // Sync: if group has a linked teamspace workspace, also remove from workspace_members
    const group = prep<{ workspace_id: string | null }, [string]>(
        "SELECT workspace_id FROM groups WHERE id = ?"
      )
      .get(groupId);
    if (group?.workspace_id) {
      db.prepare(
        "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
      ).run(group.workspace_id, userId);
    }
  })();
}

export function updateGroupMemberRole(
  groupId: string,
  userId: string,
  role: "admin" | "member"
): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?"
    ).run(role, groupId, userId);

    // Sync: if group has a linked teamspace workspace, also update workspace_members role
    const group = prep<{ workspace_id: string | null }, [string]>(
        "SELECT workspace_id FROM groups WHERE id = ?"
      )
      .get(groupId);
    if (group?.workspace_id) {
      const wsRole = role === "admin" ? "admin" : "editor";
      db.prepare(
        "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?"
      ).run(wsRole, group.workspace_id, userId);
    }
  })();
}

export function renameGroup(groupId: string, name: string): void {
  db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, groupId);
}

// ─── Invitations ─────────────────────────────────────────

export function getPendingGroupInviteCount(userId: string): number {
  const row = prep<{ cnt: number }, [string]>(
      `SELECT COUNT(*) as cnt FROM group_members WHERE user_id = ? AND status = 'pending'`
    )
    .get(userId);
  return row?.cnt ?? 0;
}

export function getPendingGroupInvites(userId: string): PendingGroupInvite[] {
  return prep<PendingGroupInvite, [string]>(
      `SELECT g.id as group_id, g.name as group_name,
              creator.name as invited_by_name
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       JOIN users creator ON creator.id = g.created_by
       WHERE gm.user_id = ? AND gm.status = 'pending'
       ORDER BY gm.joined_at DESC`
    )
    .all(userId);
}

export function acceptGroupInvite(groupId: string, userId: string): boolean {
  let accepted = false;
  db.transaction(() => {
    const result = db
      .prepare(
        "UPDATE group_members SET status = 'accepted' WHERE group_id = ? AND user_id = ? AND status = 'pending'"
      )
      .run(groupId, userId);

    accepted = result.changes > 0;
    if (accepted) {
      // Sync: if group has a linked teamspace workspace, also add to workspace_members
      const member = prep<{ role: string }, [string, string]>(
          "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?"
        )
        .get(groupId, userId);
      const group = prep<{ workspace_id: string | null }, [string]>(
          "SELECT workspace_id FROM groups WHERE id = ?"
        )
        .get(groupId);
      if (group?.workspace_id && member) {
        const wsRole = member.role === "admin" ? "admin" : "editor";
        db.prepare(
          "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
        ).run(group.workspace_id, userId, wsRole);
      }
    }
  })();
  return accepted;
}

export function declineGroupInvite(groupId: string, userId: string): boolean {
  const result = db
    .prepare(
      "DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'pending'"
    )
    .run(groupId, userId);
  return result.changes > 0;
}

// ─── Delete ──────────────────────────────────────────────

export function deleteGroup(groupId: string): void {
  db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
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
