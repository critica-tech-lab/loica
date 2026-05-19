/**
 * Loica Extension SDK — client-safe public API.
 *
 * This is the ONLY module an extension should import from when running on
 * the client. Extensions must NOT import from `~/lib/*` or `~/components/*`
 * directly — those are Loica internals and may change without notice.
 *
 * Anything re-exported here is part of the stable extension contract,
 * versioned via `LOICA_EXTENSION_API_VERSION`. Adding to the SDK is
 * non-breaking; removing or renaming is breaking and requires a version
 * bump.
 *
 * For server-only extension code (exporters, route handlers), use
 * `sdk.server.ts` instead.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  LoicaExtension,
  ExtensionTemplate,
  ExtensionExporter,
  ExtensionDocument,
  ExtensionEditorViewProps,
  ExtensionEditorBannerProps,
  ExtensionDocMenuItem,
  ExtensionDocContext,
  AuthProvider,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────
export { LOICA_EXTENSION_API_VERSION } from "./types";


// ── Markdown helpers (client-safe) ────────────────────────────────────
// Pure string/regex utilities for extensions that read frontmatter or
// process markdown content from React components. Sourced from
// `~/lib/markdown` (which has no extension imports) so this re-export
// doesn't create an init-time cycle.
export {
  parseFrontmatter,
  stripFrontmatter,
  getDocumentType,
} from "~/lib/markdown";

// ── UI primitives ────────────────────────────────────────────────────
// Icons extensions can use in their template definitions and row badges.
// Keep this list small — adding icons is cheap, removing them is breaking.
export {
  DocIcon,
  FolderIcon,
  GridIcon,
  PdfIcon,
  SlideIcon,
} from "~/components/icons";
