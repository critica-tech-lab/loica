# Presentations

Built-in doc type for slide decks. A document with `type: presentation` in its
frontmatter gets a slide editor, a **Present** mode (`/w/doc/:id/present`,
rendered with reveal.js and the Loica slide theme) and a slide-shaped PDF
export.

This is a core feature that uses the extension interface, not an optional
extension. Its editor imports host internals (`ProseMirrorEditor`,
`DocumentContext`), so it is compiled into Loica, flagged `core: true`, always
on, and not listed in the admin extension toggles. See
[`../README.md`](../README.md) for why that makes it core.

| File | Role |
| --- | --- |
| `index.ts` / `index.server.ts` | Extension definitions, registered by name in the core registries |
| `template.ts` | Starter deck for the New menu |
| `PresentationEditor.tsx` / `PresentationEditorImpl.tsx` | Slide editor (lazy-loaded) |
| `EditorBanner.tsx` | The "Present" pill above the editor |
| `present.tsx` / `PresentView.tsx` | Present mode route and view |
| `routes.ts` | Registers the present route |
| `pdf.server.ts` | Slide PDF exporter |
| `slide-theme-loica.css` | Slide theme (`slide-theme-loica-preview.html` previews it) |
