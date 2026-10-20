# Loica Extensions

Extensions are how Loica grows without bloating its core. Reports, Presentations,
Spreadsheets — any feature that some self-hosted teams might want and others
might not — lives as an extension under `app/extensions/<name>/`.

This document is for developers writing extensions. Read it once before you
write your first extension.

---

## Extension or core? The heuristic

A feature is an **extension** only if **both** are true:

1. **Optional** — a self-hosted team could ship Loica without it
   (Reports, a custom exporter, an auth provider, future Mindmaps).
2. **Drop-in-capable** — it runs *without being compiled into the host*: it
   imports **only** `~/extensions/sdk` / `~/extensions/sdk.server`, never host
   internals (`~/components/*`, `~/lib/*`), and needs no new routes.

If either is false, it's **core**:

- **Required** (auth, folders, sharing, the markdown editor itself) → core.
- **Optional but compile-bound** — needs a custom editor UI, host internals,
  or new routes → core. **Presentations** is the canonical example: its slide
  editor imports `ProseMirrorEditor` and `DocumentContext`, so it must build
  with Loica. It's flagged `core: true` and is *not* an admin-toggleable
  extension.

**The quick test is the import list.** SDK-only → extension. Reaches into
`~/components` or `~/lib` → core.

### The procedure (for any feature idea)

1. **List the touchpoints** — every thing the feature must do that touches Loica.
2. **Match each to the SDK menu** — this is the whole menu:

| The feature needs to… | SDK point | Drop-in? |
|---|---|---|
| own a doc `type:` (frontmatter) | `docType` | ✅ |
| appear in New/Insert + starter content | `template` | ✅ |
| a row icon in lists | `rowIcon` | ✅ |
| an item in the doc ⋯ menu | `getDocMenuItems` | ✅ |
| decorate or react to the live editor (underlines, popovers) | `editorPlugins` | ✅ |
| an action in the text-selection menu | `selectionMenuItems` | ✅ |
| an API route for its own requests | `routes.ts` | folder extension only (build time) |
| override PDF / DOCX export for one doc type | `exporters.pdf` / `.docx` | ✅ |
| replace the core PDF/DOCX pipeline install-wide | `globalExporters.pdf` / `.docx` | ✅ |
| take over print/share preview | `previewHtml` | ✅ |
| add a sign-in method | `authProvider` | ✅ |
| a **custom editor UI** for the type | `EditorView` / `EditorBanner` | ❌ → core |
| a **new route / UI surface / DB access / a hook the SDK lacks** | — none — | ❌ → core |

3. **Verdict:** every touchpoint in a ✅ row → **extension**. Any touchpoint in a
   ❌ row, or with *no row at all* → **core** — build it in core, or first add a
   new extension point to the SDK (a core change), then the feature consumes it.

**Blunt version:** try to write it importing only `~/extensions/sdk`. If you
can, it's an extension. The moment you need `~/components/*`, `~/lib/*`, a route,
or a hook the SDK doesn't expose — that's the core change.

### Worked examples

| Feature | Verdict | Why |
|---|---|---|
| Google login | extension | `authProvider` |
| Mermaid doc type, read-only render | extension | `docType` + `previewHtml` |
| Mermaid with a live interactive editor | core | needs `EditorView` (host editor internals) — like presentations |
| EPUB export | core first | no `exporters.epub` hook exists — add it, then trivial |
| Word-count button in the editor toolbar | core first | no toolbar-button extension point today — add it, then extensionable |

---

## Trust & isolation

Extensions are **convention, not isolation**:

- **Not sandboxed.** A drop-in runs first-class server code — it imports the
  SDK and can do anything node can. No iframe, no separate process, no
  permissions.
- **Installed by whoever runs the server.** Drop-in extensions load at runtime
  from `plugins/<id>/`, which the operator fills on disk. There is no in-app
  install or upload flow. Because plugins run unsandboxed, adding one is a
  server-admin decision. A public marketplace would require sandboxing designed
  in *first*; it can't be retrofitted.
- **Restart, not rebuild.** A drop-in is picked up on process restart (the
  plugin scan is memoized per process) — no app rebuild. A folder under
  `app/extensions/` is compiled in, so adding or removing one *does* need a
  build.

This trust model is deliberate (Discourse and Strapi work the same way).

---

## Anatomy of an extension

An extension is a folder under `app/extensions/<name>/` with at minimum an
`index.ts` whose default export is a `LoicaExtension` object. The folder typically also
holds the feature's UI components, server-only code, templates, and assets.

