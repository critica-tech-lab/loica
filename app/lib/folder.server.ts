import { nanoid } from "nanoid";
import { db, prep } from "./db.server";

// ─── Types ───────────────────────────────────────────────

export type Folder = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: number;
};

export type FolderSummary = Pick<Folder, "id" | "name" | "parent_id" | "created_at" | "created_by">;

export type BreadcrumbSegment = {
  id: string;
  name: string;
};

// ─── Helpers ────────────────────────────────────────────

export function folderNameExists(
  workspaceId: string,
  parentId: string | null,
  name: string,
  excludeId?: string
): boolean {
  const parentClause = parentId === null
    ? "parent_id IS NULL"
    : "parent_id = @parentId";
  const excludeClause = excludeId ? " AND id != @excludeId" : "";
  const sql = `SELECT COUNT(*) as cnt FROM folders
    WHERE workspace_id = @workspaceId AND ${parentClause} AND name = @name AND deleted_at IS NULL${excludeClause}`;
  const row = prep<{ cnt: number }, Record<string, string | null>>(sql).get({
    workspaceId,
    parentId,
    name,
    excludeId: excludeId ?? null,
  });
  return (row?.cnt ?? 0) > 0;
}

// ─── Create ──────────────────────────────────────────────

export function createFolder(
  workspaceId: string,
  userId: string,
  name: string,
  parentId?: string | null
): Folder | null {
  const parent = parentId ?? null;
  if (folderNameExists(workspaceId, parent, name)) return null;
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO folders (id, workspace_id, created_by, name, parent_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, workspaceId, userId, name, parent);
  return getFolder(id)!;
}

/** Find an existing folder by name under a given parent (or workspace root if parentId is null). */
export function findFolderByName(
  workspaceId: string,
  parentId: string | null,
  name: string
): Folder | null {
  if (parentId === null) {
    return (
      prep<Folder, [string, string]>(
          `SELECT id, workspace_id, parent_id, name, created_by, created_at
           FROM folders WHERE workspace_id = ? AND parent_id IS NULL AND name = ? AND deleted_at IS NULL`
        )
        .get(workspaceId, name) ?? null
    );
  }
  return (
    prep<Folder, [string, string, string]>(
        `SELECT id, workspace_id, parent_id, name, created_by, created_at
         FROM folders WHERE workspace_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL`
      )
      .get(workspaceId, parentId, name) ?? null
  );
}

// ─── Read ────────────────────────────────────────────────

