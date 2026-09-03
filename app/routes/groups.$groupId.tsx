import { redirect } from "react-router";
import type { Route } from "./+types/groups.$groupId";
import { getGroup } from "~/lib/group.server";

// This page edited the same roster as /t/:id/members through a second set of
// functions. It's gone; the teamspace's own settings page is the one editor.
// A group with no teamspace can't be reached any more — none can be created —
// so those fall back to the list.
export async function loader({ params }: Route.LoaderArgs) {
  const group = getGroup(params.groupId);
  throw redirect(group?.workspace_id ? `/t/${group.workspace_id}/members` : "/teamspaces");
}
