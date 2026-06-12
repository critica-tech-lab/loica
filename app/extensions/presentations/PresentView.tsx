import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { marked } from "marked";
import { parseFrontmatter } from "~/extensions/sdk";

// Reveal core CSS — loaded via `<link>` injection on mount so it doesn't bleed
// into the editor route's CSS bundle.
import revealCssUrl from "reveal.js/reveal.css?url";

// All built-in themes pre-resolved to their final asset URL. We pick one at
// runtime based on frontmatter; the others stay unloaded.
import loicaUrl from "./slide-theme-loica.css?url";
import beigeUrl from "reveal.js/theme/beige.css?url";
import blackUrl from "reveal.js/theme/black.css?url";
import bloodUrl from "reveal.js/theme/blood.css?url";
import draculaUrl from "reveal.js/theme/dracula.css?url";
import leagueUrl from "reveal.js/theme/league.css?url";
import moonUrl from "reveal.js/theme/moon.css?url";
import nightUrl from "reveal.js/theme/night.css?url";
import serifUrl from "reveal.js/theme/serif.css?url";
import simpleUrl from "reveal.js/theme/simple.css?url";
import skyUrl from "reveal.js/theme/sky.css?url";
import solarizedUrl from "reveal.js/theme/solarized.css?url";
import whiteUrl from "reveal.js/theme/white.css?url";

const THEMES: Record<string, string> = {
  loica: loicaUrl,
  beige: beigeUrl,
  black: blackUrl,
  blood: bloodUrl,
  dracula: draculaUrl,
  league: leagueUrl,
  moon: moonUrl,
  night: nightUrl,
  serif: serifUrl,
  simple: simpleUrl,
  sky: skyUrl,
  solarized: solarizedUrl,
  white: whiteUrl,
};
const DEFAULT_THEME = "loica";
const VALID_TRANSITIONS = new Set([
  "none", "fade", "slide", "convex", "concave", "zoom",
]);

interface PresentViewProps {
  /** Raw markdown content (with or without frontmatter). */
  content: string;
  /** Where to go when the user exits the presentation (Esc, close, back). */
  exitHref: string;
  /** Document title (shown briefly in the speaker view). */
  title: string;
}

// ─── Parsing ──────────────────────────────────────────────

interface ParsedSlide {
  /** Markdown body to render as the slide content. */
  body: string;
  /** Markdown body to render inside <aside class="notes">. */
  notes: string;
  /** Attribute string to splat onto the <section> element. */
  attrs: string;
}

const SLIDE_ATTR_RE = /^\s*<!--\s*\.slide:\s*([^>]*?)\s*-->\s*\r?\n?/;
const NOTE_RE = /\r?\n\s*Note:\s*\r?\n([\s\S]*)$/;

export function parseSlide(md: string): ParsedSlide {
  let body = md;
  let attrs = "";

  const attrMatch = body.match(SLIDE_ATTR_RE);
  if (attrMatch) {
    attrs = attrMatch[1].trim();
    body = body.slice(attrMatch[0].length);
  }

  let notes = "";
  const noteMatch = body.match(NOTE_RE);
  if (noteMatch) {
    notes = noteMatch[1].trim();
    body = body.slice(0, noteMatch.index!).trimEnd();
  }

  return { body, notes, attrs };
}

/**
 * Tokenize markdown line-by-line into horizontal columns of vertical slides.
 *   `---`  on its own line → new horizontal slide
 *   `----` on its own line → vertical sub-slide
 */
export function splitSlides(raw: string): string[][] {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split(/\r?\n/);
  const sections: { kind: "h" | "v"; text: string[] }[] = [{ kind: "h", text: [] }];
  for (const line of lines) {
    const m = line.match(/^(-{3,})\s*$/);
    if (m) {
      sections.push({ kind: m[1].length >= 4 ? "v" : "h", text: [] });
    } else {
      sections[sections.length - 1].text.push(line);
    }
  }
  const columns: string[][] = [];
  for (const s of sections) {
    const txt = s.text.join("\n").trim();
    if (s.kind === "h" || columns.length === 0) columns.push([txt]);
    else columns[columns.length - 1].push(txt);
  }
  if (columns[0]?.length === 1 && columns[0][0] === "") columns.shift();
  return columns;
}

/**
 * Pre-render each slide's markdown to HTML and emit reveal's DOM:
 * `.slides > section`, nested under a parent `<section>` for vertical groups.
 * Sliding renderers like reveal's markdown plugin can race React hydration in
 * SPA shells, so doing this at render time avoids encoding/timing bugs.
 */
function renderSlidesHTML(content: string): string {
  marked.setOptions({ gfm: true, breaks: false });
  const columns = splitSlides(content);

  const renderSlide = (md: string) => {
    const { body, notes, attrs } = parseSlide(md);
    const html = marked.parse(body) as string;
    const notesHtml = notes
      ? `<aside class="notes">${marked.parse(notes) as string}</aside>`
      : "";
    const attrPart = attrs ? ` ${attrs}` : "";
    return `<section${attrPart}>${html}${notesHtml}</section>`;
  };

  return columns
    .map((column) => {
      if (column.length === 1) return renderSlide(column[0]);
      return `<section>${column.map(renderSlide).join("")}</section>`;
    })
    .join("");
}

// ─── Component ────────────────────────────────────────────

