import type { LoicaExtension } from "~/extensions/sdk.server";
import { presentationsExtension as base } from "./index";
import { generatePresentationPdf } from "./pdf.server";

/**
 * Server-side build of the Presentations extension. Adds the slide-shaped
 * PDF exporter (HTML + pandoc, mirrors the on-screen reveal.js theme).
 */
export const presentationsServerExtension: LoicaExtension = {
  ...base,
  exporters: {
    pdf: (doc, frontmatter) =>
      generatePresentationPdf(doc.content || "", frontmatter ?? {}, doc.title || "Untitled"),
  },
};
