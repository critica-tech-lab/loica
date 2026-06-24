import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { marked } from "marked";
import { stripFrontmatter } from "~/extensions/sdk.server";

const fontsDir = resolve(process.cwd(), "assets/fonts");
// Scratch dir for PDF rendering. Use the system temp dir (honors TMPDIR) so it
// works on a read-only-rootfs deployment where $HOME may not be writable.
const loicaTmpDir = join(tmpdir(), "loica-tmp");

// Reveal-theme palette mirrors. Keys match reveal.js theme filenames so the
// PDF reads with the same colors as the on-screen deck. Fonts are mapped to
// what Loica actually ships in `assets/fonts/` (IBM Plex Sans / Mono, Geist),
// so weasyprint can render them — referencing reveal's actual fonts (Source
// Sans 3, Lato, Open Sans, etc.) silently falls back to a generic sans and
// makes every theme look identical.
const PRES_BODY_FONT = "'IBM Plex Sans', 'Geist', sans-serif";
const PRES_HEADING_FONT = "'IBM Plex Sans', 'Geist', sans-serif";
const PRES_SERIF_FONT = "'Palatino', 'IBM Plex Sans', serif";

const REVEAL_PALETTES: Record<
  string,
  { bg: string; fg: string; heading: string; link: string; font: string; headingFont: string; uppercaseHeadings?: boolean }