```
app/extensions/mindmaps/
├── index.ts          ← client-safe extension definition (template, icon)
├── index.server.ts   ← server-only definition (extends index.ts with exporters)
├── routes.ts         ← optional API routes (default-exports route entries)
├── template.ts       ← starter content generator (client-safe)
├── MindmapView.tsx   ← custom editor view (client component)
├── parsing.server.ts ← server-side helpers (if any)
└── README.md         ← optional, describes this specific extension
```

The `.server.ts` suffix is React Router's convention for files that should
never reach the client bundle. Anything that imports `node:fs`, runs DB
queries, or uses native modules **must** end in `.server.ts`.

---

## How to add a new extension (step by step)

We'll walk through hypothetical "Mindmaps" extension to show the moves. Replace
`mindmaps` with your extension id throughout.

### 1. Create the folder

```
app/extensions/mindmaps/
```

### 2. Write the extension definition

```ts
// app/extensions/mindmaps/index.ts
import type { LoicaExtension } from "~/extensions/sdk";
import { LOICA_EXTENSION_API_VERSION } from "~/extensions/sdk";

const mindmapsExtension: LoicaExtension = {
  id: "mindmaps",
  apiVersion: LOICA_EXTENSION_API_VERSION,
  description: "Visual mindmaps with draggable nodes.",

  // Doc type — matches the frontmatter `type:` value
  docType: "mindmap",

  // Appears in "New" menu and SidePanel "Insert" section
  template: {
    id: "mindmap",
    label: "Mindmap",
    icon: "🧠",                    // emoji fallback
    Icon: SomeMindmapIcon,         // optional SVG component
    generateContent: () =>
      `---\ntype: mindmap\n---\n{"nodes":[],"edges":[]}\n`,
  },
};

// The registry only picks up a default export (or one named `extension`).
export default mindmapsExtension;
```

### 3. (Optional) Add a custom editor view

If your doc type needs more than the default markdown editor:

```ts
// in index.ts — extends the extension object above:
import { MindmapView } from "./MindmapView";

const mindmapsExtension: LoicaExtension = {
  // ... fields from step 2 ...
  EditorView: MindmapView,
};
```

The `EditorView` component receives the same props as the markdown editor
(see `~/components/Editor.tsx` for the contract). Mount it however you
want — canvas, custom DOM, anything.

### 4. (Optional) Add a server-only PDF exporter

Server-only code lives in a sibling `index.server.ts` that augments the
client extension:

```ts
// app/extensions/mindmaps/index.server.ts
import type { LoicaExtension } from "~/extensions/sdk";
import base from "./index";
import { generateMindmapPdf } from "./pdf.server";

const mindmapsServerExtension: LoicaExtension = {
  ...base,
  exporters: {
    pdf: (doc, frontmatter) =>
      generateMindmapPdf(doc.content, frontmatter, doc.title),
  },
};

export default mindmapsServerExtension;
```

### 5. Registration is automatic

There is nothing to register. `app/extensions/index.ts`, `index.server.ts` and
`routes.ts` glob `app/extensions/*/` at build time and pick up the default
export of each extension's `index.ts`, `index.server.ts` and `routes.ts`.
Removing the folder un-registers it. A named export alone is ignored: only the
built-in presentations extension is registered by name.

If the extension needs its own API route, add
`app/extensions/mindmaps/routes.ts` that `export default`s an array of React
Router route entries. See the LanguageTool extension's `routes.ts` for an
example.

### 6. Build and test

```sh
bun run build
bun run start
```

Open Loica → admin panel → "Extensions" section. Your new extension appears
with a toggle. Enable it, then create a doc from the New menu. Done.

---

## The `LoicaExtension` interface

Every field except `id` is optional. Declare only the extension points
you care about.

