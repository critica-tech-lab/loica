import type { Route } from "./+types/auth.oidc";
import { redirect } from "react-router";
import { getActiveAuthProviders } from "~/extensions/index.server";
import { beginLogin, PROVIDER_ID } from "~/extensions/oidc/oidc.server";

// GET /auth/oidc — start the OIDC Authorization Code + PKCE flow.
export async function loader({ request }: Route.LoaderArgs) {
  const active = getActiveAuthProviders().some((p) => p.id === PROVIDER_ID);
  if (!active) throw redirect("/login");

  try {
    return await beginLogin(request);
  } catch (e) {
    console.error("[oidc] begin login failed:", e);
    throw redirect("/login?error=oidc_failed");
  }
}
