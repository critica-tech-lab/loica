# CodeMirror → ProseMirror Data Migration Plan

Status: **planning**. Branch: `prosemirror-migration`.
Goal: convert existing CodeMirror-authored documents so they render in the
ProseMirror editor, then make PM the default and remove CodeMirror.

This document holds everything needed to **write the migration script**. It is
not the script.

---

## 1. Why migration is needed

The two editors store document body in **different Yjs types inside the same
per-doc `Y.Doc`**:

| Editor | Yjs field | Type | Holds |
|--------|-----------|------|-------|
| CodeMirror (old) | `getText("content")` | `Y.Text` | markdown string |
| ProseMirror (new) | `getXmlFragment("prosemirror")` | `Y.XmlFragment` | structured PM nodes |

When PM opens an old doc it reads `getXmlFragment("prosemirror")`, which is
**empty** for CM docs → the document renders **blank**. (`Y.Text("content")` is
ignored by PM.)

Source refs:
- CM field: `app/components/Editor.tsx:1082` — `ydoc.getText("content")`
- PM field: `app/components/ProseMirrorEditor.tsx:176`, `app/components/DocEditorView.tsx:451` — `ydoc.getXmlFragment("prosemirror")`
- Editor selection flag: `app/components/DocEditorView.tsx:26` — `USE_PM = import.meta.env.VITE_PM_EDITOR === "1"` (build-time)

---

## 2. Where document data lives (SQLite — `app.db`)

Table `documents`:
- `id TEXT PK`
- `content TEXT` — **markdown mirror** of the body, refreshed every ~2s by the
  ws-server from `getDocContent()`. This is the cleanest conversion source.
- `yjs_state BLOB` — full `Y.encodeStateAsUpdate(doc)` snapshot of the per-doc Y.Doc.
- plus `title`, `workspace_id`, `visibility`, `folder_id`, `deleted_at`, etc.

Table `document_updates`:
- `(id, document_id, user_id, user_name, yjs_update BLOB, created_at)`
- Incremental Yjs updates, used for **history/version reconstruction**.
- For CM docs these updates target `Y.Text("content")` — **incompatible** with the
  PM fragment.

Table `document_versions`:
- `(id, document_id, title, content, yjs_state BLOB, auto, created_at, ...)`
- Snapshots. CM versions hold `Y.Text` state — PM history reconstruction can't read them.

---

## 3. How the ws-server loads / saves (the contract the script must respect)

File: `ws/persistence.ts`

- `loadDocumentState(db, stmts, doc, docId)` (`:61`):
  - Applies `row.yjs_state` to the Y.Doc.
  - **PM detection:** `isPmDoc = doc.getXmlFragment("prosemirror").length > 0` (`:78`).
  - For **non-PM** docs only, seeds `Y.Text("content")` from `row.content` if empty.
  - → After we write a PM `yjs_state`, the doc is auto-detected as PM. Good.
- `getDocContent(doc)` (`:387`):
  - Spreadsheet docs (Y.Map `ss-meta` has `cols`) → serialized spreadsheet JSON.
  - Else **PM fragment priority**: `getXmlFragment("prosemirror").length > 0` →
    `extractTextFromXmlFragment` (`:423`).
  - Else `Y.Text("content").toString()`.
- `scheduleSave` (`ws-server.ts:~205`) overwrites `documents.yjs_state` +
  `documents.content` every 2s from the live in-memory room.

**Critical:** the ws-server keeps live rooms in memory. If it is running during
migration it will **overwrite our new `yjs_state` with the old CM room state**.
→ **Stop `loica-ws` before migrating. Restart after.**

---

## 4. The conversion (markdown → PM → Yjs)

### Available building blocks
- `y-prosemirror` exports (verified in `node_modules/y-prosemirror/src/lib.js`):
  - `prosemirrorToYDoc(pmDoc, "prosemirror")` → `Y.Doc` with the XmlFragment populated.
  - `prosemirrorJSONToYDoc(schema, json, "prosemirror")` → same, from JSON.
  - `yDocToProsemirror(schema, yDoc)` → PM doc (for verification).
- Loica PM schema: `app/components/editor/schema.ts` (export `schema`) — basic nodes
  + lists + GFM tables + image(width/height) + marks (underline, strikethrough,
  highlight, tracked_insert/delete), all carrying `dataTracked`.
- Markdown **serializer** (PM→md): `app/components/editor/pm-markdown.ts`
  (`loicaMarkdownSerializer`).

### THE GAP — no loica markdown *parser* exists
There is **no markdown→PM parser bound to the loica schema**. Only:
- `defaultMarkdownParser` from `prosemirror-markdown` — bound to the **basic**
  schema: handles headings, paragraphs, lists, blockquote, code, **images
  `![](...)`**, bold/italic/code. Does **NOT** handle GFM tables, underline,
  highlight, strikethrough.

**Decision required (see §7):** build a full loica markdown parser
(`markdown-it` + GFM tables/strikethrough + token→loica-schema mapping), or accept
that tables/underline/highlight in old docs degrade (tables → lost or plain text).

