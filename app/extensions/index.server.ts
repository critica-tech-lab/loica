/**
 * Server-side extension registry. Mirror this list with `index.ts` (the
 * client registry). The two split because exporters and auth handlers
 * depend on `node:*` modules and must be excluded from the client bundle.
 */

import type { LoicaExtension } from "./types";
import { getEnabledExtensionIds } from "~/lib/db.server";

export const serverExtensions: LoicaExtension[] = [];

/**
 * Resolve which extension IDs are currently enabled. When the admin hasn't
 * toggled anything, every registered extension is on (preserves day-one
 * behaviour). Once the admin saves an explicit list, only those run.
 */
export function getEnabledExtensionIdSet(): Set<string> {
  const stored = getEnabledExtensionIds();
  if (stored === null) return new Set(serverExtensions.map((e) => e.id));
  return new Set(stored);
}

/** Look up a server extension by the frontmatter `type:` value. */
export function getServerExtensionForDocType(type: string | null | undefined): LoicaExtension | null {
  if (!type) return null;
  const enabled = getEnabledExtensionIdSet();
  return serverExtensions.find((e) => e.docType === type && enabled.has(e.id)) ?? null;
}

/**
 * Active auth providers for the login page: extensions that declare an
 * `authProvider` AND are enabled by admin AND pass their `isConfigured`
 * check (when present).
 */
export function getActiveAuthProviders(): Array<{ id: string; label: string; loginPath: string }> {
  const enabled = getEnabledExtensionIdSet();
  return serverExtensions
    .filter((e) => e.authProvider && enabled.has(e.id))
    .filter((e) => e.authProvider!.isConfigured?.() ?? true)
    .map((e) => ({
      id: e.id,
      label: e.authProvider!.label,
      loginPath: e.authProvider!.loginPath,
    }));
}
