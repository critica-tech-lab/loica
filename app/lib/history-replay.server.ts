/**
 * Rebuilds "who changed what" sessions from the Yjs update log.
 *
 * The log (document_updates) is pruned and a restore replaces the document
 * state outright, so replaying it from an empty document is only correct while
 * the log is complete and unbroken. This module starts from a base snapshot
 * when one is given and refuses to show a diff it cannot prove: a session
 * whose updates depend on state we no longer have is reported as unavailable
 * instead of as an empty or invented text.
 *
 *   base snapshot (optional) ──► apply rows of session 1 ──► apply rows of session 2 ...
 *                                  before/after text          before/after text
 */

import * as Y from "yjs";

// Updates by the same user closer together than this belong to one session.
const SESSION_GAP_SECONDS = 5 * 60;

export interface LoggedUpdate {
  userId: string | null;
  userName: string | null;
  createdAt: number;
  update: Uint8Array;
}

/** Document state to start replaying from. */
export interface ReplayBase {
  createdAt: number;
  state: Uint8Array;
  /**
   * True for the state right after a restore: log rows older than `createdAt`
   * describe a document that was replaced, so they cannot be replayed.
   */
  replacesHistory: boolean;
}

export interface HistorySession {
  userId: string | null;
  userName: string | null;
  startedAt: number;
  endedAt: number;
  updateCount: number;
  contentBefore: string;
  contentAfter: string;
  /** False when the text could not be rebuilt reliably; the texts are then empty. */
  diffAvailable: boolean;
}

interface SessionRows {
  session: HistorySession;
  rows: LoggedUpdate[];
}

/** Plain text of a ProseMirror fragment: one line per top-level block. */
export function extractYjsText(frag: Y.XmlFragment): string {
  const extractNode = (node: Y.XmlElement | Y.XmlText): string => {
    if (node instanceof Y.XmlText) {
      return (node.toDelta() as Array<{ insert?: string }>)
        .map((d) => (typeof d.insert === "string" ? d.insert : ""))
        .join("");
    }
    const parts: string[] = [];
    node.forEach((c) => parts.push(extractNode(c as Y.XmlElement | Y.XmlText)));
    return parts.join("");
  };
  const parts: string[] = [];
  frag.forEach((child) => parts.push(extractNode(child as Y.XmlElement | Y.XmlText)));
  return parts.filter(Boolean).join("\n");
}

/**
 * `splitAt` is the moment the document was replaced by a restore: edits on
 * either side are different documents even when one user made them minutes apart.
 */
function groupIntoSessions(updates: LoggedUpdate[], splitAt: number | null): SessionRows[] {
  const groups: SessionRows[] = [];
  let current: SessionRows | null = null;

  for (const u of updates) {
    const crossesSplit =
      current && splitAt !== null && current.session.endedAt < splitAt && u.createdAt >= splitAt;
    const continues =
      current &&
      !crossesSplit &&
      current.session.userId === u.userId &&
      u.createdAt - current.session.endedAt < SESSION_GAP_SECONDS;

    if (current && continues) {
      current.session.endedAt = u.createdAt;
      current.session.updateCount++;
      current.rows.push(u);
      continue;
    }

    current = {
      session: {
        userId: u.userId,
        userName: u.userName,
        startedAt: u.createdAt,
        endedAt: u.createdAt,
        updateCount: 1,
        contentBefore: "",
        contentAfter: "",
        diffAvailable: false,
      },
      rows: [u],
    };
    groups.push(current);
  }

  return groups;
}

/** Yjs parks updates whose dependencies are missing instead of failing. */
function hasMissingDependencies(ydoc: Y.Doc): boolean {
  return ydoc.store.pendingStructs !== null || ydoc.store.pendingDs !== null;
}

/** Sessions oldest first, each with the text before and after it when provable. */
export function buildSessions(updates: LoggedUpdate[], base: ReplayBase | null): HistorySession[] {
  const replayFrom = base?.replacesHistory ? base.createdAt : -Infinity;
  const groups = groupIntoSessions(updates, base?.replacesHistory ? base.createdAt : null);

  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment("prosemirror");
  if (base) Y.applyUpdate(ydoc, base.state);

  let broken = false;

  for (const { session, rows } of groups) {
    // Once a session cannot be rebuilt, later ones build on a state we lack.
    if (broken || session.startedAt < replayFrom) continue;

    const before = extractYjsText(frag);
    try {
      for (const row of rows) Y.applyUpdate(ydoc, row.update);
    } catch (err) {
      console.error("[history] replay failed:", err);
      broken = true;
      continue;
    }

    if (hasMissingDependencies(ydoc)) {
      broken = true;
      continue;
    }

    session.contentBefore = before;
    session.contentAfter = extractYjsText(frag);
    session.diffAvailable = true;
  }

  return groups.map((g) => g.session);
}
