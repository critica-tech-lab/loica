import { redirect } from "react-router";
import type { Route } from "./+types/workspace.legacy.$slug";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);
  throw redirect("/w");
}
