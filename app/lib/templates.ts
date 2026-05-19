// ─── Document Templates ─────────────────────────────────
// Client-safe module — no .server.ts suffix.
//
// Pure markdown utilities (parseFrontmatter, stripFrontmatter, etc) live
// in `~/lib/markdown` so the extension SDK can re-export them without
// creating a circular import. We re-export them here for back-compat
// with consumers that already import from `~/lib/templates`.

export {
  renumberFootnotesForDisplay,
  parseFrontmatter,
  getDocumentType,
  stripFrontmatter,
  fixListIndentation,
} from "./markdown";

// ─── Template registry ──────────────────────────────────
//
// The `TEMPLATES` array is consumed by the "Create new" UI and the document
// creation action. With every doc-type feature now living as an extension,
// this list is fully derived from the extension registry.

import type { ComponentType } from "react";
import { extensionTemplates } from "~/extensions";

export interface Template {
  id: string;
  label: string;
  icon: string;
  Icon?: ComponentType<{ className?: string }>;
  generateContent: () => string;
}

export const TEMPLATES: Template[] = [...extensionTemplates];
