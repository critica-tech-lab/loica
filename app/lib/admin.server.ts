import { hash } from "@node-rs/argon2";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { db, prep } from "./db.server";
import { invalidateOtherSessions } from "./auth.server";
import { sendWelcomeEmail, sendPasswordChangedNotification } from "./email.server";
import { createWorkspace, getUserWorkspaces } from "./workspace.server";

// ─── Types ────────────────────────────────────────────────

export type CheapStats = {
  documentCount: number;
  memoryBytes: number;
  userCount: number;
  uptimeSeconds: number;
  dbSizeBytes: number;
  walSizeBytes: number;
  expiredSessions: number;
  orphanedDocs: number;
};

export type ExpensiveStats = {
  projectSizeBytes: number;
  codeSizeBytes: number;
  diskUsagePercent: number;
  diskTotalGB: number;
  diskUsedGB: number;
  diskFreeGB: number;
  lastBackup: string | null;
  lastBackupAgeHours: number | null;
  largestDocs: { id: string; title: string; sizeBytes: number }[];
  recentActivity: { type: "login" | "edit" | "folder" | "share-folder" | "share-doc"; userName: string; detail: string; at: string }[];
  prunableVersions: number;
};

// ─── System Stats ─────────────────────────────────────────

function formatLocalTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("sv-SE", {
    timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Instant stats — safe to run on every page load / revalidation */
export function getCheapStats(): CheapStats {
  const dbPath = path.resolve("app.db");

  const documentCount = (prep<{ cnt: number }>("SELECT COUNT(*) as cnt FROM documents").get())!.cnt;
  const userCount = (prep<{ cnt: number }>("SELECT COUNT(*) as cnt FROM users").get())!.cnt;

  const memoryBytes = process.memoryUsage.rss();
  const uptimeSeconds = Math.floor(process.uptime());

  let dbSizeBytes = 0;
  let walSizeBytes = 0;
  try { dbSizeBytes = fs.statSync(dbPath).size; } catch {}
  try { walSizeBytes = fs.statSync(dbPath + "-wal").size; } catch {}

  const now = Math.floor(Date.now() / 1000);
  const expiredSessions = (prep<{ cnt: number }, [number]>(
    "SELECT COUNT(*) as cnt FROM sessions WHERE expires_at <= ?"
  ).get(now))!.cnt;

  const orphanedDocs = (prep<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM documents
     WHERE workspace_id NOT IN (SELECT id FROM workspaces)`
  ).get())!.cnt;

  return { documentCount, memoryBytes, userCount, uptimeSeconds, dbSizeBytes, walSizeBytes, expiredSessions, orphanedDocs };
}

/** Expensive stats — shell commands + heavy queries. Cached in memory. */
let _expensiveCache: ExpensiveStats | null = null;

export function getCachedExpensiveStats(): ExpensiveStats | null {
  return _expensiveCache;
}

export function refreshExpensiveStats(): ExpensiveStats {
  const projectDir = path.resolve(".");

  let projectSizeBytes = 0;
  try {
    const duOutput = execSync("du -sk .", { cwd: projectDir, encoding: "utf-8", timeout: 5000 });
    const kb = parseInt(duOutput.split(/\s/)[0], 10);
    if (!isNaN(kb)) projectSizeBytes = kb * 1024;
  } catch {}

  let codeSizeBytes = 0;
  try {
    const archiveOutput = execSync("git archive HEAD | wc -c", {
      cwd: projectDir, encoding: "utf-8", timeout: 5000, shell: "/bin/bash",
    });
    const bytes = parseInt(archiveOutput.trim(), 10);
    if (!isNaN(bytes)) codeSizeBytes = bytes;
  } catch {}

  // Disk usage
  let diskUsagePercent = 0;
  let diskTotalGB = 0;
  let diskUsedGB = 0;
  let diskFreeGB = 0;
  try {
    const dbPath = path.resolve("app.db");
    const dfOutput = execSync("df -k .", { cwd: path.dirname(dbPath), encoding: "utf-8" });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const usedKB = parseInt(parts[2], 10);
      const availKB = parseInt(parts[3], 10);
      if (!isNaN(usedKB) && !isNaN(availKB)) {
        // On APFS, Total includes snapshots/reserved space that inflates the number.
        // Use used + available as the effective total for consistent display.
        const effectiveTotalKB = usedKB + availKB;
        diskUsedGB = +(usedKB / (1024 * 1024)).toFixed(1);
        diskFreeGB = +(availKB / (1024 * 1024)).toFixed(1);
        diskTotalGB = +(effectiveTotalKB / (1024 * 1024)).toFixed(1);
        diskUsagePercent = effectiveTotalKB > 0 ? Math.round((usedKB / effectiveTotalKB) * 100) : 0;
      }
    }
  } catch {}

  // Last backup + age
  let lastBackup: string | null = null;
  let lastBackupAgeHours: number | null = null;
  try {
    const backupsDir = path.resolve("backups");
    if (fs.existsSync(backupsDir)) {
      const files = fs.readdirSync(backupsDir)
        .filter((f) => f.startsWith("app") && f.endsWith(".db"))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupsDir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      if (files.length > 0) {
        lastBackup = formatLocalTime(Math.floor(files[0].mtime.getTime() / 1000));
        lastBackupAgeHours = Math.round((Date.now() - files[0].mtime.getTime()) / (1000 * 60 * 60));
      }
    }
  } catch {}

  // Top 5 largest documents by content length (no full-content scan)
  const largestDocs = prep<{ id: string; title: string; sizeBytes: number }, []>(
      `SELECT id, title, LENGTH(content) as sizeBytes FROM documents ORDER BY LENGTH(content) DESC LIMIT 5`
    )
    .all()
    .filter((d) => d.sizeBytes > 0);

  // Recent activity
  const recentLogins = prep<{ userName: string; at: number }, []>(
      `SELECT u.name as userName, s.expires_at - 2592000 as at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.expires_at DESC
       LIMIT 5`
    )
    .all()
    .map((r) => ({
      type: "login" as const,
      userName: r.userName,
      detail: "Logged in",
      at: formatLocalTime(r.at),
    }));

  const recentEdits = prep<{ userName: string; title: string; at: number }, []>(
      `SELECT COALESCE(u.name, 'Unknown') as userName, d.title, d.updated_at as at
       FROM documents d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.updated_at IS NOT NULL
       ORDER BY d.updated_at DESC
       LIMIT 5`
    )
    .all()
    .map((r) => ({
      type: "edit" as const,
      userName: r.userName,
      detail: r.title || "Untitled",
      at: formatLocalTime(r.at),
    }));

  const recentFolders = prep<{ userName: string; name: string; at: number }, []>(
      `SELECT u.name as userName, f.name, f.created_at as at
       FROM folders f
       JOIN users u ON u.id = f.created_by
       ORDER BY f.created_at DESC
       LIMIT 5`
    )
    .all()
    .map((r) => ({
      type: "folder" as const,
      userName: r.userName,
      detail: r.name,
      at: formatLocalTime(r.at),
    }));

  const recentFolderShares = prep<{ userName: string; folderName: string; targetUser: string | null; targetGroup: string | null; at: number }, []>(
      `SELECT u.name as userName, f.name as folderName,
              tu.name as targetUser, g.name as targetGroup,
              fs.created_at as at
       FROM folder_shares fs
       JOIN users u ON u.id = fs.created_by
       JOIN folders f ON f.id = fs.folder_id
       LEFT JOIN users tu ON tu.id = fs.user_id
       LEFT JOIN groups g ON g.id = fs.group_id
       ORDER BY fs.created_at DESC
       LIMIT 5`
    )
    .all()
    .map((r) => ({
      type: "share-folder" as const,
      userName: r.userName,
      detail: `${r.folderName} → ${r.targetUser || r.targetGroup || "unknown"}`,
      at: formatLocalTime(r.at),
    }));

  const recentDocShares = prep<{ userName: string; docTitle: string; targetUser: string | null; targetGroup: string | null; at: number }, []>(
      `SELECT u.name as userName, d.title as docTitle,
              tu.name as targetUser, g.name as targetGroup,
              ds.created_at as at
       FROM document_shares ds
       JOIN users u ON u.id = ds.created_by
       JOIN documents d ON d.id = ds.document_id
       LEFT JOIN users tu ON tu.id = ds.user_id
       LEFT JOIN groups g ON g.id = ds.group_id
       ORDER BY ds.created_at DESC
       LIMIT 5`
    )
    .all()
    .map((r) => ({
      type: "share-doc" as const,
      userName: r.userName,
      detail: `${r.docTitle || "Untitled"} → ${r.targetUser || r.targetGroup || "unknown"}`,
      at: formatLocalTime(r.at),
    }));

  const recentActivity = [...recentLogins, ...recentEdits, ...recentFolders, ...recentFolderShares, ...recentDocShares]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 10);

  const prunableVersions = getPrunableVersionCount();

  _expensiveCache = {
    projectSizeBytes, codeSizeBytes, diskUsagePercent, diskTotalGB, diskUsedGB, diskFreeGB,
    lastBackup, lastBackupAgeHours, largestDocs, recentActivity, prunableVersions,
  };
  return _expensiveCache;
}

export function walCheckpoint(): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

export function cleanupExpiredSessions(): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return result.changes;
}

export function getPrunableVersionCount(): number {
  const row = prep<{ cnt: number }>(`
    SELECT COUNT(*) as cnt FROM document_versions
    WHERE auto = 1
      AND created_at < unixepoch() - 7*86400
      AND id NOT IN (
        -- Daily keepers (8-30 days)
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, date(created_at, 'unixepoch')
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at < unixepoch() - 7*86400
            AND created_at >= unixepoch() - 30*86400
        ) WHERE rn = 1
      )
      AND id NOT IN (
        -- Weekly keepers (>30 days)
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, strftime('%Y-%W', created_at, 'unixepoch')
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at < unixepoch() - 30*86400
        ) WHERE rn = 1
      )
  `).get();
  return row?.cnt ?? 0;
}

export function pruneAutoVersions(): number {
  const tier1 = db.prepare(`
    DELETE FROM document_versions
    WHERE auto = 1
      AND created_at < unixepoch() - 7*86400
      AND created_at >= unixepoch() - 30*86400
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, date(created_at, 'unixepoch')
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at < unixepoch() - 7*86400
            AND created_at >= unixepoch() - 30*86400
        ) WHERE rn = 1
      )
  `).run();

  const tier2 = db.prepare(`
    DELETE FROM document_versions
    WHERE auto = 1
      AND created_at < unixepoch() - 30*86400
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, strftime('%Y-%W', created_at, 'unixepoch')
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at < unixepoch() - 30*86400
        ) WHERE rn = 1
      )
  `).run();

  return tier1.changes + tier2.changes;
}

export { formatBytes };

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: number;
  doc_count: number;
  workspace_id: string | null;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  owner_name: string;
};

// ─── Users ────────────────────────────────────────────────

export function listAllUsers(): AdminUser[] {
  const rows = prep<{ id: string; email: string; name: string; is_admin: number; created_at: number; doc_count: number; workspace_id: string | null }, []>(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM documents d JOIN workspaces w ON w.id = d.workspace_id WHERE w.created_by = u.id AND w.type = 'personal' AND d.deleted_at IS NULL) AS doc_count,
              (SELECT w.id FROM workspaces w WHERE w.created_by = u.id AND w.type = 'personal' LIMIT 1) AS workspace_id
       FROM users u
       ORDER BY u.created_at ASC`
    )
    .all();
  return rows.map((r) => ({ ...r, is_admin: !!r.is_admin }));
}

