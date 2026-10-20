/**
 * Runs the *.dbtest.ts files under Node.
 *
 * Why not `bun test`: better-sqlite3 aborts the whole Bun process when it
 * opens a database (Bun 1.3.9). Production runs the app and the ws server
 * under Node, where it works, so these tests run there too.
 *
 * Why Vite: the domain modules import through the `~/` alias and, via
 * templates.ts, through import.meta.glob and .tsx files that plain Node
 * cannot load. Vite's SSR loader handles all of it, with no extra dependency.
 *
 * Safety: DATA_DIR points at a throwaway directory, so the tests build a
 * fresh schema and never touch a real app.db.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_SUFFIX = ".dbtest.ts";
const SHIM_PATH = join(ROOT, "scripts/node-test-shim.ts");
const SEARCH_DIRS = ["app", "ws"];

const dataDir = mkdtempSync(join(tmpdir(), "loica-dbtest-"));
// Must be set before any module imports paths.server.ts.
process.env.DATA_DIR = dataDir;

function findTests() {
  return SEARCH_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((file) => String(file).endsWith(TEST_SUFFIX))
      .map((file) => join(ROOT, dir, String(file))),
  ).sort();
}

const server = await createServer({
  root: ROOT,
  configFile: false,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: [
      { find: "bun:test", replacement: SHIM_PATH },
      // Same alias as tsconfig.json: `~` is app/.
      { find: /^~\//, replacement: `${join(ROOT, "app")}/` },
    ],
  },
});

const files = findTests();
if (files.length === 0) {
  console.error(`No *${TEST_SUFFIX} files found.`);
  process.exit(1);
}

// Loading only queues the registrations (see the shim); nothing runs yet.
for (const file of files) {
  await server.ssrLoadModule(file);
}
const shim = await server.ssrLoadModule(SHIM_PATH);
shim.replayAll();

// Last root hook: runs after every test. Vite's server keeps the event loop
// alive, so closing it is what lets the process exit.
after(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});
