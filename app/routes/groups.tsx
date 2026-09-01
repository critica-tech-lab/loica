import { redirect } from "react-router";

// /groups is gone. A "group" and a "teamspace" were never two things — a
// teamspace is a group that owns a workspace — but each had its own page,
// its own roster editor, and its own create button on the same screen.
// Everything now lives under the teamspace it belongs to; this only keeps
// old links and bookmarks working.
export async function loader() {
  throw redirect("/teamspaces");
}
