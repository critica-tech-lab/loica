/**
 * Background cleanup tasks: stale documents, orphan uploads, version pruning.
 *
 * Design rule for everything in this file: **an unattended job never destroys
 * user data.** It may only move data somewhere recoverable. Deciding what to
 * destroy from a derived value (`documents.content` is a one-way projection of
 * the Yjs binary — see storage-architecture.md) means every bug upstream of
 * that projection becomes permanent data loss down here. So:
 *
 *   · stale documents  → soft-deleted into the owner's trash, not DELETEd
 *   · orphan uploads   → moved to uploads/.quarantine/, not unlinked
 *
 * Both leave an operator in the loop, and both are reversible by hand.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { readdirSync, renameSync, mkdirSync, appendFileSync, statSync, unlinkSync } from "node:fs";
import { STALE_AGE_SECS, MIN_CONTENT_LEN, RING_BUFFER_SIZE } from "./types.ts";
import { uploadsDir } from "../app/lib/paths.server.ts";

/** Where orphaned uploads go instead of being deleted. Never emptied automatically. */
const QUARANTINE_DIR = ".quarantine";
/** Append-only record of what was quarantined and when, so a restore is possible. */
const QUARANTINE_LOG = "quarantine.log";

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
    // Soft-delete, not DELETE. `deleted_by` is set to the document's own owner
    // so the row lands in *their* trash (getTrashedDocuments filters on it) and
    // they can restore it, rather than vanishing with no trace and no notice.
    trashDoc: db.prepare(
      `UPDATE documents
       SET deleted_at = unixepoch(), deleted_by = created_by
       WHERE id = ? AND deleted_at IS NULL`
    ),
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
 * Move stale documents (< MIN_CONTENT_LEN chars, > 48h old) into their owner's
 * trash. Docs with an active room are skipped — someone is editing.
 *
 * This used to be a hard `DELETE`. It isn't any more: `content` is a derived
 * projection, so "this document looks empty" is a claim about the projection,
 * not about the document. The Yjs binary may hold a perfectly good doc whose
 * markdown projection momentarily failed to regenerate. Trashing keeps the
 * 30-day window (purgeExpiredTrash) and lets the owner restore it.
 *
 * Measured yield in production (Sept 2026): **zero candidates**, out of 910
 * documents. Once pdf_file and deleted_at are excluded there is almost nothing
 * left for it to match. It is kept because it is cheap and harmless, not
 * because it is holding anything back — don't read its caution as evidence
 * that it does important work.
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

  let trashed = 0;
  for (const { id } of stale) {
    // Skip docs with active rooms (someone is editing)
    if (activeRooms.has(id)) continue;
    trashed += stmts.trashDoc.run(id).changes;
  }

  if (trashed > 0) {
    console.log(
      `[ws-server] Moved ${trashed} stale document(s) to trash (< ${MIN_CONTENT_LEN} chars, > 48h old)`
    );
  }
}

// An upload must go unreferenced for this long before it can be deleted. The
// markdown projection in `documents.content` is regenerated asynchronously by
// the ws-server, so a reference can be briefly absent from it while the file is
// very much still in use. Deleting a file is irreversible; waiting is free.
const MIN_ORPHAN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Rows per batch when scanning documents/document_versions for upload
// references. Small enough that one batch's query + regex scan is cheap,
// large enough that a hundred-thousand-row table doesn't need a hundred-
// thousand round trips.
export const CLEANUP_BATCH_SIZE = 200;

/** Yields to the event loop — used between batches so a large scan doesn't
 * block ws message handling for its whole duration. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Add every `/api/uploads/<filename>` reference found in `table`'s `content`
 * column to `referenced`, processing CLEANUP_BATCH_SIZE rows at a time (by
 * rowid, ascending) instead of one `SELECT content FROM <table>` for the
 * whole table — this used to load every document's full markdown into
 * memory at once, hourly, regardless of table size.
 */
