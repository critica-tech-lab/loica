/**
 * Loica extension interface.
 *
 * An extension is a self-contained feature that the core discovers via the
 * registry in `app/extensions/index.ts`. Every field below is optional — an
 * extension declares only the extension points it cares about. Doc-type
 * extensions (Reports, Presentations, Spreadsheets) populate `docType` +
 * `template`. Future capability extensions (comments, AI, tags) will use
 * `sidePanels` / `toolbarButtons`. Auth-provider extensions (OIDC, Google,
 * SAML) will use `authProvider`.
 */

import type { ComponentType } from "react";

/**
 * Bump this whenever the `LoicaExtension` interface changes in a way that
 * breaks existing extensions (renaming a field, changing a callback
 * signature, removing an extension point). Extensions can opt-in by
 * declaring `apiVersion` in their definition; the registry warns at startup
 * when versions diverge.
 *
 * Adding a new optional field is NOT a breaking change.
 */
export const LOICA_EXTENSION_API_VERSION = 1;

// Loose document shape for exporters; kept here to keep the file client-safe
// (the real `Document` type lives in `~/lib/document.server`).
export interface ExtensionDocument {
  id: string;
  title: string;
  content: string;
  workspace_id: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ExtensionTemplate {
  /** Stable id (matches the frontmatter `type:` value when applicable). */
  id: string;
  /** Human-readable label shown in "Create new" menus. */
  label: string;
  /** One-character icon (emoji) — used as fallback when `Icon` is not set. */
  icon: string;
  /** Optional SVG icon component used in main create menus. */
  Icon?: ComponentType<{ className?: string }>;
  /** Returns the full document content (frontmatter + body). */
  generateContent: () => string;
}

export interface ExtensionExporter {
  (
    doc: ExtensionDocument,
    frontmatter: Record<string, string> | null,
    /**
     * Live document body to export. The PM editor POSTs freshly-serialized
     * markdown here; when omitted the exporter should fall back to
     * `doc.content` (the DB copy). Lets a global exporter honour unsaved edits.
     */
    content?: string,
  ): Promise<Response> | Response;
}

/**
 * Props passed to an extension's `EditorView` when it owns the editing
 * surface for its doc type (Spreadsheets is the canonical example). The
 * shape is stable: removing or renaming a field is breaking and bumps
 * `LOICA_EXTENSION_API_VERSION`.
 */
export interface ExtensionEditorViewProps {
  /** Document body as stored in SQLite (frontmatter + content). */
  initialContent: string;
  /** Called whenever the user edits — the host persists with debounce. */
  onChange: (content: string) => void;
  /** Called once the editor finishes its initial sync. */
  onReady?: () => void;
  /** When true, the editor must hide write affordances. */
  readOnly?: boolean;
  /** Document id (also the Yjs room name). */
  docId?: string;
  /** WebSocket URL for the Yjs sync server. */
  wsUrl?: string;
  /** Extra query params for the Yjs WebSocket connection (auth tokens). */
  wsParams?: Record<string, string>;
  /** Display info for the local user; the editor sets this on awareness. */
  userInfo?: { name: string; color: string };
  /** Connection status callbacks for the doc footer indicator. */
  onConnectionStatus?: (status: "connected" | "connecting" | "disconnected") => void;
  /** Remote-peer presence callbacks for the avatar stack. */
  onPresenceChange?: (peers: Array<{ name: string; color: string }>) => void;
}

/**
 * Context handed to extension UI hooks (banner, menu items) so they can
 * build links and labels without knowing host-internal helpers.
 */
export interface ExtensionDocContext {
  /** The document being viewed or edited. */
  document: { id: string; content: string };
  /** True when accessed via the `/shared/...` routes (read-only or shared edit). */
  isShared: boolean;
}

export interface ExtensionEditorBannerProps extends ExtensionDocContext {}

/**
 * A doc-menu entry contributed by an extension. The host renders these at
 * the top of the doc actions menu, separated from core actions by a
 * divider.
 */
export interface ExtensionDocMenuItem {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
}

/**
 * Auth provider metadata. Extensions that add a way to log in (Google
 * OAuth, SAML, generic OIDC, ...) declare this. The login page renders one
 * button per enabled-and-configured provider.
 */
export interface AuthProvider {
  /** User-facing label, e.g. "Sign in with Google". */
  label: string;
  /** Path users hit to start the flow, e.g. "/auth/google". The provider
   *  owns the actual route in `app/routes.ts`. */
  loginPath: string;
  /** Returns true when the provider has the configuration it needs (env
   *  vars set, secrets present). When false, the provider is hidden even
   *  if the extension is enabled. Server-side; not used on the client. */
  isConfigured?: () => boolean;
}

export interface LoicaExtension {
  /** Stable extension id, e.g. "reports", "presentations". */
  id: string;

