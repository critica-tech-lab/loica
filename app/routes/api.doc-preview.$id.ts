import type { Route } from "./+types/api.doc-preview.$id";
import { marked } from "marked";
import createFootnotes from "marked-footnote";
import DOMPurify from "isomorphic-dompurify";
import { highlightExtension } from "~/lib/marked-highlight";

marked.use({ extensions: highlightExtension });
marked.use(createFootnotes());
import { authorizeDocRead } from "~/lib/doc-access.server";
import { parseFrontmatter, renumberFootnotesForDisplay } from "~/lib/templates";
import { getServerExtensionForDocType } from "~/extensions/index.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const doc = authorizeDocRead(request, params.id);

  const title = doc.title || "Untitled";
  const frontmatter = parseFrontmatter(doc.content || "");

  // Extension-provided preview takes precedence over the core markdown render.
  const ext = getServerExtensionForDocType(frontmatter?.type);
  if (ext?.previewHtml) {
    const res = await ext.previewHtml(doc, frontmatter);
    if (res) return res;
  }

  const content = renumberFootnotesForDisplay(doc.content || "");

  const body = DOMPurify.sanitize(await marked(content));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — loica</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,700;1,400;1,700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap');

  *, *::before, *::after { box-sizing: border-box; }

  /* iA Writer "Modern (Sans)" template — print adaptation */

  body {
    font-family: 'IBM Plex Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.55;
    color: #1a1a1a;
    background: #fff;
    max-width: 365pt;
    margin: 0 auto;
    padding: 50pt 50pt 60pt;
    -webkit-font-smoothing: antialiased;
    word-wrap: break-word;
    text-rendering: optimizeLegibility;
    font-kerning: normal;
  }

  /* Headings — iA Writer Sans scale */
  h1, h2, h3, h4, h5, h6, strong, th { font-weight: 700; }

  h1 {
    font-size: 1.2778em; /* 23/18 */
    line-height: 1.304;  /* 30/23 */
    margin: 2.609em 0;   /* 60/23 */
  }
  h2 {
    font-size: 1.1667em; /* 21/18 */
    line-height: 1.4286; /* 30/21 */
    margin: 2.857em 0 1.667em; /* 60/21 top, 30/18 bottom */
  }
  h3, h4, h5, h6 {
    font-size: 1em;
    line-height: 1.667; /* 30/18 */
    margin: 1.667em 0 0;
  }
  h5 { font-weight: 500; }

  /* Run-in h6 */
  h6 { float: left; margin: 0 0.5em 0 0; }
  h6 ~ * { clear: both; }
  h6 + p { clear: none; }

  /* Tight coupling: no space between H3-H5 and following block */
  h3 + p, h3 + ul, h3 + ol, h3 + pre, h3 + blockquote, h3 + table,
  h4 + p, h4 + ul, h4 + ol, h4 + pre, h4 + blockquote, h4 + table,
  h5 + p, h5 + ul, h5 + ol, h5 + pre, h5 + blockquote, h5 + table {
    margin-top: 0;
  }

  body > *:first-child { margin-top: 0; }

  /* Body text */
  p, ol, ul, dl, figure, blockquote, pre, table {
    margin: 1.667em auto 0; /* 30/18 */
  }
  p { orphans: 3; widows: 3; }
  a { color: #1a1a1a; }

  /* Blockquotes — indented, no border */
  blockquote {
    margin-left: -0.889em;
    margin-right: -0.889em;
    padding-left: 2.222em;
    padding-right: 2.222em;
    border: none;
  }
  blockquote p:last-child { margin-bottom: 0; }

  /* Code */
  code, samp, kbd {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.94em;
    background: rgba(36, 36, 36, 0.055);
    padding: 0.083em 0.167em;
    border-radius: 2px;
    white-space: pre-wrap;
  }
  pre {
    background: rgba(36, 36, 36, 0.055);
    padding: 1em;
    border-radius: 2px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }

  /* Lists */
  ul, ol {
    padding-left: 2.222em; /* 40/18 */
  }
  li > ul, li > ol { margin-top: 0; margin-bottom: 0; }

  /* Horizontal rule */
  hr {
    clear: both;
    border: none;
    border-bottom: 1px solid #1a1a1a;
    margin: 1.667em 0;
  }

  /* Images */
  img {
    max-width: 100%;
    height: auto;
    vertical-align: top;
  }

  /* Tables — iA style: top+bottom border, small font */
  table {
    table-layout: fixed;
    width: 100%;
    border-top: 1px solid #1a1a1a;
    border-bottom: 1px solid #1a1a1a;
    border-collapse: collapse;
    font-size: 0.8333em; /* 15/18 */
    line-height: 1.6; /* 24/15 */
    font-variant-numeric: tabular-nums;
  }
  tbody { border-top: 1px solid #1a1a1a; }
  th, td {
    padding: 0.5em;
    vertical-align: top;
    text-align: left;
    border: none;
  }

  /* Highlight */
  mark {
    background: #ff0;
    color: #000;
    padding: 0.1em 0.15em;
    border-radius: 2px;
  }

  /* Footnotes */
  .footnotes {
    margin-top: 2em;
    padding-top: 0.75em;
    border-top: 1px solid #1a1a1a;
    font-size: 0.85em;
  }
  .footnotes ol { padding-left: 1.5em; margin: 0; }
  .footnotes li { margin-bottom: 0.25em; }
  .footnotes li p { margin: 0; display: inline; }
  [data-footnote-ref] { font-size: 0.75em; vertical-align: super; line-height: 1; text-decoration: none; }
  [data-footnote-backref] { font-size: 0.75em; text-decoration: none; color: #666; margin-left: 0.25em; }

  /* Print */
  @media print {
    *, *::before, *::after { color: #000 !important; box-shadow: none !important; text-shadow: none !important; }
    body { padding: 12pt 50pt; max-width: 365pt; }
    @page { margin: 2cm; }
    h1, h2, h3, h4, h5, img, figure { page-break-inside: avoid; page-break-after: avoid; }
    p { widows: 3; orphans: 3; }
    hr { border-bottom-color: #000 !important; }
    a { color: inherit !important; text-decoration: none; }
  }
</style>
</head>
<body>
${body}
<script>window.print();window.close()</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
