# Document Storage Architecture (PM-native target)

Status: **design note**. Apply during/after the CodeMirror → ProseMirror data
migration (see `migration-plan.md`).

This describes the storage model Loica core should converge on once CodeMirror
is gone, and why. It is a decision record, not a task list.

---

## TL;DR

- **Single source of truth: the Yjs binary** (`yjs_state` blob, holding
  `Y.XmlFragment("prosemirror")`).
- **Markdown is a one-way derived projection** — generated from the PM doc,
  written to `documents.content`, used for export / search / preview. It is
  **never parsed back** into the document as a storage path.
- Consequence: no faithful markdown **round-trip** is required. We only ever
  serialize `PM → markdown`. We never need a storage-grade `markdown → PM`
  parser.

---

## 1. Background: why markdown was ever the source

Loica started on **CodeMirror**, a plain-text editor. There, the document *is*
its markdown string. It was stored canonically in `Y.Text("content")`. No
serialization existed or was needed — the markdown was the document.

So the original model was correct **for CodeMirror**:

| Editor | Yjs field | Type | Canonical? |
|--------|-----------|------|-----------|
| CodeMirror (old) | `getText("content")` | `Y.Text` | yes — markdown *is* the doc |
| ProseMirror (new) | `getXmlFragment("prosemirror")` | `Y.XmlFragment` | yes — node tree *is* the doc |

When ProseMirror arrived, the document became a **node tree**, not a string.
Markdown stopped being the document and became a *projection* of it. The
markdown column and the `markdown → PM` parser survived only as **CodeMirror
legacy**, not because PM needs them.

## 2. The problem this causes today

Because markdown is still treated as a re-parseable representation, anything new
that lives *inside* the PM tree (e.g. a `mention` node, embeds, custom blocks)
must survive a full round-trip:

```
PM doc ──serialize──► markdown ──store/load──► markdown ──parse──► PM doc
       (loicaMarkdownSerializer)               (defaultMarkdownParser)
```

The `parse` half is the fragile one: `defaultMarkdownParser`
(`ws/persistence.ts`, `seedPmFragmentFromMarkdown`) does not know custom nodes,
so it silently degrades them to plain text. Maintaining a faithful inverse
parser for every custom node is real, ongoing, bug-prone work.

## 3. Target model: binary canonical, markdown one-way

Declare it explicitly:

> `documents.content` (markdown) is a **derived, write-only projection**. The
> Yjs binary is the only source of truth for PM documents.

What this buys us:

- **No inverse parser as a storage path.** `markdown → PM` is needed only for
  two *user actions*, neither of which is storage:
  1. Pasting markdown into the editor (a transform the user explicitly invokes).
  2. Importing external `.md` files.
  Both may be lossy for custom nodes and that's acceptable — they are not the
  authoritative load path.
- **Loading a PM doc never touches markdown.** The editor hydrates from
  `yjs_state` (`Y.applyUpdate`). Versions also store `yjs_state`
  (`document_versions`), so restore is binary too. Mentions and other custom
  nodes survive editing, saving, and version restore via the binary — no
  serialization involved.
- **Custom nodes cost ~nothing.** A new node needs only: the schema entry, a
  one-way `PM → markdown` serializer rule (so it appears in exports), and its
  editor UI. No inverse parser, no round-trip test matrix.

### What to remove / change at migration time

- Stop seeding the PM fragment from markdown for normal docs once legacy data is
  migrated (`seedPmFragmentFromMarkdown` becomes import-only).
- Keep `loicaMarkdownSerializer` (the `PM → markdown` direction). Extend it for
  every custom node.
- Treat `defaultMarkdownParser` usage as paste/import only, clearly named.

## 4. Export — important current limitation

All **server-side** export paths read the stored `documents.content` column:

- `api.doc-download.$id.ts` — single `.md`
- `api.workspace-export.$id.ts` — bulk workspace `.zip` of `.md`
- `api.admin-user-export.$userId.ts` — bulk per-user `.zip` of `.md`
- `api.doc-docx.$id.ts`, `api.doc-pdf.$id.ts` — render from `content`

But for PM docs, `content` is filled on save by `getDocContent()` →
`extractTextFromXmlFragment()` (`ws/persistence.ts`), which extracts **plain
text** — it strips bold, headings, lists, links, etc. So today, **server-side
`.md` export is already lossy** (plaintext with a `.md` extension). Only the
in-editor "download" button is faithful, because it serializes client-side via
`loicaMarkdownSerializer` (`ProseMirrorEditor.tsx`, `getMarkdown`).

This is a **pre-existing issue, independent of the source-of-truth decision.**

### Fix (aligned with this model)

Make the one-way projection use the real serializer instead of plaintext
extraction. On save, the ws server should populate `content` with
`loicaMarkdownSerializer.serialize(pmDoc)` rather than `extractTextFromXmlFragment`.
Server-side that means converting the `Y.XmlFragment` to a PM `Node` first
(e.g. `y-prosemirror`'s `yXmlFragmentToProsemirrorJSON` → `Node.fromJSON`), then
serializing. After this:

- `content` holds **real markdown**.
- All server export paths (single + bulk `.md`, docx, pdf) become faithful.
- Custom nodes (mentions, etc.) appear correctly in every export, because the
  serializer is the single place that knows how to render them.

## 5. Mentions as the worked example

In-document `@mentions` (via `prosemirror-suggest` + a `mention` node) are the
first feature that motivated this note. Under the target model:

1. Add an inline atom `mention` node to the schema (`editor/schema.ts`),
   attrs `{ id, label }`.
2. Add one serializer rule: `mention → @[label](user:id)` (the markup the email
   layer already parses).
3. Wire `prosemirror-suggest` + a React popup (reuse the user-search endpoint
   and dropdown UI from `MentionTextarea`).
4. Fire the existing `send-mentions` action on select (client-side), reusing the
   backend that already sends `sendMentionNotification`.

No inverse parser. No round-trip. Mentions live in the binary, export through
the one-way serializer. Estimated ~half a day once the projection model is
accepted.

## 6. Open decisions

- **Search index**: keep deriving a text/markdown column for full-text search
  (one-way is fine), or move to a dedicated index? Either works; one-way
  projection covers it.
- **SSR first paint**: serve PM JSON or pre-rendered HTML instead of markdown,
  so the initial render doesn't depend on the markdown projection.
- **`content` column fidelity**: adopt the §4 fix (serializer-based) before or
  during migration, so exports stop being lossy for PM docs.
