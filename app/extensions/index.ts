/**
 * Client-safe extension registry.
 *
 * The public Loica ships with no extensions by default — this is the empty
 * registry. To add an extension:
 *   1. Create `app/extensions/<name>/index.ts` exporting a `LoicaExtension`.
 *   2. Import it here and append to the `extensions` array.
 *   3. If the extension has server-only code (exporters, auth handlers),
 *      mirror the registration in `index.server.ts`.
 *
 * See `app/extensions/README.md` for the full extension contract and a
 * step-by-step walkthrough.
 */

import type { LoicaExtension } from "./types";
import { LOICA_EXTENSION_API_VERSION } from "./types";

export const extensions: LoicaExtension[] = [];

// Warn (don't crash) when an extension targets an outdated API version.
for (const e of extensions) {
  if (e.apiVersion !== undefined && e.apiVersion !== LOICA_EXTENSION_API_VERSION) {
    // eslint-disable-next-line no-console
    console.warn(
      `[loica extensions] Extension "${e.id}" targets API v${e.apiVersion}, current is v${LOICA_EXTENSION_API_VERSION}. Update it before bumping further.`,
    );
  }
}

/**
 * Look up an extension by the frontmatter `type:` value of a document.
 *
 * **Caller must filter by enabled state** — this returns the extension
 * regardless of admin toggle. UI code should call `useDocTypeExtension`
 * instead, which gates on the current `enabledExtensionIds` so a disabled
 * extension's `EditorView`, `EditorBanner`, `getDocMenuItems`, and
 * `rowIcon` all disappear from the surface.
 */
export function getExtensionForDocType(type: string | null | undefined): LoicaExtension | null {
  if (!type) return null;
  return extensions.find((e) => e.docType === type) ?? null;
}

/**
 * Variant for non-React server-tree consumers (loaders/actions) that
 * already have an enabled set in hand. Returns null when the extension is
 * disabled. The server registry's `getServerExtensionForDocType` does the
 * same thing for `serverExtensions` — use this one only when you need
 * client-side metadata (template, EditorView, etc).
 */
export function getEnabledExtensionForDocType(
  type: string | null | undefined,
  enabledIds: Set<string>,
): LoicaExtension | null {
  const ext = getExtensionForDocType(type);
  if (!ext) return null;
  if (!enabledIds.has(ext.id)) return null;
  return ext;
}

/** All extension templates, ready to render in "Create new" menus. */
export const extensionTemplates = extensions
  .map((e) => e.template)
  .filter((t): t is NonNullable<typeof t> => Boolean(t));

/**
 * Map from template id to the extension id that owns it (e.g. "report" →
 * "reports"). Templates without an entry here are built-ins and always
 * visible. Templates with an entry are filtered by the admin's
 * enabled-extensions setting — the visibility check looks up the OWNER
 * extension's enabled state, not the template id.
 */
export const templateOwners = new Map<string, string>();
for (const e of extensions) {
  if (e.template) templateOwners.set(e.template.id, e.id);
}