### Verified round-trip
A headless test (`prosemirrorToYDoc` → `encodeStateAsUpdate` → `applyUpdate` →
`yDocToProsemirror`) preserved headings, marks, lists, and **image src + width/height**.
The Yjs encode/decode layer is proven; only the markdown→PM parse step is the risk.

### Per-doc conversion steps
1. `md = Y.Text("content").toString()` (decode `yjs_state`) **||** `documents.content`
   — prefer the live Yjs text, fall back to the column.
2. `pmDoc = loicaMarkdownParser.parse(md)` (parser to be built/chosen, §7).
3. `yNew = prosemirrorToYDoc(pmDoc, "prosemirror")`.
4. `blob = Y.encodeStateAsUpdate(yNew)`.
5. `UPDATE documents SET yjs_state = blob, content = getDocContent(yNew) WHERE id = ?`.

---

## 5. What must be skipped or specially handled

- **Already-PM docs** — skip. Detect: `applyUpdate(tmp, yjs_state); tmp.getXmlFragment("prosemirror").length > 0`. Idempotency guard; lets the script re-run safely.
- **Spreadsheet docs** — skip. Detect: content has `---\ntype: spreadsheet\n---`
  frontmatter / Y.Map `ss-meta` has `cols` (`isSpreadsheetContent`, `getDocContent:388`).
- **Doc-type extension docs** (custom `ExtensionEditor`, `DocEditorView.tsx:~265`) —
  identify by doc-type and skip; they don't use either base editor.
- **Empty docs** (`content === ""`) — produce an empty PM doc; harmless, can skip.
- **Deleted docs** (`deleted_at IS NOT NULL`) — optional; migrate or skip per policy.

---

## 6. Side effects to decide on

- **`document_updates` (history):** old rows target `Y.Text`. Options:
  (a) **Purge** per migrated doc (`DELETE WHERE document_id = ?`) — clean, loses
  pre-migration per-edit history;
  (b) **Keep** as archival — history/diff reconstruction for the old range will
  fail gracefully (`document.server.ts:~595` wraps in try/catch → "shows nothing").
  Recommend (a) for migrated docs to avoid confusing half-broken history.
- **`document_versions`:** CM snapshots' `yjs_state` is unreadable by PM history.
  `content` (text) still works. Leave as-is; note that "restore version" for a
  pre-migration version would restore markdown text (re-converted) not a PM snapshot.
- **Comments:** PM comments anchor via relative positions into the XmlFragment
  (`app/components/editor/pm-comments.ts`); CM comments anchor into `Y.Text`. After
  migration anchors are **invalid** → comments may detach or mis-place. The repo
  already validates anchor text (commit `97429a5`). Decide: re-anchor by text search,
  or accept detachment with the comment body preserved. **Highest-risk item.**

---

## 7. Open questions (answer before writing the script)

1. **Markdown parser:** build a full loica parser (markdown-it + tables/strikethrough),
   or ship with `defaultMarkdownParser` and accept table/underline/highlight loss?
2. **Comments:** required to survive (re-anchor) or acceptable to detach?
3. **History:** purge or keep `document_updates` for migrated docs?
4. **Scope:** all docs, or only non-deleted in active workspaces? Migrate deleted docs?
5. **Default flip:** after migration verified, bake `VITE_PM_EDITOR=1` into the build
   (`.env` / build script) and remove the CodeMirror `Editor.tsx` path?

---

## 8. Execution checklist (for the eventual script)

- [ ] **Backup `app.db` first** (`cp app.db app.db.premigration`).
- [ ] **Stop `loica-ws`** (pm2) so no live room overwrites migrated state.
- [ ] `--dry-run` mode: report per-doc (id, title, skip-reason, md length, new
      fragment length) without writing.
- [ ] Per-doc `try/catch`: log failures, continue the batch (never abort on one doc).
- [ ] Idempotent: skip docs already carrying a PM fragment.
- [ ] Run as a standalone `bun` script importing `app/components/editor/schema.ts`,
      `y-prosemirror`, `yjs`, `better-sqlite3`. **Run bun with sandbox disabled**
      (sandbox denies bun temp/cache writes).
- [ ] After write: re-open a sample of migrated docs in PM and eyeball.
- [ ] **Restart `loica-ws`.**

---

## 9. Status of the PM editor itself (migration target readiness)

- Storage/persistence round-trip: **verified headless** (§4).
- Image paste / drop / resize: **implemented** (`ProseMirrorEditor.tsx`, this branch).
- Feature surface wired: marks, headings, lists, blockquote, code, tables, images,
  links, comments, track-changes, cursors, undo, export (docx/md/pdf).
- **Not yet verified at runtime:** typing, paste gesture, resize drag, table editing,
  comment create/resolve, track-changes accept/reject, multi-user sync, export output.
  → needs a manual browser pass on a **new** doc (no automation/browser MCP available).