| Field | Type | When to use |
|---|---|---|
| `id` | `string` | Always. Stable identifier (matches the toggle in admin UI). |
| `defaultEnabled` | `boolean` | Set to `false` to keep the extension off until an admin enables it, e.g. when it needs an external server. |
| `core` | `boolean` | Compiled-in core features only (presentations). Always on and hidden from the admin toggles. |
| `apiVersion` | `number` | Always. Set to `LOICA_EXTENSION_API_VERSION`; warns on mismatch. Host-compat — distinct from `version`. |
| `version` | `string` | Recommended. The extension's OWN semver (e.g. `"1.2.0"`). Shown in admin UI; basis for update detection. |
| `homepage` / `repository` | `string` | Recommended. Linked from admin UI; `repository` is the basis for remote install/update. |
| `description` | `string` | Recommended. Shown in admin UI. |
| `docType` | `string` | When the extension owns a frontmatter `type:` value (Reports, Spreadsheets). |
| `template` | `ExtensionTemplate` | When the extension should appear in "New" / "Insert" menus. |
| `Icon` (on template) | `ComponentType` | When you want an SVG icon instead of the emoji fallback. |
| `rowIcon` | `ComponentType` | Icon shown next to docs of this type in lists. |
| `EditorView` | `ComponentType<ExtensionEditorViewProps>` | When the doc type needs a custom editor (not the markdown one). The host passes a typed prop contract. |
| `EditorBanner` | `ComponentType<ExtensionEditorBannerProps>` | Component rendered above the editor for matching docType (e.g. the "Present" pill). |
| `getDocMenuItems` | `(ctx) => ExtensionDocMenuItem[]` | Items the extension contributes to the doc actions menu. The host adds a separator after the group. |
| `editorPlugins` | `(ctx) => Plugin[]` | ProseMirror plugins the host mounts into the editable editor, e.g. inline underlines and their popovers. Not mounted on read-only views. |
| `selectionMenuItems` | `(ctx) => ExtensionSelectionMenuItem[]` | Actions added to the menu that appears over selected text. |
| `authProvider` | `AuthProvider` | When the extension contributes a sign-in option (Google OAuth, SAML, generic OIDC). |
| `exporters.pdf` | function | When PDF export of this doc type needs custom rendering. Falls back to core markdown→PDF when absent. |
| `exporters.docx` | function | Same, for DOCX. Falls back to core markdown→DOCX. |
| `globalExporters.pdf` / `.docx` | function | Replaces the core pure-JS renderer for every doc without its own `exporters` override. The escape hatch for a self-hosted install to swap in its own pipeline (pandoc/tectonic, a remote service). The first enabled extension declaring one wins. To keep the core renderer and only restyle it, call `renderPdf(markdown, title, landscape, style)` from `~/extensions/sdk.server` with a `PdfStyle` (font sizes, margins, heading scale, colors, mono dates, source captions, page numbers). |
| `previewHtml` | function | Server hook for `api/doc-preview/:id`. Return a `Response` to take over the print/share preview, or `null` to use core's markdown render. |

See `app/extensions/types.ts` for the full type definitions.

### Manifest (`package.json`) for drop-in plugins

A drop-in plugin (`plugins/<id>/`) is just a node module, so its **`package.json`
is the manifest** — no bespoke format. The loader fills any metadata the
extension didn't set inline from it:

| package.json | → extension field |
|---|---|
| `version` | `version` |
| `description` | `description` |
| `homepage` | `homepage` |
| `repository` (string or `{url}`) | `repository` |
| `engines.loica` (e.g. `"1"` / `"^1"`) | `apiVersion` (host-compat, VSCode-style) |

Built-ins declare these inline instead. The admin panel shows each extension's
`version`, source (Built-in vs Plugin), and an API-compat warning when
`apiVersion` doesn't match the host's `LOICA_EXTENSION_API_VERSION`.

---

## Activation: available vs enabled

Two states, on purpose:

- **Available** — the extension's folder is under `app/extensions/` when Loica
  is built, or under `plugins/` when the server starts (a decision made by
  whoever maintains the Loica install).
- **Enabled** — the extension is on for this install (a runtime decision made
  by the admin via `/admin` → Extensions section).

An extension must be both available *and* enabled to do anything. Disabling
an extension in admin makes it disappear from create menus, blocks creating
new docs of its type, and stops its exporters from running. **Existing docs
still open** — they just lose specialized features.

The first time the admin toggles an extension, the choice persists in
`app_settings.enabled_extensions` (a JSON array of IDs). Until that first
toggle, every available extension is enabled except those that set
`defaultEnabled: false`. Core features (`core: true`) are always on.

---

## The SDK — your only entry point to Loica

Extensions MUST import from `~/extensions/sdk` (client) or
`~/extensions/sdk.server` (server) — and nothing else from inside Loica.

**One exception**: route handlers that the extension contributes through its
`routes.ts` (files exporting a `loader` or `action`) are themselves
Loica routes. They get full access to core helpers (`getSessionUser`,
`getDocument`, etc) just like any other route. The SDK rule is for
extension-shape code — definitions, exporters, custom views, helpers.

