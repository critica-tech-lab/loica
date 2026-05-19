import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { execSync } from "node:child_process";

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
    ],
    // Eagerly scan the doc-editor entry so any *further* transitive deps are
    // discovered up-front rather than during a navigation. The workspace and
    // settings entries are picked up automatically via the route manifest.
    entries: ["app/components/Editor.tsx", "app/components/DocEditorView.tsx"],
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
      "lib0",
    ],
  },
});