export async function collectUploadRefsBatched(
  db: Database.Database,
  table: "documents" | "document_versions",
  referenced: Set<string>,
): Promise<void> {
  let lastRowId = 0;
  for (;;) {
    const rows = db
      .prepare(`SELECT rowid AS rowid, content FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
      .all(lastRowId, CLEANUP_BATCH_SIZE) as { rowid: number; content: string }[];
    if (rows.length === 0) break;

    for (const row of rows) {
      for (const m of row.content.matchAll(/\/api\/uploads\/([^\s)"']+)/g)) referenced.add(m[1]);
    }

    lastRowId = rows[rows.length - 1].rowid;
    if (rows.length < CLEANUP_BATCH_SIZE) break; // last page
    await yieldToEventLoop();
  }
}

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
 * Move upload files that no document references — not from its markdown, its
 * version history, or its Yjs binary — into `uploads/.quarantine/`, and only
 * once they have been unreferenced long enough to be plausibly dead.
 * Also checks workspace icons.
 *
 * Nothing here deletes. Emptying the quarantine is a human decision.
 *
 * Measured yield in production (Sept 2026): **zero orphans**, out of 424 files
 * and 112 MB. Every upload on disk is still referenced. Note also that even a
 * hit reclaims no space — quarantining is a rename within the same volume — so
 * this job's contribution to disk usage is zero by construction.
 *
 * It only ever looks one way: file on disk, is it referenced? The opposite
 * failure — a document referencing a file that is gone, which is what the
 * pre-quarantine version of this code left behind — is invisible here. Use
 * `scripts/audit-uploads.sh` for that direction.
 */
export async function cleanupOrphanUploads(db: Database.Database): Promise<void> {
  const uploadDir = uploadsDir;

  let files: string[];
  try {
    // Files only — skips `.quarantine/` itself, which would otherwise become a
    // candidate and get renamed into itself.
    files = readdirSync(uploadDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return; // uploads/ doesn't exist yet
  }

  if (files.length === 0) return;

  // Collect every filename referenced in any document, and in version
  // history (an image dropped from the live doc must survive so restoring an
  // older version doesn't yield a broken image) — in CLEANUP_BATCH_SIZE-row
  // batches rather than one `SELECT content FROM documents` for the whole
  // table, so this doesn't hold the whole markdown corpus in memory at once
  // or block the ws process's event loop for the scan's full duration.
  const referenced = new Set<string>();
  await collectUploadRefsBatched(db, "documents", referenced);
  await collectUploadRefsBatched(db, "document_versions", referenced);

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

  const quarantineDir = join(uploadDir, QUARANTINE_DIR);
  let moved = 0;
  for (const file of candidates) {
    if (liveInYjs.has(file)) continue;
    try {
      mkdirSync(quarantineDir, { recursive: true });
      renameSync(join(uploadDir, file), join(quarantineDir, file));
      appendFileSync(
        join(quarantineDir, QUARANTINE_LOG),
        `${new Date().toISOString()}\t${file}\tunreferenced\n`,
      );
      moved++;
    } catch (e) {
      console.error("[ws-server] error quarantining orphan upload:", file, e);
    }
  }

  if (moved > 0) {
    console.log(
      `[ws-server] Quarantined ${moved} orphan upload(s) to ${QUARANTINE_DIR}/ — review and delete by hand`
    );
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
 * Delete old client-side error log rows (older than 30 days). Unlike the
 * tables above, client_errors has no restore path and nothing reads a row
 * once it's aged past debugging usefulness, so a hard DELETE is fine here.
 */
export function deleteOldClientErrors(db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const result = db.prepare("DELETE FROM client_errors WHERE created_at < ?").run(cutoff);
  if (result.changes > 0) {
    console.log(`[ws-server] Cleaned up ${result.changes} old client error log(s)`);
  }
}

/**
 * Permanently delete trash older than 30 days — documents and folders.
 *
 * Duplicated from app/lib/document.server.ts's purgeExpiredTrash rather than
 * imported: that module (via templates.ts → ~/extensions) pulls in .tsx
 * files that only Vite/Bun's bundler can load. ws-server.ts runs under
 * plain `node`, which can't resolve the `~/` alias or JSX, so this file's
 * convention (see cleanupStaleDocs/pruneAutoVersions above) is to keep its
 * own copy of the SQL instead. Previously this only ran when a trash page
 * loaded; this gives it a schedule independent of that.
 */
export function purgeExpiredTrash(db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const pdfDocs = db.prepare(
    "SELECT pdf_file FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ? AND pdf_file IS NOT NULL"
  ).all(cutoff) as { pdf_file: string }[];
  for (const doc of pdfDocs) {
    try { unlinkSync(join(uploadsDir, doc.pdf_file)); } catch { /* file may not exist */ }
  }
  db.prepare("DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
  db.prepare("DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(cutoff);
}

/**
 * Prune old auto-versions using a tiered retention strategy:
 * - Ring buffer: always keep the last RING_BUFFER_SIZE auto-versions per doc
 * - Tier 0 (beyond ring, 0–1h old): keep one per 10 minutes per document
 * - Tier 1 (1h–24h old): keep one per hour per document
 * - Tier 2 (7–30 days): keep latest auto-version per (document, day)
 * - Tier 3 (> 30 days): keep latest auto-version per (document, ISO week)
 *
 * **24h–7d is deliberately untouched.** No tier matches that window, so a
 * document's first week keeps every auto-version it made. That is where people
 * actually go looking — "what did I write on Tuesday" — and thinning it is the
 * one saving nobody would thank us for. It is also cheap: 238 versions, 5 MB,
 * measured in production against a 110 MB database.
 *
 * If document_versions ever dominates the database, this window is the first
 * place to add a tier (one per 6h would be the obvious shape). Until then the
 * gap is the feature.
 *
 * Note that none of this reads `documents.content`. Tiers are decided from
 * `created_at` and `auto` alone, which is why this job was safe while the
 * cleanup jobs above were destroying data: it never trusted the derived
 * projection.
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