export async function adminCreateUser(
  email: string,
  name: string,
  password: string
): Promise<string> {
  const existing = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
    .get(email);
  if (existing) throw new Error("email_taken");

  const id = nanoid(16);
  const passwordHash = await hash(password);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, 0)"
  ).run(id, email, name, passwordHash);

  // Create personal workspace (mirrors signup flow)
  createWorkspace("My documents", id);

  sendWelcomeEmail(email, name, password);

  return id;
}

export function adminUpdateUser(
  userId: string,
  fields: { name?: string; email?: string }
): void {
  if (fields.email) {
    const existing = prep<{ id: string }, [string, string]>(
        "SELECT id FROM users WHERE email = ? AND id != ?"
      )
      .get(fields.email, userId);
    if (existing) throw new Error("email_taken");
  }

  if (fields.name !== undefined && fields.email !== undefined) {
    db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(
      fields.name,
      fields.email,
      userId
    );
  } else if (fields.name !== undefined) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(fields.name, userId);
  } else if (fields.email !== undefined) {
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(fields.email, userId);
  }
}

export async function adminChangePassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await hash(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  invalidateOtherSessions(userId); // No keepSessionId — force logout from all sessions

  const user = prep<{ email: string; name: string }, [string]>(
      "SELECT email, name FROM users WHERE id = ?"
    )
    .get(userId);
  if (user) {
    sendPasswordChangedNotification(user.email, user.name, newPassword);
  }
}

