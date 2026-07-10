import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const commitHash = execSync("git rev-parse --short HEAD").toString().trim();

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    port: 4000,
    host: "0.0.0.0",
    allowedHosts: ["mini-m4", "m4"],
  },
  // Keep server-only native modules out of the client bundle.
  // Pre-bundle deps that the workspace dashboard pulls in transitively, so
  // Vite doesn't discover them on first /w visit and force a full client
  // reload mid-navigation — which cancels in-flight fetcher loads and
  // surfaces as a "JSON.parse: unexpected end of data" error boundary.
  resolve: {
    // Global `~/…` → app dir. `vite-tsconfig-paths` only maps `~` for files
    // inside the tsconfig project, so an extension symlinked into
    // `app/extensions/` from an out-of-root repo can't use `~`. This alias
    // makes it resolve everywhere; the tsconfig mapping still drives
    // type-checking. Generic — helps any out-of-root extension.
    alias: [{ find: /^~\//, replacement: fileURLToPath(new URL("./app/", import.meta.url)) }],
    // @manuscripts/transform bundles its own prosemirror copies.
    // Force a single instance of each PM package to prevent
    // "Duplicate use of selection JSON ID" runtime errors.
    dedupe: [
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-model",
      "prosemirror-transform",
      "prosemirror-tables",
      "prosemirror-schema-basic",
      "prosemirror-schema-list",
      "prosemirror-commands",
      "prosemirror-history",
      "prosemirror-keymap",
      "prosemirror-inputrules",
      "prosemirror-gapcursor",
      "prosemirror-dropcursor",
    ],
  },
  optimizeDeps: {
    exclude: ["better-sqlite3", "@node-rs/argon2"],
    // zod is server-only but Vite's scanner sees it imported by .server.ts
    // files (which the runtime strips from the client bundle) and would
    // discover it lazily on first /w visit, triggering a reload.
    include: [
      // Workspace dashboard
      "@dnd-kit/core", "@dnd-kit/utilities", "jszip", "dompurify", "nanoid",
      "diff", "marked", "marked-footnote", "turndown", "zod",
      // Doc editor (CodeMirror + Yjs). These are listed in `ssr.noExternal`
      // for SSR but the client still needs them pre-bundled, otherwise Vite
      // discovers them on first /w/doc/:id visit and forces a reload mid-render
      // — manifesting as "dispatcher is null" or a JSON.parse error boundary.
      "@codemirror/view", "@codemirror/state", "@codemirror/lang-markdown",
      "@codemirror/commands", "@codemirror/language", "@lezer/highlight",
      "yjs", "y-websocket", "y-codemirror.next",
      // CodeMirror's transitive deps. Vite's scanner doesn't follow into
      // them eagerly, so each one would otherwise trigger its own reload.
      "@marijn/find-cluster-break", "style-mod", "w3c-keyname", "crelt",
      // ProseMirror core
      "prosemirror-state", "prosemirror-view", "prosemirror-model",
      "prosemirror-transform", "prosemirror-commands", "prosemirror-history",
      "prosemirror-keymap", "prosemirror-inputrules", "prosemirror-gapcursor",
      "prosemirror-schema-basic", "prosemirror-schema-list",
      "prosemirror-dropcursor", "prosemirror-tables", "prosemirror-markdown",
      "prosemirror-trailing-node", "prosemirror-resizable-view",
      "y-prosemirror",
      "orderedmap",
      "@manuscripts/track-changes-plugin", "@manuscripts/transform",
    ],
    // Eagerly scan the doc-editor entry so any *further* transitive deps are
    // discovered up-front rather than during a navigation. The workspace and
    // settings entries are picked up automatically via the route manifest.
    entries: [
      "app/components/Editor.tsx",
      "app/components/ProseMirrorEditor.tsx",
      "app/components/DocEditorView.tsx",
    ],
  },
  ssr: {
    external: ["better-sqlite3", "@node-rs/argon2"],
    noExternal: [
      "codemirror",
      "@codemirror/*",
      "@lezer/*",
      "yjs",
      "y-websocket",
      "y-codemirror.next",
      "y-protocols",
      "y-prosemirror",
      "lib0",
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-model",
      "prosemirror-transform",
      "prosemirror-commands",
      "prosemirror-history",
      "prosemirror-keymap",
      "prosemirror-inputrules",
      "prosemirror-gapcursor",
      "prosemirror-schema-basic",
      "prosemirror-schema-list",
      "prosemirror-dropcursor",
      "prosemirror-tables",
      "prosemirror-markdown",
      "prosemirror-trailing-node",
      "prosemirror-resizable-view",
      "orderedmap",
      "@manuscripts/track-changes-plugin",
      "@manuscripts/transform",
    ],
  },
});
