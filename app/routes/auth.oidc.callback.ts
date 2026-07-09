import type { Route } from "./+types/auth.oidc.callback";
import { redirect } from "react-router";
import { getActiveAuthProviders } from "~/extensions/index.server";
import { handleCallback, PROVIDER_ID } from "~/extensions/oidc/oidc.server";

// GET /auth/oidc/callback — IdP redirects here with ?code&state.
export async function loader({ request }: Route.LoaderArgs) {
  const active = getActiveAuthProviders().some((p) => p.id === PROVIDER_ID);
  if (!active) throw redirect("/login");

  let result;
  try {
    result = await handleCallback(request);
  } catch (e) {
    console.error("[oidc] callback failed:", e);
    throw redirect("/login?error=oidc_failed");
  }

  if (!result.ok) {
    console.warn("[oidc] callback rejected:", result.error);
    throw redirect("/login?error=oidc_failed");
  }

  const headers = new Headers();
  headers.append("Set-Cookie", result.sessionCookie);
  headers.append("Set-Cookie", result.clearTx);
  throw redirect(result.next ?? "/w", { headers });
}
