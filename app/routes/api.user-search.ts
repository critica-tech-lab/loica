import type { Route } from "./+types/api.user-search";
import { getSessionUser } from "~/lib/auth.server";
import { searchUsers, searchUsersInMyGroups, searchUsersSharingContext } from "~/lib/group.server";
import { getClientIp, checkRateLimit } from "~/lib/rate-limit.server";
import { resolveUserSearchMode, isSearchQueryTooShort } from "~/lib/user-search-authz.server";

export function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  // Keyed per user (falling back to IP for safety) rather than just IP, so one
  // user can't drown out another behind the same NAT/proxy.
  const rl = checkRateLimit(user.id || getClientIp(request), {
    windowMs: 60 * 1000,
    max: 30,
    prefix: "user-search",
  });
  if (!rl.allowed) throw new Response("Too many search requests. Try again later.", { status: 429 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (isSearchQueryTooShort(q)) return Response.json([]);

  const groupId = url.searchParams.get("groupId") || undefined;
  const scope = url.searchParams.get("scope") || undefined;

  const mode = resolveUserSearchMode(!!user.is_admin, scope, groupId);
  let results;
  if (mode === "all") {
    results = searchUsers(q, groupId);
  } else if (mode === "my-groups") {
    results = searchUsersInMyGroups(user.id, q, groupId);
  } else {
    // Default for a non-admin with no scope/groupId: never fall through to
    // the unrestricted search — limit to people who share a workspace or
    // group with the caller.
    results = searchUsersSharingContext(user.id, q);
  }

  return Response.json(results.filter((u) => u.id !== user.id));
}
