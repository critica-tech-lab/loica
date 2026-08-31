/**
 * Background cleanup tasks: stale documents, orphan uploads, version pruning.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { readdirSync, unlinkSync, statSync } from "node:fs";
import { STALE_AGE_SECS, MIN_CONTENT_LEN, RING_BUFFER_SIZE } from "./types.ts";
import { uploadsDir } from "../app/lib/paths.server.ts";

/**
 * Initialize cleanup statements.
 */
export function initializeCleanupStatements(db: Database.Database) {
  return {
    // Abandoned blank docs only. Two exclusions, both load-bearing:
    //   · pdf_file — an uploaded PDF/docx stores '' as content (createPdfDocument),
    //     so without this every upload becomes a delete target after 48h.
    //   · deleted_at — trashed docs are the trash's business (30-day retention
    //     via purgeExpiredTrash); this hard DELETE would bypass it.
    findStale: db.prepare(
      `SELECT id FROM documents
       WHERE length(content) < @minLen
         AND created_at < (unixepoch() - @ageSecs)
         AND (pdf_file IS NULL OR length(pdf_file) = 0)
         AND deleted_at IS NULL`
    ),
    deleteDoc: db.prepare(`DELETE FROM documents WHERE id = ?`),
    allContent: db.prepare(`SELECT content FROM documents`),
    allVersionContent: db.prepare(`SELECT content FROM document_versions`),
    pruneUpdates: db.prepare(
      `DELETE FROM document_updates
       WHERE document_id = @docId
       AND id NOT IN (
         SELECT id FROM document_updates
         WHERE document_id = @docId
         ORDER BY created_at DESC
         LIMIT 500
       )`
    ),
  };
}

export type CleanupStatements = ReturnType<typeof initializeCleanupStatements>;

/**
 * Delete documents that are stale (< MIN_CONTENT_LEN chars, > 48h old)
 * and not currently in use (in a room).
 * Pass the rooms map to skip docs with active connections.
 */
export function cleanupStaleDocs(
  stmts: CleanupStatements,
  activeRooms: Set<string>
): void {
  const stale = stmts.findStale.all({
    minLen: MIN_CONTENT_LEN,
    ageSecs: STALE_AGE_SECS,
  }) as { id: string }[];

  if (stale.length === 0) return;

  let deleted = 0;
  for (const { id } of stale) {
    // Skip docs with active rooms (someone is editing)
    if (activeRooms.has(id)) continue;
    stmts.deleteDoc.run(id);
    deleted++;
  }

  if (deleted > 0) {
    console.log(
      `[ws-server] Cleaned up ${deleted} stale document(s) (< ${MIN_CONTENT_LEN} chars, > 48h old)`
    );
  }
}

// An upload must go unreferenced for this long before it can be deleted. The
// markdown projection in `documents.content` is regenerated asynchronously by
// the ws-server, so a reference can be briefly absent from it while the file is
// very much still in use. Deleting a file is irreversible; waiting is free.
const MIN_ORPHAN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Names still referenced by a Yjs binary — the actual source of truth for
 * document contents (see storage-architecture.md); `documents.content` is only
 * a one-way projection of it. Image `src` attributes live in the binary as
 * plain UTF-8, so a substring scan is enough and avoids decoding every doc.
 *
 * Only called for names that already look orphaned, so the blob scan is skipped
 * entirely on the common run where nothing is up for deletion.
 */
function referencedInYjsState(db: Database.Database, candidates: Set<string>): Set<string> {
  const found = new Set<string>();
  if (candidates.size === 0) return found;

  const needles = [...candidates].map((name) => ({ name, buf: Buffer.from(name, "utf8") }));

  for (const sql of [
    `SELECT yjs_state AS blob FROM documents WHERE yjs_state IS NOT NULL`,
    `SELECT yjs_state AS blob FROM document_versions WHERE yjs_state IS NOT NULL`,
  ]) {
    for (const row of db.prepare(sql).iterate() as Iterable<{ blob: Buffer }>) {
      for (const { name, buf } of needles) {
        if (!found.has(name) && row.blob.includes(buf)) found.add(name);
      }
      if (found.size === candidates.size) return found;
    }
  }

  return found;
}

/**
 * Delete upload files that no document references — from its markdown, its
 * version history, or its Yjs binary — and that have been unreferenced long
 * enough to be safely considered dead.
 * Also checks workspace icons.
 */