> = {
  black:     { bg: "#191919", fg: "#fff",    heading: "#fff",    link: "#42affa", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  white:     { bg: "#fff",    fg: "#222",    heading: "#222",    link: "#2a76dd", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  league:    { bg: "#2b2b2b", fg: "#eee",    heading: "#eee",    link: "#13DAEC", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  beige:     { bg: "#f7f3de", fg: "#333",    heading: "#333",    link: "#8b743d", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  sky:       { bg: "#f7fbfc", fg: "#333",    heading: "#333",    link: "#3b759e", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  night:     { bg: "#111",    fg: "#eee",    heading: "#eee",    link: "#e7ad52", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT },
  serif:     { bg: "#f0f1eb", fg: "#000",    heading: "#383D3D", link: "#51483D", font: PRES_SERIF_FONT, headingFont: PRES_SERIF_FONT },
  simple:    { bg: "#fff",    fg: "#000",    heading: "#000",    link: "#00008B", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  solarized: { bg: "#fdf6e3", fg: "#657b83", heading: "#586e75", link: "#268bd2", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  moon:      { bg: "#002b36", fg: "#93a1a1", heading: "#eee8d5", link: "#268bd2", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
  dracula:   { bg: "#282a36", fg: "#f8f8f2", heading: "#f8f8f2", link: "#bd93f9", font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT },
  blood:     { bg: "#222",    fg: "#eee",    heading: "#eee",    link: "#a23",    font: PRES_BODY_FONT,  headingFont: PRES_HEADING_FONT, uppercaseHeadings: true },
};

interface PresSlide {
  attrs: Record<string, string>;
  bodyMd: string;
}

/** Walk the doc into ordered top-level slides. We flatten vertical sub-slides
 *  (`----`) to siblings — beamer/PDF doesn't model the down-arrow stack. */
function splitPresentationSlides(body: string): PresSlide[] {
  const slides: PresSlide[] = [];
  let buf: string[] = [];
  const flush = () => {
    const raw = buf.join("\n").trim();
    buf = [];
    if (!raw) return;
    // Strip trailing `Note:` blocks — they belong to the speaker view, not PDF.
    const noteIdx = raw.search(/^\s*Note:\s*$/m);
    let body = noteIdx === -1 ? raw : raw.slice(0, noteIdx).trimEnd();
    // Pull leading <!-- .slide: ... --> attrs.
    const attrs: Record<string, string> = {};
    const attrMatch = body.match(/^\s*<!--\s*\.slide:\s*([^>]*?)\s*-->\s*\r?\n?/);
    if (attrMatch) {
      const attrRe = /(\w[\w-]*)="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrMatch[1])) !== null) attrs[m[1]] = m[2];
      body = body.slice(attrMatch[0].length);
    }
    slides.push({ attrs, bodyMd: body });
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^-{3,}\s*$/.test(line)) flush();
    else buf.push(line);
  }
  flush();
  return slides;
}

/** Escape a string for inline CSS / HTML attribute use. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render a presentation doc to a PDF that mirrors the on-screen reveal.js
 * theme. We render each slide's markdown to HTML, wrap it on a fixed-size page
 * styled with the matching reveal palette (background, foreground, link
 * colors, font family), then run weasyprint — the same engine the spreadsheet
 * PDF route already uses, so no new dependency. Browser is not involved at
 * all, so this is reliable across Firefox/Safari/Chrome.
 */
export function generatePresentationPdf(
  rawContent: string,
  frontmatter: Record<string, string>,
  title: string,
): Response {
  mkdirSync(loicaTmpDir, { recursive: true });

  const themeKey = (frontmatter.theme ?? "black").trim().toLowerCase();
  const palette = REVEAL_PALETTES[themeKey] ?? REVEAL_PALETTES.black;

  const slides = splitPresentationSlides(stripFrontmatter(rawContent));

  marked.setOptions({ gfm: true, breaks: false });

  const slideSections = slides.map((slide) => {
    const html = marked.parse(slide.bodyMd) as string;
    // Per-slide background overrides via <!-- .slide: data-background="..." -->.
    const bg = slide.attrs["data-background"] ?? slide.attrs["data-background-color"];
    const bgImage = slide.attrs["data-background-image"];
    const styleParts: string[] = [];
    if (bg) styleParts.push(`background:${bg}`);
    if (bgImage) styleParts.push(`background-image:url(${esc(bgImage)})`, "background-size:cover", "background-position:center");
    const styleAttr = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
    const classAttr = slide.attrs.class ? ` class="slide ${esc(slide.attrs.class)}"` : ` class="slide"`;
    return `<section${classAttr}${styleAttr}>${html}</section>`;
  }).join("");

  // 1280×720 = 16:9, matches reveal's default slide size.
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: 1280px 720px; margin: 0; }
  html, body { margin: 0; padding: 0; background: ${palette.bg}; }
  body { font-family: ${palette.font}; color: ${palette.fg}; }
  section.slide {
    width: 1280px; height: 720px;
    box-sizing: border-box;
    padding: 60px 80px;
    page-break-after: always;
    background: ${palette.bg};
    color: ${palette.fg};
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
  }
  section.slide:last-child { page-break-after: auto; }
  h1, h2, h3, h4, h5, h6 {
    color: ${palette.heading};
    font-family: ${palette.headingFont};
    font-weight: 600;
    margin: 0 0 0.5em;
    line-height: 1.2;
    ${palette.uppercaseHeadings ? "text-transform: uppercase; letter-spacing: 0.02em;" : ""}
  }
  h1 { font-size: 2.4em; }
  h2 { font-size: 1.8em; }
  h3 { font-size: 1.4em; }
  p, li { font-size: 1.1em; line-height: 1.4; margin: 0.4em 0; }
  ul, ol { padding-left: 1.4em; }
  a { color: ${palette.link}; text-decoration: none; }
  code { font-family: 'IBM Plex Mono', monospace; font-size: 0.85em;
         background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; }
  pre { background: rgba(0,0,0,0.25); padding: 14px 18px; border-radius: 6px;
        font-size: 0.78em; line-height: 1.4; overflow: hidden; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 4px solid ${palette.link}; padding-left: 1em;
               margin: 0.5em 0; font-style: italic; opacity: 0.85; }
  img { max-width: 100%; max-height: 480px; object-fit: contain; display: block; margin: auto; }
  table { border-collapse: collapse; margin: 0.5em auto; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: 6px 12px; }
  hr { display: none; }
</style></head>
<body>${slideSections}</body></html>`;

  const id = nanoid(8);
  const htmlPath = join(loicaTmpDir, `loica-pres-${id}.html`);
  const pdfPath = join(loicaTmpDir, `loica-pres-${id}.pdf`);

  try {
    writeFileSync(htmlPath, html, "utf-8");
    execFileSync("weasyprint", [htmlPath, pdfPath], {
      timeout: 60_000,
      stdio: "pipe",
      env: { ...process.env, FONTCONFIG_PATH: fontsDir },
    });

    const pdf = readFileSync(pdfPath);
    const filename = title.replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".pdf";

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("Presentation PDF failed:", err.stderr?.toString() || err.message);
    throw new Response("PDF generation failed", { status: 500 });
  } finally {
    try { unlinkSync(htmlPath); } catch {}
    try { unlinkSync(pdfPath); } catch {}
  }
}
