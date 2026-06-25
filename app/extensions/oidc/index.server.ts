import type { LoicaExtension } from "~/extensions/sdk.server";
import { LABEL, isConfigured } from "./oidc.server";

/**
 * Generic OIDC sign-in, shipped disabled by default. An admin enables it and
 * sets OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET (or the CLOUDRON_OIDC_*
 * equivalents). It then appears as a button on the login page. The login +
 * callback routes are owned by this extension (registered in app/routes.ts).
 */
export const oidcServerExtension: LoicaExtension = {
  id: "oidc",
  description: "Single sign-on via any OpenID Connect provider.",
  defaultEnabled: false,
  authProvider: {
    label: LABEL,
    loginPath: "/auth/oidc",
    isConfigured,
  },
};
