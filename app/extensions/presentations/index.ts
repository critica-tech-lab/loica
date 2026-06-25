import type { LoicaExtension } from "~/extensions/sdk";
import { LOICA_EXTENSION_API_VERSION, SlideIcon } from "~/extensions/sdk";
import { generatePresentationContent } from "./template";
import { PresentBanner, openPresentWindow, presentHref } from "./EditorBanner";
import { PresentationEditor } from "./PresentationEditor";

/**
 * Presentations extension — markdown docs with `type: presentation`
 * frontmatter that render as reveal.js slide decks. The "Present" mode
 * (`/w/doc/:id/present`) lives in `./present.tsx` and the slide-shaped
 * PDF exporter in `./pdf.server.ts`.
 */
export const presentationsExtension: LoicaExtension = {
  id: "presentations",
  apiVersion: LOICA_EXTENSION_API_VERSION,
  // Core feature: the slide editor imports host internals (ProseMirrorEditor,
  // DocumentContext, …) so it's compiled into Loica, not a runtime drop-in.
  // Always on; hidden from the admin extension toggle list.
  core: true,
  description: "Slide decks rendered with reveal.js. Adds the Present mode and slide-PDF export.",
  docType: "presentation",
  template: {
    id: "presentation",
    label: "Presentation",
    icon: "🎞",
    Icon: SlideIcon,
    generateContent: generatePresentationContent,
  },
  rowIcon: SlideIcon,
  EditorView: PresentationEditor,
  EditorBanner: PresentBanner,
  getDocMenuItems: ({ document, isShared }) => [
    {
      label: "Present",
      icon: SlideIcon,
      onClick: () => openPresentWindow(presentHref({ document, isShared })),
    },
  ],
};
