import { readFileSync } from "node:fs";
import { join } from "node:path";

// Parse `.env` from the working directory into process.env. Existing
// environment variables always win (a real env var set by the shell, pm2, or a
// container runtime is not overwritten). Quoted values are unwrapped. Runs once
// at module load, before anything below reads an env var, so a value placed in
// `.env` — including DATA_DIR — is honored.
//
// This is the single .env loader for the app: every server entry imports this
// module (transitively, via db.server), so the pm2 ecosystem config no longer
// needs its own copy.
function loadDotEnv(): void {
  let content: string;
  try {
    content = readFileSync(join(process.cwd(), ".env"), "utf-8");
  } catch {
    return; // no .env — fine
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

// Root for all mutable application data: the SQLite database, uploaded files,
// and drop-in plugins. Defaults to the process working directory so existing
// dev and production setups are unchanged.
//
// Set DATA_DIR (via a real env var or in `.env`) to relocate data onto a
// separate or persistent volume — e.g. a deployment with a read-only
// application directory.
export const DATA_DIR = process.env.DATA_DIR || process.cwd();

export const dbPath = join(DATA_DIR, "app.db");
export const uploadsDir = join(DATA_DIR, "uploads");
export const pluginsDir = join(DATA_DIR, "plugins");
