/**
 * Pure authorization rules for @mention notifications, kept separate from
 * doc-access.server.ts so they can be unit tested without the DB.
 *
 * The bug this guards against: send-mentions emailed any `user:<id>` found
 * in the body, with no check that person could actually see the document —
 * so a caller could mention an arbitrary user id and leak the doc's title
 * and a chunk of its content to their inbox.
 */
import type { WorkspaceRole } from "~/lib/workspace.server";

/** Combines the three ways a user can see a doc: membership, folder share, direct doc share. */
export function hasDocAccess(opts: {
  role: WorkspaceRole | null;
  folderShared: boolean;
  docShared: boolean;
}): boolean {
  return Boolean(opts.role) || opts.folderShared || opts.docShared;
}

/** Caps how much of a huge doc body ends up quoted in a mention email. */
export const MAX_MENTION_BODY_LENGTH = 2000;

export function capMentionBody(body: string): string {
  return body.length > MAX_MENTION_BODY_LENGTH ? body.slice(0, MAX_MENTION_BODY_LENGTH) : body;
}
