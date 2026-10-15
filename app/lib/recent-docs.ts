/**
 * Pure helpers for the "recently opened" list (Cmd+K with an empty query).
 * No DB access here so the rules are unit-testable; the route supplies the
 * access check.
 */

export type RecentCandidate = {
  id: string;
  title: string;
  workspace_name: string;
  viewed_at: number;
};

/** How the caller reaches a doc: as a workspace member, through a share, or not at all. */
export type RecentAccess = "member" | "shared" | null;

export type RecentItem = RecentCandidate & { href: string };

const MEMBER_ROUTE = "/w/doc";
const SHARED_ROUTE = "/shared/doc";

/**
 * Keep the first `limit` candidates the user can still open, in order. A row
 * whose access was lost since it was recorded (left the workspace, share
 * removed) is skipped without using up a slot.
 */
export function buildRecentList(
  candidates: RecentCandidate[],
  accessOf: (candidate: RecentCandidate) => RecentAccess,
  limit: number
): RecentItem[] {
  const items: RecentItem[] = [];
  for (const candidate of candidates) {
    if (items.length >= limit) {
      break;
    }
    const access = accessOf(candidate);
    if (!access) {
      continue;
    }
    const base = access === "member" ? MEMBER_ROUTE : SHARED_ROUTE;
    items.push({ ...candidate, href: `${base}/${candidate.id}` });
  }
  return items;
}