export function cleanupOrphanUploads(db: Database.Database, stmts: CleanupStatements): void {
  const uploadDir = uploadsDir;

  let files: string[];
  try {
    files = readdirSync(uploadDir);
  } catch {
    return; // uploads/ doesn't exist yet
  }

  if (files.length === 0) return;

  // Collect every filename referenced in any document
  const referenced = new Set<string>();
  const rows = stmts.allContent.all() as { content: string }[];

  for (const row of rows) {
    // Match /api/uploads/<filename> references in markdown content
    const matches = row.content.matchAll(/\/api\/uploads\/([^\s)"']+)/g);
    for (const m of matches) referenced.add(m[1]);
  }

  // Version history counts as a reference: an image dropped from the live doc
  // must survive so restoring an older version doesn't yield a broken image.
  for (const row of stmts.allVersionContent.all() as { content: string }[]) {
    for (const m of row.content.matchAll(/\/api\/uploads\/([^\s)"']+)/g)) referenced.add(m[1]);
  }

  // Also check pdf_file column (uploaded PDFs, docx, pages, xlsx, etc.)
  const pdfFileRows = db.prepare(`SELECT pdf_file FROM documents WHERE pdf_file IS NOT NULL AND length(pdf_file) > 0`).all() as { pdf_file: string }[];
  for (const row of pdfFileRows) {
    referenced.add(row.pdf_file);
  }

  // Also check workspace icons
  const iconRows = db.prepare(`SELECT icon FROM workspaces WHERE icon IS NOT NULL`).all() as {
    icon: string;
  }[];

  for (const row of iconRows) {
    const m = row.icon.match(/\/api\/uploads\/([^\s)"']+)/);
    if (m) referenced.add(m[1]);
  }

  // Candidates: unreferenced by any projection AND old enough that a lagging
  // projection can't explain the absence.
  const cutoff = Date.now() - MIN_ORPHAN_AGE_MS;
  const candidates = new Set<string>();
  for (const file of files) {
    if (referenced.has(file)) continue;
    try {
      if (statSync(join(uploadDir, file)).mtimeMs > cutoff) continue;
    } catch {
      continue; // vanished under us — nothing to do
    }
    candidates.add(file);
  }

  // Final gate: the Yjs binary. Anything still reachable there is live.
  const liveInYjs = referencedInYjsState(db, candidates);

  let removed = 0;
  for (const file of candidates) {
    if (liveInYjs.has(file)) continue;
    try {
      unlinkSync(join(uploadDir, file));
      removed++;
    } catch (e) {
      console.error("[ws-server] error deleting orphan upload:", file, e);
    }
  }

  if (removed > 0) {
    console.log(`[ws-server] Cleaned up ${removed} orphan upload(s)`);
  }
}

/**
 * Delete old notifications (older than 90 days).
 */
export function deleteOldNotifications(db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  const result = db.prepare("DELETE FROM notifications WHERE created_at < ?").run(cutoff);
  if (result.changes > 0) {
    console.log(`[ws-server] Cleaned up ${result.changes} old notification(s)`);
  }
}

/**
 * Prune old auto-versions using a tiered retention strategy:
 * - Ring buffer: always keep the last RING_BUFFER_SIZE auto-versions per doc
 * - Tier 0 (beyond ring, 0–1h old): keep one per 10 minutes per document
 * - Tier 1 (1h–24h old): keep one per hour per document
 * - Tier 2 (8–30 days): keep latest auto-version per (document, day)
 * - Tier 3 (> 30 days): keep latest auto-version per (document, ISO week)
 */
export function pruneAutoVersions(db: Database.Database): void {
  // Ring buffer: IDs of the last N auto-versions per document — never prune these
  const ringRows = db.prepare(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY document_id
        ORDER BY created_at DESC
      ) AS rn
      FROM document_versions
      WHERE auto = 1
    ) WHERE rn <= ?
  `).all(RING_BUFFER_SIZE) as { id: string }[];

  // Run a DELETE that skips ring-buffer IDs by inlining them into the SQL.
  // (Done this way because SQLite can't bind an array; nanoid IDs are URL-safe
  // so there's nothing to escape, but we still sanitize just in case.)
  const ringList = ringRows.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(",");
  function runWithRingGuard(sql: string): number {
    const guarded = ringList
      ? sql.replace("/* RING_GUARD */", `AND id NOT IN (${ringList})`)
      : sql.replace("/* RING_GUARD */", "");
    return db.prepare(guarded).run().changes;
  }

  // Tier 0: 0–1h old — keep one per 10 minutes per (document)
  const tier0Changes = runWithRingGuard(`
    DELETE FROM document_versions
    WHERE auto = 1
      /* RING_GUARD */
      AND created_at >= unixepoch() - 3600
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, (created_at / 600)
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at >= unixepoch() - 3600
        ) WHERE rn = 1
      )
  `);

  // Tier 1: 1h–24h old — keep one per hour per (document)
  const tier1Changes = runWithRingGuard(`
    DELETE FROM document_versions
    WHERE auto = 1
      /* RING_GUARD */
      AND created_at < unixepoch() - 3600
      AND created_at >= unixepoch() - 86400
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY document_id, (created_at / 3600)
            ORDER BY created_at DESC
          ) AS rn
          FROM document_versions
          WHERE auto = 1
            AND created_at < unixepoch() - 3600
            AND created_at >= unixepoch() - 86400
        ) WHERE rn = 1
      )
  `);

  // Tier 2: 8–30 days — keep latest auto-version per (document, day)
  const tier2Changes = runWithRingGuard(`
    DELETE FROM document_versions
    WHERE auto = 1
      /* RING_GUARD */
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
  `);

  // Tier 3: older than 30 days — keep latest auto-version per (document, ISO week)
  const tier3Changes = runWithRingGuard(`
    DELETE FROM document_versions
    WHERE auto = 1
      /* RING_GUARD */
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
  `);

  const total = tier0Changes + tier1Changes + tier2Changes + tier3Changes;
  if (total > 0) {
    console.log(
      `[ws-server] Pruned ${total} old auto-version(s) (${tier0Changes} recent-10min, ${tier1Changes} hourly, ${tier2Changes} daily, ${tier3Changes} weekly)`
    );
  }
}
