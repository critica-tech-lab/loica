/**
 * Pure authorization rules for /api/user-search, kept separate from
 * group.server.ts so they can be unit tested without pulling in the DB.
 *
 * The bug this guards against: a non-admin caller with no `scope` and no
 * `groupId` fell through to the unrestricted search (name/email of every
 * user in the install). Only admins get that; everyone else is limited to
 * people they already share a workspace or group with.
 */

/** Below this, a search is too broad to be worth running — and cheap to spam. */
export const MIN_USER_SEARCH_QUERY_LENGTH = 2;

export function isSearchQueryTooShort(query: string): boolean {
  return query.length < MIN_USER_SEARCH_QUERY_LENGTH;
}

export type UserSearchMode = "all" | "my-groups" | "shared-context";

/**
 * Decide which search a caller is allowed to run. Admins always get the
 * unrestricted search. A `groupId` (add-to-group pickers) or an explicit
 * `mygroups` scope narrows to that caller's own groups. Everything else
 * (the common case: a share dialog with no scope given) is restricted to
 * people who share a workspace or a group with the caller — never the
 * full user table.
 */
export function resolveUserSearchMode(
  isAdmin: boolean,
  scope?: string,
  groupId?: string
): UserSearchMode {
  if (isAdmin) return "all";
  if (scope === "mygroups" || groupId) return "my-groups";
  return "shared-context";
}
