/**
 * Version snapshots and restore.
 *
 * The Yjs binary is the source of truth for a document (storage-architecture.md);
 * `content` is a derived projection. A version is only restorable if it carries
 * its own `yjs_state`, so every snapshot copies the binary and a version without
 * one is refused instead of half-restored.
 *
 * Restore flow, with the live room involved so no edit is lost:
 *
 *   flush room -> snapshot current (backup) -> write version state -> reset room
 *
 * Comments are not part of a version: the restored state keeps the comments the
 * document has now, so a restore never deletes them.
 *
 * Takes the database and the room control as parameters so tests can use an
 * in-memory database and no ws-server.
 */

import * as Y from "yjs";
import { nanoid } from "nanoid";

const COMMENTS_MAP = "comments";

/** The database capabilities this module needs. */
export interface VersionDb {
  prepare(sql: string): { get(...params: any[]): any; run(...params: any[]): unknown };
}

/** The live collaboration room, as seen from the web process. */
export interface RoomControl {
  /** Persist the room's in-memory state to the database. */
  flush(docId: string): Promise<void>;
  /** Drop the room so clients reconnect to the stored state. */
  reset(docId: string): Promise<void>;
}

export type RestoreOutcome =
  | { status: "restored"; backupVersionId: string }
  | { status: "not-found" }
  | { status: "no-snapshot" };

interface VersionRow {
  title: string;
  content: string;
  yjs_state: Uint8Array | null;
}

interface DocumentStateRow {
  yjs_state: Uint8Array | null;
}

/** Snapshot the document as it is stored now, Yjs state included. */
export function snapshotDocument(
  db: VersionDb,
  docId: string,
  userId: string | null,
  auto: boolean,
): string {
  const id = nanoid(16);
  db.prepare(
    `INSERT INTO document_versions (id, document_id, title, content, yjs_state, created_by, auto)
     SELECT ?, id, title, content, yjs_state, ?, ? FROM documents WHERE id = ?`,
  ).run(id, userId, auto ? 1 : 0, docId);
  return id;
}

/**
 * The restored state with the current comments in place of the version's.
 * Comments created, resolved or deleted since the version are not content, so
 * the document keeps its present set.
 */
function withCurrentComments(restored: Uint8Array, current: Uint8Array | null): Uint8Array {
  if (!current) return restored;

  const currentDoc = new Y.Doc();
  Y.applyUpdate(currentDoc, current);

  const merged = new Y.Doc();
  Y.applyUpdate(merged, restored);

  const comments = merged.getMap(COMMENTS_MAP);
  merged.transact(() => {
    comments.clear();
    currentDoc.getMap(COMMENTS_MAP).forEach((value, key) => comments.set(key, value));
  });

  return Y.encodeStateAsUpdate(merged);
}

/**
 * Restore a past version over the current document. The current state is
 * snapshotted first (after the live room is flushed), so the restore can be
 * undone by restoring the returned `backupVersionId`.
 */
export async function restoreVersion(
  db: VersionDb,
  room: RoomControl,
  docId: string,
  versionId: string,
  userId: string | null,
): Promise<RestoreOutcome> {
  const version = db
    .prepare("SELECT title, content, yjs_state FROM document_versions WHERE id = ? AND document_id = ?")
    .get(versionId, docId) as VersionRow | undefined;

  if (!version) return { status: "not-found" };

  // Legacy versions predate yjs_state. Restoring only their markdown would
  // leave the editor untouched while looking successful.
  if (!version.yjs_state || version.yjs_state.byteLength === 0) {
    return { status: "no-snapshot" };
  }

  // Edits typed in the last few seconds live only in the room until its
  // debounced save. Without this they miss the backup and the reset drops them.
  await room.flush(docId);

  const backupVersionId = snapshotDocument(db, docId, userId, true);

  const current = db
    .prepare("SELECT yjs_state FROM documents WHERE id = ?")
    .get(docId) as DocumentStateRow | undefined;
  const state = withCurrentComments(version.yjs_state, current?.yjs_state ?? null);

  db.prepare(
    "UPDATE documents SET title = ?, content = ?, yjs_state = ?, updated_at = unixepoch() WHERE id = ?",
  ).run(version.title, version.content, Buffer.from(state), docId);

  await room.reset(docId);

  return { status: "restored", backupVersionId };
}
