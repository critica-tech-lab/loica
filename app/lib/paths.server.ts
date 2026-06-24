import { join } from "node:path";

// Root for all mutable application data: the SQLite database, uploaded files,
// and drop-in plugins. Defaults to the process working directory so existing
// dev and production setups are unchanged.
//
// Set DATA_DIR to relocate data onto a separate or persistent volume (e.g. a
// deployment with a read-only application directory). It must be a real
// environment variable — exported by the process manager (pm2 ecosystem env,
// systemd, a container runtime), not only present in a `.env` file, because
// these paths resolve at module load before any `.env` is read.
export const DATA_DIR = process.env.DATA_DIR || process.cwd();

export const dbPath = join(DATA_DIR, "app.db");
export const uploadsDir = join(DATA_DIR, "uploads");
export const pluginsDir = join(DATA_DIR, "plugins");