export function PresentView({ content, exitHref, title }: PresentViewProps) {
  const navigate = useNavigate();
  const deckRef = useRef<HTMLDivElement>(null);

  // Frontmatter → reveal config. Falls back to old defaults so plain
  // `type: presentation` docs keep their original look.
  const config = useMemo(() => {
    const fm = parseFrontmatter(content) ?? {};
    const themeKey = (fm.theme ?? DEFAULT_THEME).trim().toLowerCase();
    const themeUrl = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
    const transition = VALID_TRANSITIONS.has(fm.transition ?? "")
      ? (fm.transition as string)
      : "slide";
    // Reveal accepts string slideNumber values like "c/t", "c", true, false.
    const rawSn = fm.slideNumber;
    let slideNumber: string | boolean = "c/t";
    if (rawSn === "false") slideNumber = false;
    else if (rawSn === "true") slideNumber = true;
    else if (rawSn) slideNumber = rawSn;
    return { themeUrl, transition, slideNumber };
  }, [content]);

  const slidesHTML = useMemo(() => renderSlidesHTML(content), [content]);

  useEffect(() => {
    const prev = document.title;
    document.title = `Presenting: ${title}`;
    return () => { document.title = prev; };
  }, [title]);

  // Inject reveal core + theme stylesheets on mount; remove on unmount so the
  // editor tab doesn't pick them up. Promise resolves once both <link>s are
  // loaded so we can wait before reveal initializes (otherwise the print-view
  // captures the page background before the theme has applied).
  // We also append a small <style> that pins the typeface to the same
  // IBM Plex Sans the server-rendered PDF uses, so the on-screen deck and
  // the downloaded PDF look like the same document. Theme colors are
  // preserved, only the font family is overridden.
  const stylesReadyRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    const urls = [revealCssUrl, config.themeUrl];
    const links: HTMLLinkElement[] = [];
    stylesReadyRef.current = new Promise<void>((resolve) => {
      let pending = urls.length;
      const done = () => { if (--pending === 0) resolve(); };
      for (const href of urls) {
        const el = document.createElement("link");
        el.rel = "stylesheet";
        el.href = href;
        el.addEventListener("load", done, { once: true });
        el.addEventListener("error", done, { once: true });
        document.head.appendChild(el);
        links.push(el);
      }
    });
    const fontOverride = document.createElement("style");
    fontOverride.dataset.loicaPresentFont = "1";
    fontOverride.textContent = `
      .reveal {
        --r-main-font: 'IBM Plex Sans', 'Geist', system-ui, sans-serif;
        --r-heading-font: 'IBM Plex Sans', 'Geist', system-ui, sans-serif;
        --r-code-font: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
      }
    `;
    document.head.appendChild(fontOverride);
    return () => {
      for (const el of links) el.remove();
      fontOverride.remove();
    };
  }, [config.themeUrl]);

  // In a popup (opened via window.open), Exit closes the window. Otherwise,
  // navigate back to the editor.
  const exit = () => {
    if (typeof window !== "undefined" && window.opener) {
      window.close();
      return;
    }
    navigate(exitHref);
  };

  useEffect(() => {
    if (!deckRef.current) return;
    let revealInstance: { destroy?: () => void } | null = null;
    let cancelled = false;

    (async () => {
      // Wait until our injected reveal + theme stylesheets have actually
      // loaded — otherwise reveal's print view captures the wrong (white)
      // background and the theme is missing in the PDF.
      if (stylesReadyRef.current) await stylesReadyRef.current;
      if (cancelled || !deckRef.current) return;

      // Reveal.js touches `window` at module evaluation, so import dynamically.
      // Notes plugin enables the speaker-view window (press S during a deck).
      const [{ default: Reveal }, { default: RevealNotes }] = await Promise.all([
        import("reveal.js"),
        import("reveal.js/plugin/notes"),
      ]);
      if (cancelled || !deckRef.current) return;

      const deck = new Reveal(deckRef.current, {
        plugins: [RevealNotes],
        hash: true,
        slideNumber: config.slideNumber as boolean | "c" | "c/t" | "h.v" | "h/v",
        transition: config.transition as "none" | "fade" | "slide" | "convex" | "concave" | "zoom",
        controls: true,
        progress: true,
        center: true,
        embedded: false,
        pdfSeparateFragments: false,
        keyboard: { 27: () => exit() },
      });

      await deck.initialize();
      revealInstance = deck as unknown as { destroy?: () => void };
    })();

    return () => {
      cancelled = true;
      try { revealInstance?.destroy?.(); } catch { /* ignore */ }
    };
  }, [slidesHTML, exitHref, navigate, config.transition, config.slideNumber]);

  return (
    <>
      <div className="reveal" ref={deckRef} style={{ position: "fixed", inset: 0, zIndex: 200 }}>
        <div className="slides" dangerouslySetInnerHTML={{ __html: slidesHTML }} />
      </div>
      <button
        type="button"
        onClick={exit}
        title="Exit presentation (Esc)"
        aria-label="Exit presentation"
        style={{
          position: "fixed",
          top: "1rem",
          left: "1rem",
          zIndex: 300,
          padding: "0.4rem 0.75rem",
          fontSize: "0.75rem",
          fontFamily: "var(--font-ui, system-ui)",
          color: "rgba(255,255,255,0.7)",
          background: "rgba(30,30,30,0.6)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "999px",
          cursor: "pointer",
          transition: "background 140ms ease-out, color 140ms ease-out",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(30,30,30,0.9)";
          e.currentTarget.style.color = "rgba(255,255,255,1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(30,30,30,0.6)";
          e.currentTarget.style.color = "rgba(255,255,255,0.7)";
        }}
      >
        ← Exit
      </button>
    </>
  );
}
