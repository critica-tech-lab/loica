/**
 * Server-side extension registry. Built-in extensions live in the static list
 * below (mirrored by `index.ts`, the client registry). Drop-in plugins are
 * discovered at runtime from the `plugins/` directory by `ensurePluginsLoaded`
 * — that's how an opinionated install (e.g. Critica) adds capabilities without
 * touching the bare-metal codebase.
 *
 * Server extensions may carry `node:*`-dependent code (exporters, auth
 * handlers, PDF styles) and must be excluded from the client bundle.
 */

import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoicaExtension, PdfStyle } from "./types";
import { getEnabledExtensionIds } from "~/lib/db.server";
import { pluginsDir } from "~/lib/paths.server";
import { presentationsServerExtension } from "./presentations/index.server";

/** Built-in extensions compiled into the bare repo. Empty by default. */
const builtinExtensions: LoicaExtension[] = [
  presentationsServerExtension,
];

/** Live registry: built-ins + any runtime-discovered drop-in plugins. */
export const serverExtensions: LoicaExtension[] = [...builtinExtensions];

// ─── Drop-in plugin discovery ────────────────────────────────────────────────

const PLUGINS_DIR = pluginsDir;
// .js/.mjs work under production node; .ts only resolves under bun (dev).
const ENTRY_NAMES = ["index.server.js", "index.server.mjs", "index.server.ts"];

let pluginsLoaded: Promise<void> | null = null;

/**
 * Discover and register drop-in plugins from `plugins/<name>/index.server.*`.
 * Idempotent and memoized — the scan runs at most once per process. Callers
 * that read the registry (route loaders) should `await` this first.
 */
export function ensurePluginsLoaded(): Promise<void> {
  if (!pluginsLoaded) pluginsLoaded = loadPlugins();
  return pluginsLoaded;
}

async function loadPlugins(): Promise<void> {
  if (!existsSync(PLUGINS_DIR)) return;
  let dirs: string[];
  try {
    dirs = readdirSync(PLUGINS_DIR).filter((name) => {
      if (name.startsWith(".")) return false;
      try { return statSync(join(PLUGINS_DIR, name)).isDirectory(); } catch { return false; }
    });
  } catch (err) {
    console.error("[extensions] failed to scan plugins dir:", err);
    return;
  }

  for (const name of dirs) {
    const entry = ENTRY_NAMES.map((f) => join(PLUGINS_DIR, name, f)).find(existsSync);
    if (!entry) continue;
    try {
      // @vite-ignore: a runtime path the bundler must not try to resolve.
      const mod = await import(/* @vite-ignore */ pathToFileURL(entry).href);
      const ext: LoicaExtension | undefined = mod.default ?? mod.extension;
      if (!ext || typeof ext.id !== "string") {
        console.error(`[extensions] plugin '${name}' has no valid default/extension export`);
        continue;
      }
      if (serverExtensions.some((e) => e.id === ext.id)) {
        console.error(`[extensions] plugin '${name}' id '${ext.id}' already registered — skipping`);
        continue;
      }
      serverExtensions.push(ext);
      console.log(`[extensions] loaded plugin '${ext.id}' from plugins/${name}`);
    } catch (err) {
      console.error(`[extensions] failed to load plugin '${name}':`, err);
    }
  }
}

// ─── Enablement ──────────────────────────────────────────────────────────────

/**
 * Resolve which extension IDs are currently enabled. When the admin hasn't
 * saved an explicit list, every registered extension except those marked
 * `defaultEnabled: false` is on (preserves day-one behaviour while keeping
 * opinionated drop-ins off until explicitly turned on). Once the admin saves a
 * list, only those run.
 */
export function getEnabledExtensionIdSet(): Set<string> {
  const stored = getEnabledExtensionIds();
  if (stored === null) {
    return new Set(
      serverExtensions.filter((e) => e.defaultEnabled !== false).map((e) => e.id),
    );
  }
  return new Set(stored);
}

/** Look up a server extension by the frontmatter `type:` value. */
export function getServerExtensionForDocType(type: string | null | undefined): LoicaExtension | null {
  if (!type) return null;
  const enabled = getEnabledExtensionIdSet();
  return serverExtensions.find((e) => e.docType === type && enabled.has(e.id)) ?? null;
}

/**
 * The active install-wide PDF style: the first enabled extension that declares
 * a `pdfStyle`. Null when none do → the core renders bare default LaTeX.
 */
export function getActivePdfStyle(): PdfStyle | null {
  const enabled = getEnabledExtensionIdSet();
  return serverExtensions.find((e) => e.pdfStyle && enabled.has(e.id))?.pdfStyle ?? null;
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