export function getFolder(id: string): Folder | null {
  return (
    prep<Folder, [string]>(
        `SELECT id, workspace_id, parent_id, name, created_by, created_at
         FROM folders WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) ?? null
  );
}

/** Like getFolder but includes trashed items — for restore/purge operations. */
export function getFolderIncludingTrashed(id: string): Folder | null {
  return (
    prep<Folder, [string]>(
        `SELECT id, workspace_id, parent_id, name, created_by, created_at
         FROM folders WHERE id = ?`
      )
      .get(id) ?? null
  );
}

export function getFoldersAtLevel(
  workspaceId: string,
  parentId: string | null
): FolderSummary[] {
  if (parentId === null) {
    return prep<FolderSummary, [string]>(
        `SELECT id, name, parent_id, created_at, created_by FROM folders
         WHERE workspace_id = ? AND parent_id IS NULL AND deleted_at IS NULL
         ORDER BY name ASC`
      )
      .all(workspaceId);
  }
  return prep<FolderSummary, [string, string]>(
      `SELECT id, name, parent_id, created_at, created_by FROM folders
       WHERE workspace_id = ? AND parent_id = ? AND deleted_at IS NULL
       ORDER BY name ASC`
    )
    .all(workspaceId, parentId);
}

export function getFolderPath(folderId: string): BreadcrumbSegment[] {
  return prep<BreadcrumbSegment, [string]>(
      `WITH RECURSIVE ancestors(id, name, parent_id, depth) AS (
         SELECT id, name, parent_id, 0 FROM folders WHERE id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT f.id, f.name, f.parent_id, a.depth + 1
         FROM folders f JOIN ancestors a ON f.id = a.parent_id
         WHERE f.deleted_at IS NULL
       )
       SELECT id, name FROM ancestors ORDER BY depth DESC`
    )
    .all(folderId);
}

export function getAllWorkspaceFolders(workspaceId: string): FolderSummary[] {
  return prep<FolderSummary, [string]>(
      `SELECT id, name, parent_id, created_at, created_by FROM folders
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY name ASC`
    )
    .all(workspaceId);
}

export function getSubtreeFolders(rootFolderId: string): FolderSummary[] {
  return prep<FolderSummary, [string]>(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
         WHERE f.deleted_at IS NULL
       )
       SELECT f.id, f.name, f.parent_id, f.created_at, f.created_by
       FROM folders f
       JOIN subtree s ON f.id = s.id
       WHERE f.deleted_at IS NULL
       ORDER BY f.name ASC`
    )
    .all(rootFolderId);
}

// ─── Update ──────────────────────────────────────────────

export function renameFolder(id: string, name: string): boolean {
  const folder = getFolder(id);
  if (!folder) return false;
  if (folderNameExists(folder.workspace_id, folder.parent_id, name, id)) return false;
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
  return true;
}

export function moveFolder(id: string, newParentId: string | null): void {
  // Prevent moving a folder into itself or its descendants
  if (newParentId !== null) {
    let currentId: string | null = newParentId;
    while (currentId) {
      if (currentId === id) {
        throw new Error("Cannot move a folder into itself or its descendants");
      }
      const parent = prep<{ parent_id: string | null }, [string]>(
          "SELECT parent_id FROM folders WHERE id = ?"
        )
        .get(currentId);
      currentId = parent?.parent_id ?? null;
    }
  }
  // Prevent name conflict in target location
  const folder = getFolder(id);
  if (folder && folderNameExists(folder.workspace_id, newParentId, folder.name, id)) {
    throw new Error("A folder with that name already exists in the target location");
  }
  db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(
    newParentId,
    id
  );
}

export function moveFolderToWorkspace(
  folderId: string,
  targetWorkspaceId: string,
  targetParentId: string | null,
): void {
  // Check name conflict in target workspace
  const folder = getFolder(folderId);
  if (!folder) throw new Error("Folder not found");
  if (folderNameExists(targetWorkspaceId, targetParentId, folder.name, folderId)) {
    throw new Error("A folder with that name already exists in the target location");
  }

  db.transaction(() => {
    // Move the folder itself
    db.prepare(
      "UPDATE folders SET workspace_id = ?, parent_id = ? WHERE id = ?"
    ).run(targetWorkspaceId, targetParentId, folderId);

    // Move all descendant folders
    const updateDescendantFolders = (parentId: string) => {
      const children = prep<{ id: string }, [string]>(
          "SELECT id FROM folders WHERE parent_id = ? AND deleted_at IS NULL"
        )
        .all(parentId);
      for (const child of children) {
        db.prepare("UPDATE folders SET workspace_id = ? WHERE id = ?").run(
          targetWorkspaceId,
          child.id,
        );
        updateDescendantFolders(child.id);
      }
    };
    updateDescendantFolders(folderId);

    // Move all documents in this folder and its descendants
    db.prepare(
      `UPDATE documents SET workspace_id = ? WHERE folder_id IN (
         WITH RECURSIVE tree(id) AS (
           VALUES(?)
           UNION ALL
           SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
         )
         SELECT id FROM tree
       )`
    ).run(targetWorkspaceId, folderId);
  })();
}

// ─── Trash (soft-delete) ─────────────────────────────────

export function trashFolder(id: string, userId: string): void {
  const trashTx = db.transaction(() => {
    // Collect all descendant folder IDs (including self)
    const descendantIds = prep<{ id: string }, [string]>(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         )
         SELECT id FROM descendants`
      )
      .all(id)
      .map((r) => r.id);

    // Soft-delete all folders (batch)
    if (descendantIds.length > 0) {
      const ph = descendantIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE folders SET deleted_at = unixepoch(), deleted_by = ? WHERE id IN (${ph}) AND deleted_at IS NULL`
      ).run(userId, ...descendantIds);
    }

    // Soft-delete all docs in those folders
    if (descendantIds.length > 0) {
      const placeholders = descendantIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE documents SET deleted_at = unixepoch(), deleted_by = ?
         WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`
      ).run(userId, ...descendantIds);
    }
  });
  trashTx();
}

export function restoreFolder(id: string): void {
  const restoreTx = db.transaction(() => {
    // If parent was permanently deleted, move to workspace root
    const folder = prep<{ parent_id: string | null }, [string]>(
      "SELECT parent_id FROM folders WHERE id = ?"
    ).get(id);
    if (folder?.parent_id) {
      const parentExists = prep<{ id: string }, [string]>(
        "SELECT id FROM folders WHERE id = ?"
      ).get(folder.parent_id);
      if (!parentExists) {
        db.prepare("UPDATE folders SET parent_id = NULL WHERE id = ?").run(id);
      }
    }

    // Collect all descendant folder IDs (including self)
    const descendantIds = prep<{ id: string }, [string]>(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         )
         SELECT id FROM descendants`
      )
      .all(id)
      .map((r) => r.id);

    // Restore all folders (batch)
    if (descendantIds.length > 0) {
      const ph = descendantIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE folders SET deleted_at = NULL, deleted_by = NULL WHERE id IN (${ph})`
      ).run(...descendantIds);
    }

    // Restore all docs in those folders
    if (descendantIds.length > 0) {
      const placeholders = descendantIds.map(() => "?").join(",");
      db.prepare(
        `UPDATE documents SET deleted_at = NULL, deleted_by = NULL
         WHERE folder_id IN (${placeholders}) AND deleted_at IS NOT NULL`
      ).run(...descendantIds);
    }
  });
  restoreTx();
}

export function permanentlyDeleteFolder(id: string): void {
  deleteFolder(id);
}

export type TrashedFolder = {
  id: string;
  name: string;
  parent_name: string | null;
  parent_id: string | null;
  deleted_at: number;
  deleted_by: string;
};

export function getTrashedFoldersForWorkspace(userId: string, workspaceId: string): TrashedFolder[] {
  return prep<TrashedFolder, [string, string]>(
      `SELECT f.id, f.name, p.name AS parent_name, f.parent_id, f.deleted_at, f.deleted_by
       FROM folders f
       LEFT JOIN folders p ON p.id = f.parent_id
       WHERE f.deleted_by = ? AND f.deleted_at IS NOT NULL AND f.workspace_id = ?
         AND (f.parent_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM folders pp WHERE pp.id = f.parent_id AND pp.deleted_at IS NOT NULL))
       ORDER BY f.deleted_at DESC`
    )
    .all(userId, workspaceId);
}

export function getTrashedFolders(userId: string): TrashedFolder[] {
  return prep<TrashedFolder, [string]>(
      `SELECT f.id, f.name, p.name AS parent_name, f.parent_id, f.deleted_at, f.deleted_by
       FROM folders f
       LEFT JOIN folders p ON p.id = f.parent_id
       WHERE f.deleted_by = ? AND f.deleted_at IS NOT NULL
         AND (f.parent_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM folders pp WHERE pp.id = f.parent_id AND pp.deleted_at IS NOT NULL))
       ORDER BY f.deleted_at DESC`
    )
    .all(userId);
}

// ─── Delete (permanent) ─────────────────────────────────

export function deleteFolder(id: string): void {
  const deleteTx = db.transaction(() => {
    // Collect all descendant folder IDs (including self) in one query
    const descendantIds = prep<{ id: string }, [string]>(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         )
         SELECT id FROM descendants`
      )
      .all(id)
      .map((r) => r.id);

    // Delete documents in all descendant folders (batch with IN clause)
    if (descendantIds.length > 0) {
      const placeholders = descendantIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM documents WHERE folder_id IN (${placeholders})`
      ).run(...descendantIds);
    }

    // Delete the root folder — CASCADE handles subfolder rows
    db.prepare("DELETE FROM folders WHERE id = ?").run(id);
  });

  deleteTx();
}
