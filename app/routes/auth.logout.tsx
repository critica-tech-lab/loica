import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { destroySession } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const cookie = destroySession(request);
  throw redirect("/login", { headers: { "Set-Cookie": cookie } });
}

// GET /logout → redirect to home instead of destroying session
export async function loader() {
  throw redirect("/");
}