```ts
// ✅ Allowed
import type { LoicaExtension } from "~/extensions/sdk";
import { LOICA_EXTENSION_API_VERSION, PdfIcon } from "~/extensions/sdk";

// ✅ Allowed (server-only files)
import { stripFrontmatter } from "~/extensions/sdk.server";

// ❌ Forbidden — Loica internals, may change without notice
import { PdfIcon } from "~/components/icons";
import { stripFrontmatter } from "~/lib/templates";
import { db } from "~/lib/db.server";
```

The SDK is the **stable, versioned extension contract**. Anything
re-exported from it is guaranteed not to break within a
`LOICA_EXTENSION_API_VERSION`. Anything inside `~/lib/*` or `~/components/*`
is internal — refactors will break extensions that reach into them.

This boundary is **convention today**, but the day Loica accepts
third-party extension uploads it becomes enforcement (eslint rule, runtime
check, separate npm package). Following it now means you don't have to
refactor when that happens.

If your extension needs something the SDK doesn't expose, that's a signal
to expand the SDK — not to bypass it. Open a discussion.

---

## Footer messages

An extension can show a short message in the editor footer (next to the
saved/offline dot) with a browser event; the footer removes it again. No host
import is needed, and a host without this feature ignores the event. See
`status.ts` for the full contract.

```ts
const event = new CustomEvent("loica:status", {
  cancelable: true,
  detail: { id: "my-ext", text: "Check unavailable", title: "Why…", tone: "error" },
});
window.dispatchEvent(event);
const shown = event.defaultPrevented; // true when the footer displayed it
```

One message per `id`; publish `text: null` to clear it, or pass `ttlMs` to make
it disappear by itself. Errors stay visible over info messages. If `shown` is
false, fall back to your own notice.

---

## Server-side vs client-side

An extension can have either or both. The split is enforced by file naming:

- `index.ts`, `template.ts`, `MindmapView.tsx` — **client-safe**, can be
  imported from anywhere
- `index.server.ts`, `pdf.server.ts`, anything ending `.server.ts` — **server-only**, must never be imported by client code

The two registries (`extensions` and `serverExtensions`) mirror this split.
`getExtensionForDocType()` is for client code; `getServerExtensionForDocType()`
is for routes/loaders/actions and includes exporters.

---

## Trust model — explicit decisions

These decisions justify Loica's current design. They are intentional, not
accidental, and changing any of them is a major architectural shift.

1. **Extensions are first-party code.** They are reviewed in PR like any other
   change to Loica. They have full database, filesystem, and module access.
2. **No sandbox.** A buggy or malicious extension can take down the install.
   This is acceptable because extensions are first-party.
3. **No third-party extension uploads.** Plugins reach a server only when its
   operator puts them in `plugins/`. If you need community extensions,
   sandboxing must come first (see Standard Notes' iframe model or
   Logseq's postMessage bridge).
4. **Registration at build or start.** Adding or removing a folder under
   `app/extensions/` requires a rebuild and restart; a drop-in under
   `plugins/` needs only a restart. Toggling enabled/disabled needs neither.
5. **Activation is install-wide.** Per-workspace extension toggles are not
   on the roadmap. If you need that, the `enabled_extensions` schema will
   need to change first.

---

## API versioning

`LOICA_EXTENSION_API_VERSION` is a single integer in `app/extensions/types.ts`.

**Bump it when:**

- Renaming a field on `LoicaExtension`
- Removing a field
- Changing a callback signature in a way that breaks existing implementations

**Don't bump it for:**

- Adding a new optional field
- Adding a new extension point
- Internal refactors that don't change the public types

When you bump it, every extension in this repo must be updated to the new
version (and any out-of-tree extensions should be tested). The registry
emits a console warning at startup when an extension's `apiVersion` doesn't
match the current one.

---

## Common pitfalls

- **Don't put `if (frontmatter.type === "myextension")` in core code.** That's
  the anti-pattern extensions exist to prevent. Use the registry: ask
  `getExtensionForDocType(frontmatter.type)` and call its hooks.
- **Don't import `.server.ts` files from client code.** It will break the
  build silently or at runtime.
- **Don't assume your extension is enabled.** Code that runs in the
  background (cron jobs, ws-server handlers) should check
  `getEnabledExtensionIdSet()` before doing extension-specific work.
- **Avoid reaching into other extensions.** Each extension may be installed
  without the others. If two need the same helper, copy it (the translation
  extension carries its own copy of the proofreader's `gate.ts`) or propose it
  for the SDK.
