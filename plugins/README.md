# Drop-in plugins

The bare-metal Loica ships **no** plugins. An opinionated install adds
capabilities by dropping a self-contained package into this directory:

```
plugins/
  <plugin-name>/
    index.server.js   # ESM, default-exports a LoicaExtension
    assets/...        # any files the plugin needs
```

At startup the server scans `plugins/*/index.server.{js,mjs,ts}`, imports each,
and registers the exported extension. Discovered plugins then appear in
**Admin → Extensions** to toggle on/off. A plugin with `defaultEnabled: false`
stays off until an admin enables it, so a fresh install behaves like bare metal.

Entry files should be ESM `.js`/`.mjs` so production `node` can import them with
no build step (`.ts` resolves only under `bun`, i.e. dev). Plugins locate their
own assets via `import.meta.url`.

Everything here except this README is git-ignored — plugins are deployment
artifacts, not part of the bare repo.

## Extension points a plugin can declare

See `app/extensions/types.ts` (`LoicaExtension`). Notably:

- `pdfStyle` — install-wide PDF house styling (preamble, Lua filters, fonts,
  extra pandoc args) layered onto the core pandoc/tectonic pipeline.
- `exporters.pdf` / `exporters.docx` — replace the export pipeline for one
  doc `type`.
- `docType` + `template` / `EditorView` — custom doc types.
- `authProvider` — sign-in options.