export function adminDeleteUser(userId: string): void {
  const tx = db.transaction(() => {
    // Delete workspaces where user is the sole owner
    const soloWorkspaces = prep<{ workspace_id: string }, [string]>(
        `SELECT wm.workspace_id FROM workspace_members wm
         WHERE wm.user_id = ? AND wm.role = 'owner'
         AND (SELECT COUNT(*) FROM workspace_members wm2
              WHERE wm2.workspace_id = wm.workspace_id AND wm2.role = 'owner') = 1`
      )
      .all(userId);

    for (const { workspace_id } of soloWorkspaces) {
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspace_id);
    }

    // Delete groups where user is the sole creator (no other members)
    db.prepare(
      `DELETE FROM groups WHERE created_by = ?
       AND id NOT IN (SELECT group_id FROM group_members WHERE user_id != ?)`
    ).run(userId, userId);

    // Reassign created_by references in shared workspaces to another owner
    db.prepare(
      `UPDATE workspaces SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = workspaces.id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(userId, userId);

    // Reassign created_by in folders/documents to another workspace owner
    db.prepare(
      `UPDATE folders SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = folders.workspace_id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(userId, userId);

    db.prepare(
      `UPDATE documents SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = documents.workspace_id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(userId, userId);

    // Reassign created_by in groups to another group member
    db.prepare(
      `UPDATE groups SET created_by = (
         SELECT gm.user_id FROM group_members gm
         WHERE gm.group_id = groups.id AND gm.user_id != ?
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(userId, userId);

    // Delete the user (CASCADE handles sessions, memberships)
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  tx();
}

export function adminToggleAdmin(userId: string): void {
  // Prevent demoting the last admin
  const user = prep<{ is_admin: number }, [string]>("SELECT is_admin FROM users WHERE id = ?")
    .get(userId);
  if (user?.is_admin) {
    const count = prep<{ cnt: number }>("SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1")
      .get();
    if (count && count.cnt <= 1) {
      throw new Error("last_admin");
    }
  }
  db.prepare("UPDATE users SET is_admin = CASE WHEN is_admin = 1 THEN 0 ELSE 1 END WHERE id = ?").run(
    userId
  );
}

// ─── Transfer / Merge ────────────────────────────────────

/**
 * Move all folders and documents from sourceWsId into a sub-folder under
 * parentFolderId in targetWsId. Deletes the source workspace afterwards.
 */
function _transferWorkspaceContent(
  sourceWsId: string,
  targetWsId: string,
  targetUserId: string,
  parentFolderId: string,
  sourceWsName: string
): void {
  // Create a sub-folder named after the source workspace
  const subFolderId = nanoid(12);
  db.prepare(
    "INSERT INTO folders (id, workspace_id, created_by, name, parent_id) VALUES (?, ?, ?, ?, ?)"
  ).run(subFolderId, targetWsId, targetUserId, sourceWsName, parentFolderId);

  // Get root folders (no parent) in source workspace
  const rootFolders = prep<{ id: string }, [string]>(
      "SELECT id FROM folders WHERE workspace_id = ? AND parent_id IS NULL"
    )
    .all(sourceWsId);

  // Get root documents (no folder) in source workspace
  const rootDocs = prep<{ id: string }, [string]>(
      "SELECT id FROM documents WHERE workspace_id = ? AND folder_id IS NULL"
    )
    .all(sourceWsId);

  // Move ALL folders to target workspace
  db.prepare("UPDATE folders SET workspace_id = ? WHERE workspace_id = ?").run(
    targetWsId,
    sourceWsId
  );

  // Reparent root folders under the new sub-folder
  for (const f of rootFolders) {
    db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(subFolderId, f.id);
  }

  // Move ALL documents to target workspace
  db.prepare("UPDATE documents SET workspace_id = ? WHERE workspace_id = ?").run(
    targetWsId,
    sourceWsId
  );

  // Reparent root docs under the new sub-folder
  for (const d of rootDocs) {
    db.prepare("UPDATE documents SET folder_id = ? WHERE id = ?").run(subFolderId, d.id);
  }

  // Delete the now-empty source workspace
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(sourceWsId);
}

/**
 * Find or create an archive folder with a unique name like "[name] archive"
 * in the given workspace. Returns the folder ID.
 */
function _createArchiveFolder(
  workspaceId: string,
  userId: string,
  sourceName: string
): string {
  let archiveName = `${sourceName} archive`;
  let counter = 1;

  // Check for name conflicts at root level
  while (
    prep<{ cnt: number }, [string, string]>(
        "SELECT COUNT(*) as cnt FROM folders WHERE workspace_id = ? AND parent_id IS NULL AND name = ?"
      )
      .get(workspaceId, archiveName)!.cnt > 0
  ) {
    counter++;
    archiveName = `${sourceName} archive (${counter})`;
  }

  const folderId = nanoid(12);
  db.prepare(
    "INSERT INTO folders (id, workspace_id, created_by, name, parent_id) VALUES (?, ?, ?, ?, NULL)"
  ).run(folderId, workspaceId, userId, archiveName);
  return folderId;
}

/**
 * Transfer all sole-owned workspace content from source user to target user,
 * then delete the source user. Co-owned workspaces are left intact (source
 * membership removed by CASCADE on user delete).
 */
export function adminTransferAndDeleteUser(
  sourceUserId: string,
  targetUserId: string
): void {
  const tx = db.transaction(() => {
    // Get source user name
    const sourceUser = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?")
      .get(sourceUserId);
    if (!sourceUser) throw new Error("Source user not found");

    // Get or create target user's workspace
    const targetWorkspaces = getUserWorkspaces(targetUserId);
    let targetWs = targetWorkspaces[0];
    if (!targetWs) {
      const targetUser = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?")
        .get(targetUserId);
      targetWs = { ...createWorkspace("My documents", targetUserId), role: "owner" };
    }

    // Get sole-owned workspaces
    const soloWorkspaces = prep<{ workspace_id: string; name: string }, [string]>(
        `SELECT wm.workspace_id, w.name FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = ? AND wm.role = 'owner'
         AND (SELECT COUNT(*) FROM workspace_members wm2
              WHERE wm2.workspace_id = wm.workspace_id AND wm2.role = 'owner') = 1`
      )
      .all(sourceUserId);

    if (soloWorkspaces.length > 0) {
      // Create archive folder in target workspace
      const archiveFolderId = _createArchiveFolder(
        targetWs.id,
        targetUserId,
        sourceUser.name
      );

      for (const ws of soloWorkspaces) {
        _transferWorkspaceContent(
          ws.workspace_id,
          targetWs.id,
          targetUserId,
          archiveFolderId,
          ws.name
        );
      }
    }

    // Reassign created_by in co-owned workspaces/folders/documents/groups
    db.prepare(
      `UPDATE workspaces SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = workspaces.id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(sourceUserId, sourceUserId);

    db.prepare(
      `UPDATE folders SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = folders.workspace_id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(sourceUserId, sourceUserId);

    db.prepare(
      `UPDATE documents SET created_by = (
         SELECT wm.user_id FROM workspace_members wm
         WHERE wm.workspace_id = documents.workspace_id AND wm.user_id != ? AND wm.role = 'owner'
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(sourceUserId, sourceUserId);

    db.prepare(
      `DELETE FROM groups WHERE created_by = ?
       AND id NOT IN (SELECT group_id FROM group_members WHERE user_id != ?)`
    ).run(sourceUserId, sourceUserId);

    db.prepare(
      `UPDATE groups SET created_by = (
         SELECT gm.user_id FROM group_members gm
         WHERE gm.group_id = groups.id AND gm.user_id != ?
         LIMIT 1
       ) WHERE created_by = ?`
    ).run(sourceUserId, sourceUserId);

    // Delete the source user (CASCADE handles sessions, memberships)
    db.prepare("DELETE FROM users WHERE id = ?").run(sourceUserId);
  });
  tx();
}

/**
 * Merge all sole-owned workspace content from source user to target user.
 * Source user is NOT deleted. If they lose all workspaces, a fresh one is created.
 */
export function adminMergeUserFiles(
  sourceUserId: string,
  targetUserId: string
): void {
  const tx = db.transaction(() => {
    // Get source user name
    const sourceUser = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?")
      .get(sourceUserId);
    if (!sourceUser) throw new Error("Source user not found");

    // Get or create target user's workspace
    const targetWorkspaces = getUserWorkspaces(targetUserId);
    let targetWs = targetWorkspaces[0];
    if (!targetWs) {
      const targetUser = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?")
        .get(targetUserId);
      targetWs = { ...createWorkspace("My documents", targetUserId), role: "owner" };
    }

    // Get sole-owned workspaces
    const soloWorkspaces = prep<{ workspace_id: string; name: string }, [string]>(
        `SELECT wm.workspace_id, w.name FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = ? AND wm.role = 'owner'
         AND (SELECT COUNT(*) FROM workspace_members wm2
              WHERE wm2.workspace_id = wm.workspace_id AND wm2.role = 'owner') = 1`
      )
      .all(sourceUserId);

    if (soloWorkspaces.length > 0) {
      // Create archive folder in target workspace
      const archiveFolderId = _createArchiveFolder(
        targetWs.id,
        targetUserId,
        sourceUser.name
      );

      for (const ws of soloWorkspaces) {
        _transferWorkspaceContent(
          ws.workspace_id,
          targetWs.id,
          targetUserId,
          archiveFolderId,
          ws.name
        );
      }
    }

    // If source user now has no workspaces, create a fresh one
    const remaining = getUserWorkspaces(sourceUserId);
    if (remaining.length === 0) {
      createWorkspace("My documents", sourceUserId);
    }
  });
  tx();
}

// ─── Workspaces ───────────────────────────────────────────

export function listAllWorkspaces(): AdminWorkspace[] {
  return prep<AdminWorkspace, []>(
      `SELECT w.id, w.name, w.slug,
              COALESCE(u.name, 'unknown') as owner_name
       FROM workspaces w
       LEFT JOIN users u ON u.id = w.created_by
       ORDER BY w.created_at ASC`
    )
    .all();
}
