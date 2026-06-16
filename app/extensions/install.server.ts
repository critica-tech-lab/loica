/**
 * Install / uninstall drop-in extensions from a git repository.
 *
 * SECURITY: installing an extension means running its server code on the next
 * restart — this is remote code execution by design. The gate is a TWO-key
 * model:
 *   1. The operator sets `LOICA_EXTENSION_SOURCES` (comma-separated URL prefixes)
 *      at deploy time. Empty (default) → installing is disabled entirely.
 *   2. Only an admin can trigger an install, and only from an allowlisted source.
 * So an admin alone cannot pull arbitrary code — the deploy operator must have
 * pre-approved the source. There is no community/untrusted upload path.
 *
 * Only SDK-only extensions can be installed this way (they import nothing but
 * `~/extensions/sdk[.server]`). Compile-bound features are core, not drop-ins.
 *
 * Loading is NOT live: a freshly installed plugin is picked up by
 * `ensurePluginsLoaded` on the next process restart (the scan is memoized).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, renameSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOICA_EXTENSION_API_VERSION } from "./types";

const execFileP = promisify(execFile);
const PLUGINS_DIR = join(process.cwd(), "plugins");
const ENTRY_NAMES = ["index.server.js", "index.server.mjs", "index.server.ts"];
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,38}$/;

/** Operator-approved source prefixes. Empty → install disabled. */
export function getAllowedSources(): string[] {
  return (process.env.LOICA_EXTENSION_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isInstallEnabled(): boolean {
  return getAllowedSources().length > 0;
}

function isAllowedSource(url: string): boolean {
  const allowed = getAllowedSources();
  return allowed.some((prefix) => url.startsWith(prefix));
}

/** A safe folder name derived from a package.json `name` (scope + prefix stripped). */
function slugFromPackageName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const slug = name.replace(/^@[^/]+\//, "").replace(/^loica-/, "");
  return SAFE_SLUG.test(slug) ? slug : null;
}

export type InstalledPlugin = { dir: string; name: string; version: string | null };

/** Drop-in plugins currently on disk (a dir under plugins/ with a package.json). */
export function listInstalledPlugins(): InstalledPlugin[] {
  if (!existsSync(PLUGINS_DIR)) return [];
  const out: InstalledPlugin[] = [];
  for (const dir of readdirSync(PLUGINS_DIR)) {
    if (dir.startsWith(".")) continue;
    const pkgPath = join(PLUGINS_DIR, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      out.push({ dir, name: typeof pkg.name === "string" ? pkg.name : dir, version: pkg.version ?? null });
    } catch { /* skip unreadable */ }
  }
  return out;
}

export type InstallResult = { dir: string; name: string; version: string | null };

/**
 * Clone an extension repo into `plugins/`, validating its manifest. Throws on
 * any policy/validation failure (with the staging dir cleaned up). Caller must
 * be an admin; the route enforces that.
 */
export async function installExtensionFromRepo(url: string): Promise<InstallResult> {
  if (!isInstallEnabled()) throw new Error("Extension installation is disabled (no LOICA_EXTENSION_SOURCES configured).");
  if (typeof url !== "string" || !/^https:\/\/\S+$/.test(url)) throw new Error("A valid https git URL is required.");
  if (!isAllowedSource(url)) throw new Error("That source is not in the allowlist (LOICA_EXTENSION_SOURCES).");

  const staging = join(PLUGINS_DIR, `.staging-${Date.now()}`);
  const cleanup = () => { try { rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ } };
  try {
    // execFile (no shell) + `--` so the URL can never be read as a git option.
    await execFileP("git", ["clone", "--depth", "1", "--single-branch", "--", url, staging], { timeout: 60_000 });

    const pkgPath = join(staging, "package.json");
    if (!existsSync(pkgPath)) throw new Error("Repo has no package.json manifest.");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;

    const slug = slugFromPackageName(pkg.name);
    if (!slug) throw new Error(`Manifest "name" is missing or not a safe slug: ${String(pkg.name)}`);

    // Host-compat: engines.loica must match this host's API version.
    const eng = (pkg.engines as Record<string, string> | undefined)?.loica;
    const targetApi = eng ? parseInt(String(eng).replace(/[^0-9]/g, ""), 10) : NaN;
    if (Number.isFinite(targetApi) && targetApi !== LOICA_EXTENSION_API_VERSION) {
      throw new Error(`Extension targets Loica API v${targetApi}; this host is v${LOICA_EXTENSION_API_VERSION}.`);
    }

    // Must have a server entry the loader can import.
    if (!ENTRY_NAMES.some((f) => existsSync(join(staging, f)))) {
      throw new Error(`Repo has no index.server.{js,mjs,ts} entry.`);
    }

    const dest = join(PLUGINS_DIR, slug);
    if (existsSync(dest)) throw new Error(`A plugin named "${slug}" is already installed. Uninstall it first to upgrade.`);

    // Drop the git history — we keep the code, not the repo.
    rmSync(join(staging, ".git"), { recursive: true, force: true });
    renameSync(staging, dest);

    console.log(`[extensions] installed '${slug}'${pkg.version ? ` v${pkg.version}` : ""} from ${url} (restart to activate)`);
    return { dir: slug, name: String(pkg.name ?? slug), version: (pkg.version as string) ?? null };
  } catch (err) {
    cleanup();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Remove an installed drop-in plugin (by its folder name). Restart to deactivate. */
export function uninstallExtension(dir: string): void {
  if (!SAFE_SLUG.test(dir)) throw new Error("Invalid plugin name.");
  const target = join(PLUGINS_DIR, dir);
  // Must be an existing dir that actually looks like an installed plugin.
  if (!existsSync(target) || !statSync(target).isDirectory() || !existsSync(join(target, "package.json"))) {
    throw new Error(`No installed plugin named "${dir}".`);
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`[extensions] uninstalled '${dir}' (restart to deactivate)`);
}
