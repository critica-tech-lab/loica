/**
 * Document persistence logic: loading from DB, saving to DB, versioning.
 */

import * as Y from "yjs";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { migrateDocumentComments } from "../app/lib/comment-migration.server.ts";
import { sendCommentNotification } from "../app/lib/email.server.ts";
import { MAX_DOC_BYTES, AUTO_VERSION_INTERVAL } from "./types.ts";

/**
 * Initialize document persistence statements.
 * These are prepared once and reused.
 */
export function initializePersistenceStatements(db: Database.Database) {
  return {
    loadDoc: db.prepare<{ id: string }, { content: string; yjs_state: Buffer | null; comments_migrated: number }>(
      "SELECT content, yjs_state, comments_migrated FROM documents WHERE id = @id"
    ),
    saveDoc: db.prepare<{ id: string; content: string; state: Buffer; updatedBy: string | null }>(
      "UPDATE documents SET content = @content, yjs_state = @state, updated_at = unixepoch(), updated_by = COALESCE(@updatedBy, updated_by) WHERE id = @id"
    ),
    createVersion: db.prepare(
      `INSERT INTO document_versions (id, document_id, title, content, created_by, auto)
       SELECT @vid, @docId, title, @content, NULL, 1 FROM documents WHERE id = @docId`
    ),
    lastVersionContent: db.prepare(
      `SELECT content FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`
    ),
  };
}

export type PersistenceStatements = ReturnType<typeof initializePersistenceStatements>;

/**
 * Load a document from the database and apply its persisted Yjs state.
 * Also migrates CriticMarkup comments and seeds the comments map.
 */
export function loadDocumentState(
  db: Database.Database,
  stmts: PersistenceStatements,
  doc: Y.Doc,
  docId: string
): void {
  const row = stmts.loadDoc.get({ id: docId }) as
    | { content: string; yjs_state: Buffer | null; comments_migrated: number }
    | undefined;

  if (row) {
    if (row.yjs_state && row.yjs_state.byteLength > 0) {
      Y.applyUpdate(doc, row.yjs_state);
      // If yjs_state produced empty text but DB has content, re-seed
      // (guards against stale empty yjs_state blobs)
      if (doc.getText("content").toString().length === 0 && row.content) {
        doc.getText("content").insert(0, row.content);
      }
    } else if (row.content) {
      // First-time collab: seed from plain-text content
      doc.getText("content").insert(0, row.content);
    }
  }

  // If this is a spreadsheet doc and Y.Maps aren't seeded yet, seed them
  const textContent = doc.getText("content").toString();
  const rawContent = textContent || row?.content || "";
  if (isSpreadsheetContent(rawContent)) {
    const meta = doc.getMap("ss-meta");
    if (!meta.has("cols")) {
      seedSpreadsheetMaps(doc, rawContent);
    }
  }

  // Migrate CriticMarkup comments if needed
  if (row && !row.comments_migrated) {
    try {
      migrateDocumentComments(db, doc, docId);
      console.log(`[ws-server] Migrated CriticMarkup comments for doc ${docId}`);
    } catch (err) {
      console.error(`[ws-server] Comment migration failed for doc ${docId}:`, err);
    }
  }

  // Seed comments from DB into Yjs map
  seedCommentsMap(db, doc, docId);
}

/**
 * Load comments from DB and populate the Yjs comments map.
 */
