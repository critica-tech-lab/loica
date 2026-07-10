/**
 * Client-safe extension registry.
 *
 * Extensions are auto-discovered at build time — the core never names them.
 * To add one:
 *   1. Create `app/extensions/<name>/index.ts` that `export default`s a
 *      `LoicaExtension` (client-safe). It's picked up by the glob below.
 *   2. If it has server-only code (exporters, auth handlers, route actions),
 *      add `app/extensions/<name>/index.server.ts` — also `export default` —
 *      which `index.server.ts` discovers the same way.
 *   3. Removing the folder un-registers it. No edit to this file either way.
 *
 * Built-ins that ship with loica (e.g. presentations) are listed explicitly
 * below via named imports; everything else is discovered.
 *
 * See `app/extensions/README.md` for the full extension contract and a
 * step-by-step walkthrough.
 */

import type { LoicaExtension } from "./types";
import { LOICA_EXTENSION_API_VERSION } from "./types";
import { presentationsExtension } from "./presentations";

// Built-in extensions that ship WITH loica (always compiled in).
const builtinExtensions: LoicaExtension[] = [
  presentationsExtension,
];

/**
 * Auto-discovered client extensions. Any `app/extensions/<name>/index.ts` that
 * `export default`s (or exports `const extension`) a `LoicaExtension` is picked
 * up at build time — core never names it, so dropping a folder in registers it
 * and removing it un-registers it, with no edit here. Mirrors the server-side
 * `plugins/` discovery and its `mod.default ?? mod.extension` convention.
 *
 * Built-ins above use NAMED exports, so the glob (which reads default/extension)
 * skips them; any id collision is de-duplicated in favour of the built-in.
 */
const discoveredModules = import.meta.glob<{
  default?: LoicaExtension;
  extension?: LoicaExtension;
}>("./*/index.ts", { eager: true });

export const extensions: LoicaExtension[] = [...builtinExtensions];
const seenIds = new Set(extensions.map((e) => e.id));
for (const mod of Object.values(discoveredModules)) {
  const ext = mod.default ?? mod.extension;
  if (!ext || typeof ext.id !== "string" || seenIds.has(ext.id)) continue;
  seenIds.add(ext.id);
  extensions.push(ext);
}

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

