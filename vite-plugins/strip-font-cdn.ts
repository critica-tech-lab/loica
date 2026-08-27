import type { Plugin } from "vite";

// reveal.js ships 12 slide themes and 8 of them open with an @import from the
// Google Fonts CDN (beige, blood, night, moon, solarized, sky, league, simple).
// Loading one hands the viewer's IP to a third party and leaves the slide deck
// waiting on a network Loica cannot assume exists.
//
// Dropping those themes would cost two thirds of the picker and vendoring them
// means re-patching eight upstream files on every reveal.js bump, so instead
// the import is stripped from the emitted CSS. The affected themes fall back to
// the local stacks they already declare — the same way they render offline.
// Both spellings occur: reveal.js writes `@import "https://…";` while hand-
// written CSS tends to use `@import url('https://…');`. Match from @import to
// the terminating semicolon, but only when the URL is the font CDN.
const FONT_CDN_IMPORT = /@import\s+(?:url\(\s*)?['"]?https:\/\/fonts\.googleapis\.com[^;]*;/g;

const CDN_HOST = "fonts.googleapis.com";

export function stripFontCdn(): Plugin {
  return {
    name: "loica:strip-font-cdn",

    // generateBundle rather than transform: the themes are pulled in with
    // `?url`, so they reach the output as emitted assets and never pass
    // through the CSS transform pipeline.
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) {
          continue;
        }

        const css =
          typeof file.source === "string"
            ? file.source
            : Buffer.from(file.source).toString("utf-8");

        if (!css.includes(CDN_HOST)) {
          continue;
        }

        file.source = css.replace(FONT_CDN_IMPORT, "");
      }
    },
  };
}