function seedCommentsMap(db: Database.Database, doc: Y.Doc, docId: string): void {
  const stmtLoadComments = db.prepare(
    `SELECT c.id, c.thread_id, c.user_id, c.body, c.anchor_from, c.anchor_to,
            c.anchor_text, c.resolved, c.created_at, c.updated_at, u.name as user_name
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.document_id = ? ORDER BY c.created_at ASC`
  );

  const commentsMap = doc.getMap("comments");
  if (commentsMap.size > 0) return; // already seeded

  const rows = stmtLoadComments.all(docId) as Array<{
    id: string;
    thread_id: string | null;
    user_id: string;
    user_name: string;
    body: string;
    anchor_from: string | null;
    anchor_to: string | null;
    anchor_text: string | null;
    resolved: number;
    created_at: number;
    updated_at: number;
  }>;

  if (rows.length === 0) return;

  doc.transact(() => {
    for (const row of rows) {
      try {
        commentsMap.set(row.id, {
          threadId: row.thread_id,
          userId: row.user_id,
          userName: row.user_name,
          body: row.body,
          anchorFrom: row.anchor_from ? JSON.parse(row.anchor_from) : null,
          anchorTo: row.anchor_to ? JSON.parse(row.anchor_to) : null,
          anchorText: row.anchor_text,
          resolved: row.resolved,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      } catch {
        console.error(`[ws-server] Skipping corrupted comment ${row.id} for doc`);
      }
    }
  });
}

/**
 * Save document content and Yjs state to DB if within size limit.
 * Returns true if save succeeded, false if oversized.
 */
export function saveIfSafe(
  stmts: PersistenceStatements,
  docId: string,
  content: string,
  state: Buffer,
  updatedBy: string | null = null
): boolean {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
    console.warn(
      `[ws-server] Skipping save for doc ${docId}: content exceeds ${MAX_DOC_BYTES} bytes`
    );
    return false;
  }
  stmts.saveDoc.run({ id: docId, content, state, updatedBy });
  return true;
}

/**
 * Attempt to create an auto-version if enough time has passed
 * and the content has changed since the last version.
 * Pass `force: true` to bypass the time interval check (e.g. on room teardown).
 */
export function maybeAutoVersion(
  stmts: PersistenceStatements,
  docId: string,
  content: string,
  lastVersionAt: number,
  force = false
): number {
  if (!force && Date.now() - lastVersionAt < AUTO_VERSION_INTERVAL) return lastVersionAt;

  const lastRow = stmts.lastVersionContent.get(docId) as { content: string } | undefined;
  if (lastRow && lastRow.content === content) return lastVersionAt;

  stmts.createVersion.run({ vid: nanoid(16), docId, content });
  return Date.now();
}

/**
 * Persist comments from Yjs map to database.
 */
export function saveCommentsFromYjs(db: Database.Database, docId: string, commentsMap: Y.Map<unknown>): void {
  const stmtUpsertComment = db.prepare(
    `INSERT INTO comments (id, document_id, thread_id, user_id, body, anchor_from, anchor_to, anchor_text, resolved, created_at, updated_at)
     VALUES (@id, @docId, @threadId, @userId, @body, @anchorFrom, @anchorTo, @anchorText, @resolved, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       body = excluded.body, resolved = excluded.resolved, updated_at = excluded.updated_at`
  );

  const stmtDeleteComment = db.prepare(`DELETE FROM comments WHERE id = ?`);
  const stmtCommentIds = db.prepare(`SELECT id FROM comments WHERE document_id = ?`);

  // Collect existing IDs before upsert so we can detect truly new comments
  const existingIds = new Set(
    (stmtCommentIds.all(docId) as { id: string }[]).map((r) => r.id)
  );

  const yjsIds = new Set<string>();
  const newComments: Array<{ userId: string; body: string; threadId: string | null }> = [];

  commentsMap.forEach((_value, key) => {
    yjsIds.add(key);
    const entry = commentsMap.get(key) as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") return;

    if (typeof entry.userId !== "string" && entry.userId != null) return;
    if (typeof entry.body !== "string" && entry.body != null) return;

    const userId = (entry.userId as string) ?? "";
    const body = (entry.body as string) ?? "";
    const threadId = typeof entry.threadId === "string" ? entry.threadId : null;

    stmtUpsertComment.run({
      id: key,
      docId,
      threadId,
      userId,
      body,
      anchorFrom: entry.anchorFrom != null ? JSON.stringify(entry.anchorFrom) : null,
      anchorTo: entry.anchorTo != null ? JSON.stringify(entry.anchorTo) : null,
      anchorText: typeof entry.anchorText === "string" ? entry.anchorText : null,
      resolved: typeof entry.resolved === "number" ? entry.resolved : 0,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Math.floor(Date.now() / 1000),
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Math.floor(Date.now() / 1000),
    });

    if (!existingIds.has(key)) {
      newComments.push({ userId, body, threadId });
    }
  });

  // Delete DB rows not in Yjs map
  for (const row of stmtCommentIds.all(docId) as { id: string }[]) {
    if (!yjsIds.has(row.id)) {
      stmtDeleteComment.run(row.id);
    }
  }

  // Email the document owner about new comments
  if (newComments.length > 0) {
    notifyOwnerOfNewComments(db, docId, newComments);
  }
}

const lastNotificationTime = new Map<string, number>();
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

function notifyOwnerOfNewComments(
  db: Database.Database,
  docId: string,
  newComments: Array<{ userId: string; body: string; threadId: string | null }>
): void {
  try {
    const now = Date.now();
    const lastSent = lastNotificationTime.get(docId) ?? 0;
    if (now - lastSent < NOTIFICATION_COOLDOWN_MS) return;
    lastNotificationTime.set(docId, now);
    const doc = db.prepare<[string], { created_by: string; title: string }>(
      "SELECT created_by, title FROM documents WHERE id = ?"
    ).get(docId);
    if (!doc) return;

    const owner = db.prepare<[string], { email: string; name: string }>(
      "SELECT email, name FROM users WHERE id = ?"
    ).get(doc.created_by);
    if (!owner) return;

    // Only notify about comments from other users
    const othersComments = newComments.filter((c) => c.userId !== doc.created_by);
    if (othersComments.length === 0) return;

    // Deduplicate commenter names
    const commenterIds = [...new Set(othersComments.map((c) => c.userId))];
    const commenterNames: string[] = [];
    for (const uid of commenterIds) {
      const u = db.prepare<[string], { name: string }>(
        "SELECT name FROM users WHERE id = ?"
      ).get(uid);
      if (u) commenterNames.push(u.name);
    }
    if (commenterNames.length === 0) return;

    const siteUrl = process.env.SITE_URL ?? "";
    const docUrl = siteUrl ? `${siteUrl}/w/doc/${docId}` : `/w/doc/${docId}`;
    const commenterLabel = commenterNames.join(", ");

    // Use the first new comment's body as preview
    const previewBody = othersComments[0].body;

    sendCommentNotification(
      owner.email,
      owner.name,
      commenterLabel,
      doc.title,
      previewBody,
      docUrl
    );
  } catch (err) {
    console.error(`[ws-server] Failed to send comment email for doc ${docId}:`, err);
  }
}

// ── Spreadsheet Y.Map helpers ─────────────────────────────────────────────────

function isSpreadsheetContent(content: string): boolean {
  return /^---\s*\n[\s\S]*?type:\s*spreadsheet[\s\S]*?\n---/.test(content);
}

function seedSpreadsheetMaps(doc: Y.Doc, content: string): void {
  const body = content.replace(/^---[\s\S]*?---\s*/, "").trim();
  if (!body) return;
  try {
    const data = JSON.parse(body);
    const meta = doc.getMap("ss-meta");
    const cells = doc.getMap("ss-cells");
    const colWidths = doc.getMap("ss-colWidths");
    const rowHeights = doc.getMap("ss-rowHeights");
    const styles = doc.getMap("ss-styles");

    const MAX_CELLS = 10_000;
    doc.transact(() => {
      meta.set("cols", data.cols ?? 6);
      meta.set("rows", data.rows ?? 20);
      if (data.cells) {
        let count = 0;
        for (const [k, v] of Object.entries(data.cells)) {
          if (++count > MAX_CELLS) break;
          if (v) cells.set(k, v as string);
        }
      }
      if (data.colWidths) {
        for (const [k, v] of Object.entries(data.colWidths)) {
          if (v) colWidths.set(k, v as number);
        }
      }
      if (data.rowHeights) {
        for (const [k, v] of Object.entries(data.rowHeights)) {
          if (v) rowHeights.set(String(k), v as number);
        }
      }
      if (data.styles) {
        for (const [k, v] of Object.entries(data.styles)) {
          if (v && typeof v === "object") styles.set(k, JSON.stringify(v));
        }
      }
    });
  } catch (e) {
    console.error("[ws-server] Failed to seed spreadsheet maps:", e);
  }
}

/**
 * Extract content string from a Y.Doc.
 * For spreadsheet docs (with ss-meta Y.Map), serializes from Y.Maps.
 * For regular docs, reads from Y.Text("content").
 */
export function getDocContent(doc: Y.Doc): string {
  const meta = doc.getMap("ss-meta");
  if (meta.has("cols")) {
    const cells = doc.getMap("ss-cells");
    const colWidths = doc.getMap("ss-colWidths");
    const rowHeights = doc.getMap("ss-rowHeights");
    const styles = doc.getMap("ss-styles");

    const cellsObj: Record<string, string> = {};
    cells.forEach((v, k) => { if (v) cellsObj[k] = v as string; });

    const colWidthsObj: Record<string, number> = {};
    colWidths.forEach((v, k) => { if (v) colWidthsObj[k] = v as number; });

    const rowHeightsObj: Record<string, number> = {};
    rowHeights.forEach((v, k) => { if (v) rowHeightsObj[String(k)] = v as number; });

    const stylesObj: Record<string, unknown> = {};
    styles.forEach((v, k) => {
      try { stylesObj[k] = JSON.parse(v as string); } catch {}
    });

    const json = JSON.stringify({
      cols: meta.get("cols") ?? 6,
      rows: meta.get("rows") ?? 20,
      cells: cellsObj,
      colWidths: colWidthsObj,
      rowHeights: rowHeightsObj,
      styles: stylesObj,
    });
    return `---\ntype: spreadsheet\n---\n${json}`;
  }

  // Legacy markdown docs use Y.Text("content")
  const markdownText = doc.getText("content").toString();
  if (markdownText.length > 0) return markdownText;

  // ProseMirror docs use Y.XmlFragment("prosemirror")
  const pmFrag = doc.getXmlFragment("prosemirror");
  if (pmFrag.length > 0) return extractTextFromXmlFragment(pmFrag);

  return "";
}

function extractTextFromXmlFragment(frag: Y.XmlFragment): string {
  const parts: string[] = [];
  frag.forEach((child) => parts.push(extractTextFromYNode(child)));
  return parts.filter(Boolean).join("\n");
}

function extractTextFromYNode(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString();
  const parts: string[] = [];
  node.forEach((child) => parts.push(extractTextFromYNode(child)));
  return parts.join("");
}