  /** Optional short description, displayed in admin UI in the future. */
  description?: string;

  /**
   * Whether the extension is on when the admin hasn't configured an explicit
   * enabled list yet (the day-one state). Defaults to `true`. Opinionated
   * drop-in plugins (e.g. critica-pdf) set this to `false` so a fresh install
   * stays bare until an admin turns them on.
   */
  defaultEnabled?: boolean;

  /**
   * Marks a CORE feature that is compiled into Loica and uses host internals
   * (custom editors, etc.) — so it can't be a runtime drop-in. Core extensions
   * are ALWAYS on (can't be disabled) and are hidden from the admin "Extensions"
   * toggle list, which is reserved for true, installable drop-in extensions.
   * Presentations is the canonical example.
   */
  core?: boolean;

  /**
   * The `LOICA_EXTENSION_API_VERSION` the extension was written against.
   * When set and it doesn't match the current API version, the registry
   * emits a console warning at startup so the maintainer notices the
   * mismatch.
   */
  apiVersion?: number;

  /**
   * The extension's OWN version (semver, e.g. "1.2.0") — distinct from
   * `apiVersion` (host-compat). Surfaced in the admin panel and used to detect
   * upgrades against a remote manifest. Built-ins declare it inline; drop-in
   * plugins should also expose it in `plugins/<id>/extension.json`.
   */
  version?: string;

  /** Project/marketing homepage, linked from the admin panel. */
  homepage?: string;

  /**
   * Source repository (e.g. a git URL). Display + the basis for update checks
   * and remote install in later phases.
   */
  repository?: string;

  /** ── Doc-type extension point ──────────────────────────────────────── */

  /**
   * The frontmatter `type:` value this extension owns. The extension's
   * editor view, exporters and row icon will all be selected when a
   * document's frontmatter matches this string. Omit for non-doc-type
   * extensions.
   */
  docType?: string;

  /** Template that appears in the "Create new" menu. */
  template?: ExtensionTemplate;

  /** Icon shown in document lists for docs of this type. */
  rowIcon?: ComponentType<{ className?: string }>;

  /**
   * Custom React component that replaces the default markdown editor for
   * docs of this type. Receives an `ExtensionEditorViewProps` contract.
   */
  EditorView?: ComponentType<ExtensionEditorViewProps>;

  /**
   * Banner rendered above the editor (between the toolbar and the editor
   * surface) when this extension's `docType` matches. Use for per-doc-type
   * affordances like the "Present" pill.
   */
  EditorBanner?: ComponentType<ExtensionEditorBannerProps>;

  /**
   * Items the extension contributes to the doc actions menu. The host
   * puts them at the top of the menu and adds a separator after the
   * group. Returning `[]` (or omitting this) contributes nothing.
   */
  getDocMenuItems?: (ctx: ExtensionDocContext) => ExtensionDocMenuItem[];

  /** ── Export extension point ────────────────────────────────────────── */

  /**
   * Per-doc-type exporters. The dispatcher calls these from `api/doc-pdf/:id`
   * and `api/doc-docx/:id` when this extension owns the doc's `type`. When
   * absent, the core falls back to the built-in pure-JS markdown→PDF/DOCX
   * renderers. Adding new formats (epub, html) is non-breaking.
   */
  exporters?: {
    pdf?: ExtensionExporter;
    docx?: ExtensionExporter;
  };

  /**
   * Install-wide exporters that replace the core pure-JS renderers for ALL
   * docs (any type without its own `exporters` override). This is the escape
   * hatch for an opinionated install: a drop-in plugin can run its own
   * pipeline — pandoc/tectonic/LaTeX, a remote service, anything — fully
   * self-contained, so the bare core stays binary-free. The core resolves the
   * first enabled extension that declares one; none → built-in renderers.
   */
  globalExporters?: {
    pdf?: ExtensionExporter;
    docx?: ExtensionExporter;
  };

  /**
   * Server hook that returns the HTML preview body for `api/doc-preview/:id`
   * (used by share-link OG previews and print views). Returning a `Response`
   * takes precedence over the core markdown renderer; returning `null` means
   * "use core's default markdown render".
   */
  previewHtml?: (
    doc: ExtensionDocument,
    frontmatter: Record<string, string> | null,
  ) => Response | Promise<Response> | null | Promise<null>;

  /** ── Auth provider extension point ─────────────────────────────────── */

  /**
   * When set, the extension contributes a sign-in option to the login
   * page. The extension is responsible for owning its login + callback
   * routes.
   */
  authProvider?: AuthProvider;
}
