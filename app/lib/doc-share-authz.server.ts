/**
 * Pure authorization rule for sharing a doc with a group, kept separate
 * from doc-sharing.server.ts so it's unit testable without the DB.
 *
 * The bug this guards against: shareDocWithGroup() accepted any groupId —
 * a caller could share a document with a group from an unrelated
 * workspace/teamspace they aren't even a member of, handing every member
 * of that group access (and a notification email).
 */

export interface ShareableGroup {
  workspace_id: string | null;
}

/**
 * A group is a valid share target for a doc when it belongs to the doc's
 * own workspace (the normal teamspace-group case), or — for a workspace-less
 * group — when the caller is themselves a member of it.
 */
export function canShareDocWithGroup(opts: {
  group: ShareableGroup | null;
  docWorkspaceId: string;
  callerIsGroupMember: boolean;
}): boolean {
  if (!opts.group) return false;
  if (opts.group.workspace_id === opts.docWorkspaceId) return true;
  return opts.callerIsGroupMember;
}
