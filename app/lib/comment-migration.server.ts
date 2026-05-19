/**
 * Migrates existing CriticMarkup comments from document text to the
 * DB-backed comments table + Yjs comments map.
 *
 * Called from ws-server.ts on room creation when comments_migrated = 0.
 */

import * as Y from "yjs";
import { nanoid } from "nanoid";
import Database from "better-sqlite3";
import { join } from "node:path";

// ─── CriticMarkup comment regex ─────────────────────────

const HIGHLIGHT_COMMENT_RE = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;
const STANDALONE_COMMENT_RE = /\{>>([\s\S]*?)<<\}/g;
const AUTHOR_PREFIX_RE = /^@([^:]+):/;

interface ParsedComment {
  fullFrom: number;
  fullTo: number;
  fullMatch: string;
  highlightText: string;
  commentText: string;
  author: string | null;
}

function parseComments(text: string): ParsedComment[] {
  const comments: ParsedComment[] = [];
  const used = new Set<number>();

  // Combined: {==highlighted text==}{>>comment text<<}
  HIGHLIGHT_COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HIGHLIGHT_COMMENT_RE.exec(text)) !== null) {
    const authorMatch = AUTHOR_PREFIX_RE.exec(m[2]);
    comments.push({
      fullFrom: m.index,
      fullTo: m.index + m[0].length,
      fullMatch: m[0],
      highlightText: m[1],
      commentText: authorMatch ? m[2].slice(authorMatch[0].length) : m[2],
      author: authorMatch ? authorMatch[1] : null,
    });
    for (let i = m.index; i < m.index + m[0].length; i++) used.add(i);
  }

  // Standalone: {>>comment text<<}
  STANDALONE_COMMENT_RE.lastIndex = 0;
  while ((m = STANDALONE_COMMENT_RE.exec(text)) !== null) {
    if (used.has(m.index)) continue;
    const authorMatch = AUTHOR_PREFIX_RE.exec(m[1]);
    comments.push({
      fullFrom: m.index,
      fullTo: m.index + m[0].length,
      fullMatch: m[0],
      highlightText: "",
      commentText: authorMatch ? m[1].slice(authorMatch[0].length) : m[1],
      author: authorMatch ? authorMatch[1] : null,
    });
  }

  comments.sort((a, b) => a.fullFrom - b.fullFrom);
  return comments;
}

// ─── Migration ──────────────────────────────────────────

export function migrateDocumentComments(
  db: Database.Database,
  ydoc: Y.Doc,
  docId: string,
): boolean {
  const ytext = ydoc.getText("content");
  const ycomments = ydoc.getMap("comments");
  const content = ytext.toString();

  const parsed = parseComments(content);
  if (parsed.length === 0) {
    // No comments to migrate — just mark as done
    db.prepare("UPDATE documents SET comments_migrated = 1 WHERE id = ?").run(docId);
    return false;
  }

  // Look up user by author name (best-effort)
  const stmtFindUser = db.prepare("SELECT id FROM users WHERE name = ? LIMIT 1");
  // Fallback: use doc creator
  const docRow = db.prepare("SELECT created_by FROM documents WHERE id = ?").get(docId) as { created_by: string } | undefined;
  const fallbackUserId = docRow?.created_by ?? "";

  // Create auto-version before migration
  const stmtCreateVersion = db.prepare(
    `INSERT INTO document_versions (id, document_id, title, content, created_by, auto)
     SELECT @vid, @docId, title, @content, NULL, 1 FROM documents WHERE id = @docId`
  );
  stmtCreateVersion.run({ vid: nanoid(16), docId, content });

  // Insert comments into DB and Yjs map
  const stmtInsert = db.prepare(
    `INSERT INTO comments (id, document_id, thread_id, user_id, body, anchor_from, anchor_to, anchor_text, resolved, created_at, updated_at)
     VALUES (@id, @docId, NULL, @userId, @body, @anchorFrom, @anchorTo, @anchorText, 0, unixepoch(), unixepoch())`
  );

  // Build list of replacements (process from end to start to preserve positions)
  const replacements: Array<{ from: number; to: number; insert: string }> = [];

  ydoc.transact(() => {
    for (const comment of parsed) {
      const id = nanoid(16);
      const userRow = comment.author
        ? (stmtFindUser.get(comment.author) as { id: string } | undefined)
        : undefined;
      const userId = userRow?.id ?? fallbackUserId;
      const userName = comment.author ?? "Unknown";

      // Create relative positions for the anchor BEFORE modifying text
      let anchorFrom = null;
      let anchorTo = null;

      if (comment.highlightText) {
        // The highlight text starts after {== (3 chars) from fullFrom
        const hlStart = comment.fullFrom + 3;
        const hlEnd = hlStart + comment.highlightText.length;
        anchorFrom = Y.createRelativePositionFromTypeIndex(ytext, hlStart);
        anchorTo = Y.createRelativePositionFromTypeIndex(ytext, hlEnd);
      }

      // Insert into Yjs comments map
      ycomments.set(id, {
        threadId: null,
        userId,
        userName,
        body: comment.commentText,
        anchorFrom,
        anchorTo,
        anchorText: comment.highlightText || null,
        resolved: 0,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      // Insert into DB
      stmtInsert.run({
        id,
        docId,
        userId,
        body: comment.commentText,
        anchorFrom: anchorFrom ? JSON.stringify(anchorFrom) : null,
        anchorTo: anchorTo ? JSON.stringify(anchorTo) : null,
        anchorText: comment.highlightText || null,
      });

      // Queue replacement: strip CriticMarkup, keep highlighted text
      replacements.push({
        from: comment.fullFrom,
        to: comment.fullTo,
        insert: comment.highlightText,
      });
    }

    // Apply text replacements (from end to start to preserve positions)
    replacements.sort((a, b) => b.from - a.from);
    for (const rep of replacements) {
      ytext.delete(rep.from, rep.to - rep.from);
      if (rep.insert) {
        ytext.insert(rep.from, rep.insert);
      }
    }
  });

  // Mark as migrated
  db.prepare("UPDATE documents SET comments_migrated = 1 WHERE id = ?").run(docId);

  return true;
}
