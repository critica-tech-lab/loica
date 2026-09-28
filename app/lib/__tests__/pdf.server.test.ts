import { test, expect } from "bun:test";
import { renderPdf } from "~/lib/export/pdf.server";

// Guards the plugin contract: a house-style plugin (critica-pdf) passes a
// PdfStyle as the 4th arg. It used to be silently ignored.
test("renderPdf applies a PdfStyle", async () => {
  const md = "Meeting on 2026-03-02.\n";
  const plain = (await renderPdf(md, "t")).toString("latin1");
  const styled = (await renderPdf(md, "t", false, { dateInMono: true, pageMargins: [115, 50, 115, 60] })).toString("latin1");
  expect(plain).not.toContain("IBMPlexMono"); // no mono run without the style
  expect(styled).toContain("IBMPlexMono"); // date rendered in mono
});
