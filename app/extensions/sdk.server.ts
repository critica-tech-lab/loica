/**
 * Loica Extension SDK — server-only public API.
 *
 * Counterpart to `sdk.ts`. Use this from `.server.ts` files inside an
 * extension folder (PDF exporters, route handlers, etc).
 *
 * Extensions must NOT import from `~/lib/*` directly — those are Loica
 * internals. Anything re-exported here is part of the stable extension
 * contract.
 *
 * Notably absent: direct DB access (`db.server.ts`). Extensions should not
 * read or write the database arbitrarily; if an extension needs persistent
 * state, that's a signal to expand this SDK with a documented helper.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  LoicaExtension,
  ExtensionTemplate,
  ExtensionExporter,
  ExtensionDocument,
  AuthProvider,
} from "./types";

export { LOICA_EXTENSION_API_VERSION } from "./types";

// ── Markdown helpers ─────────────────────────────────────────────────
// Stable utilities for extensions that render or transform document
// content (typically inside an exporter). Sourced from `~/lib/markdown`
// to avoid the SDK→extensions cycle.
export {
  stripFrontmatter,
  fixListIndentation,
  renumberFootnotesForDisplay,
  parseFrontmatter,
  getDocumentType,
} from "~/lib/markdown";

// ── Auth helpers ──────────────────────────────────────────────────────
// For extensions that contribute auth providers (Google OAuth, SAML,
// generic OIDC, etc). Extensions call `findOrCreateUserViaExternalAuth`
// from their callback handler with the IdP's profile, then `createSession`
// with the returned user id.
export { createSession, findOrCreateUserViaExternalAuth } from "~/lib/auth.server";
export type { ExternalAuthProfile } from "~/lib/auth.server";
