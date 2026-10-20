import { getSessionUser } from "~/lib/auth.server";
import { getRecentDocs } from "~/lib/document.server";
import { getMembership } from "~/lib/workspace.server";
import { getUserDocAccess } from "~/lib/doc-access.server";
import { getRateLimitKey, checkRateLimit } from "~/lib/rate-limit.server";
import { buildRecentList, type RecentAccess } from "~/lib/recent-docs";

const RECENT_LIMIT = 8;
// Fetch extra rows: some may no longer be accessible and are skipped.
const RECENT_FETCH = RECENT_LIMIT * 4;

/** Docs the signed-in user opened last, still openable by them. Feeds the empty Cmd+K. */
export async function loader({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rl = checkRateLimit(getRateLimitKey(request, user.id), { windowMs: 60_000, max: 60, prefix: "recent-docs" });
  if (!rl.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }

  const rows = getRecentDocs(user.id, RECENT_FETCH);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const items = buildRecentList(
    rows,
    (candidate): RecentAccess => {
      const row = byId.get(candidate.id)!;
      if (getMembership(row.workspace_id, user.id, user.is_admin)) {
        return "member";
      }
      return getUserDocAccess(row, user) ? "shared" : null;
    },
    RECENT_LIMIT
  );

  return Response.json(items);
}
