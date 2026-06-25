import type { LoicaExtension } from "~/extensions/sdk.server";
import { presentationsExtension as base } from "./index";
import { generatePresentationPdf } from "./pdf.server";

/**
 * Server-side build of the Presentations extension. Adds the slide-shaped
 * PDF exporter (HTML → WeasyPrint, mirrors the on-screen reveal.js theme).
 *
 * NOTE: slide PDF export needs **WeasyPrint** on the server — an optional,
 * presentations-only system dependency that the core install no longer ships
 * (core doc export is pure-JS). Without it, slide export returns a 503 with an
 * install hint; everything else in the app works. Install with
 * `pip install weasyprint` (or your distro's package) if you use this feature.
 */
export const presentationsServerExtension: LoicaExtension = {
  ...base,
  exporters: {
    pdf: (doc, frontmatter) =>
      generatePresentationPdf(doc.content || "", frontmatter ?? {}, doc.title || "Untitled"),
  },
};
