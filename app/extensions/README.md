# Loica Extensions

Extensions are how Loica grows without bloating its core. Reports, Presentations,
Spreadsheets — any feature that some self-hosted teams might want and others
might not — lives as an extension under `app/extensions/<name>/`.

This document is for developers writing extensions. Read it once before you
write your first extension.

---

## Extension or core? The heuristic

Ask yourself:

> *Could a reasonable self-hosted team want to ship Loica without this feature?*

- **Yes** → it's an extension (Reports, Comments, AI assistant, future Mindmaps)
- **No** → it's core (auth, folders, sharing model, the markdown editor itself)

The core is what defines Loica. Removing it breaks the product. Extensions are
features that extend Loica for some users without being required for everyone.

When in doubt, prefer extension. It's easier to promote an extension to core
later than to extract a core feature into an extension.

---

## What extensions are *not*

Extensions in Loica are **convention, not isolation**. A few things they
explicitly are not:

- **Not sandboxed.** Extensions are first-class TypeScript that can `import`
  from anywhere in the app. No iframe, no separate process, no permissions.
- **Not third-party installable.** Extensions live in this repo and are
  reviewed like any other code change. There is no "upload a ZIP" flow.
- **Not hot-reloadable.** Adding an extension requires a build. Toggling an
  existing extension on/off is the only runtime operation.

This trust model is deliberate (Discourse and Strapi work the same way).
If we ever ship a marketplace of community-uploaded extensions, sandboxing
must be designed in *before* that — it cannot be retrofitted.

---

## Anatomy of an extension

An extension is a folder under `app/extensions/<name>/` with at minimum an
`index.ts` exporting a `LoicaExtension` object. The folder typically also
holds the feature's UI components, server-only code, templates, and assets.

```
app/extensions/mindmaps/
├── index.ts          ← client-safe extension definition (template, icon)
├── index.server.ts   ← server-only definition (extends index.ts with exporters)
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
import type { LoicaExtension } from "~/extensions/types";
import { LOICA_EXTENSION_API_VERSION } from "~/extensions/types";

export const mindmapsExtension: LoicaExtension = {
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
```

### 3. (Optional) Add a custom editor view

If your doc type needs more than the default markdown editor:

```ts
// in index.ts — extends the extension object above:
import { MindmapView } from "./MindmapView";

export const mindmapsExtension: LoicaExtension = {
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
import type { LoicaExtension } from "~/extensions/types";
import { mindmapsExtension as base } from "./index";
import { generateMindmapPdf } from "./pdf.server";

export const mindmapsServerExtension: LoicaExtension = {
  ...base,
  exporters: {
    pdf: (doc, frontmatter) =>
      generateMindmapPdf(doc.content, frontmatter, doc.title),
  },
};
```

### 5. Register the extension

Add two lines to `app/extensions/index.ts`:

```ts
import { mindmapsExtension } from "./mindmaps";

export const extensions: LoicaExtension[] = [
  mindmapsExtension,        // ← add here
];
```

And if your extension has server code, the corresponding line in
`app/extensions/index.server.ts`:

```ts
import { mindmapsServerExtension } from "./mindmaps/index.server";

export const serverExtensions: LoicaExtension[] = [
  mindmapsServerExtension,  // ← add here
];
```

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
| `authProvider` | `AuthProvider` | When the extension contributes a sign-in option (Google OAuth, SAML, generic OIDC). |
| `exporters.pdf` | function | When PDF export of this doc type needs custom rendering. Falls back to core markdown→PDF when absent. |
| `exporters.docx` | function | Same, for DOCX. Falls back to core markdown→DOCX. |
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

- **Available** — the extension is in `app/extensions/index.ts` (a build-time
  decision made by whoever maintains the Loica install).
- **Enabled** — the extension is on for this install (a runtime decision made
  by the admin via `/admin` → Extensions section).

An extension must be both available *and* enabled to do anything. Disabling
an extension in admin makes it disappear from create menus, blocks creating
new docs of its type, and stops its exporters from running. **Existing docs
still open** — they just lose specialized features.

The first time the admin toggles an extension, the choice persists in
`app_settings.enabled_extensions` (a JSON array of IDs). Until that first
toggle, every available extension is enabled by default — no surprises on
upgrade.

---

## The SDK — your only entry point to Loica

Extensions MUST import from `~/extensions/sdk` (client) or
`~/extensions/sdk.server` (server) — and nothing else from inside Loica.

**One exception**: route handlers that the extension contributes to
`app/routes.ts` (files exporting a `loader` or `action`) are themselves
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
3. **No third-party extension uploads.** If you need community extensions,
   sandboxing must come first (see Standard Notes' iframe model or
   Logseq's postMessage bridge).
4. **Build-time registration.** Adding/removing an extension requires a
   rebuild and restart. Toggling enabled/disabled does not.
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
- **Avoid reaching into other extensions.** If you need a helper from
  another extension, factor it into `app/extensions/shared/` first.
