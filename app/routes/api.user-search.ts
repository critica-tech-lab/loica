import type { Route } from "./+types/api.user-search";
import { getSessionUser } from "~/lib/auth.server";
import { searchUsers, searchUsersInMyGroups } from "~/lib/group.server";

export function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 1) return Response.json([]);

  const groupId = url.searchParams.get("groupId") || undefined;
  const scope = url.searchParams.get("scope") || undefined;

  let results;
  if (scope === "mygroups" && !user.is_admin) {
    results = searchUsersInMyGroups(user.id, q);
  } else if (user.is_admin) {
    // Admins see all users
    results = searchUsers(q, groupId);
  } else if (groupId) {
    // Non-admins see only users from their groups
    results = searchUsersInMyGroups(user.id, q, groupId);
  } else {
    results = searchUsers(q);
  }

  return Response.json(results.filter((u) => u.id !== user.id));
}
