import { data } from "react-router";

/**
 * Every error loica can show a user, in one place.
 *
 * Routes throw a *code*, not a status + prose. The code carries the status, the
 * wording, and what the user can do next, so the same situation reads the same
 * way everywhere and the ErrorBoundary never has to guess from a bare number.
 */
export type AppErrorCode =
  // auth
  | "not_authenticated"
  | "admin_only"
  // permission
  | "no_workspace_access"
  | "no_folder_access"
  | "no_doc_access"
  | "read_only"
  // missing
  | "doc_not_found"
  | "folder_not_found"
  | "workspace_not_found"
  // share links
  | "link_invalid"
  | "link_password_required"
  | "link_view_only"
  // input
  | "file_missing"
  | "file_too_large"
  | "file_type_unsupported"
  | "bad_request"
  // limits & failures
  | "rate_limited"
  | "export_failed"
  | "server_error";

export type ErrorAction = { label: string; href: string };

export type AppErrorPayload = {
  /** Marks a payload as coming from this catalog, so the boundary can trust it. */
  loicaError: true;
  code: AppErrorCode;
  status: number;
  title: string;
  detail: string;
  /** What the user can do about it, when there is something. */
  hint?: string;
  action?: ErrorAction;
};

export type AppErrorOptions = {
  /** Name of the thing involved — folder, doc, or workspace name. */
  subject?: string | null;
  /** Who to ask for access. Falls back to a generic phrasing when absent. */
  owner?: string | null;
  /** Overrides the catalog's default next step. */
  action?: ErrorAction | null;
  /** Appended to the catalog detail — for one-off specifics like a size limit. */
  extra?: string | null;
};

type ErrorSpec = {
  status: number;
  title: string;
  /** `subject` is the quoted name when the route knows it, else a generic noun. */
  detail: (subject: string) => string;
  hint?: (owner: string | null) => string;
  action?: ErrorAction;
};

const HOME: ErrorAction = { label: "Go to your files", href: "/w" };
const SHARED: ErrorAction = { label: "Go to shared with you", href: "/shared" };

const CATALOG: Record<AppErrorCode, ErrorSpec> = {
  not_authenticated: {
    status: 401,
    title: "Sign in to continue",
    detail: () => "This page is only visible to signed-in users.",
    action: { label: "Sign in", href: "/login" },
  },
  admin_only: {
    status: 403,
    title: "Admins only",
    detail: () => "This page is restricted to workspace administrators.",
    action: HOME,
  },

  no_workspace_access: {
    status: 403,
    title: "You're not in this workspace",
    detail: (s) => `You're not a member of ${s}, so its contents stay private.`,
    hint: (owner) =>
      owner
        ? `Ask ${owner} to add you to the workspace.`
        : "Ask a workspace owner to add you.",
    action: HOME,
  },
  no_folder_access: {
    status: 403,
    title: "This folder isn't shared with you",
    detail: (s) =>
      `${s} lives in someone else's workspace. You can open the documents shared with you, but not the folder itself.`,
    hint: (owner) =>
      owner
        ? `Ask ${owner} to share the folder if you need the rest of its contents.`
        : "Ask the owner to share the folder if you need the rest of its contents.",
    action: SHARED,
  },
  no_doc_access: {
    status: 403,
    title: "This document isn't shared with you",
    detail: (s) => `You don't have permission to open ${s}.`,
    hint: (owner) =>
      owner ? `Ask ${owner} to share it with you.` : "Ask the owner to share it with you.",
    action: SHARED,
  },
  read_only: {
    status: 403,
    title: "You have view-only access",
    detail: (s) => `Your role on ${s} lets you read but not make changes.`,
    hint: (owner) =>
      owner ? `Ask ${owner} for edit access.` : "Ask an owner or editor for edit access.",
  },

  doc_not_found: {
    status: 404,
    title: "Document not found",
    detail: () => "This document doesn't exist, or it has been deleted.",
    action: HOME,
  },
  folder_not_found: {
    status: 404,
    title: "Folder not found",
    detail: () => "This folder doesn't exist, or it has been deleted.",
    action: HOME,
  },
  workspace_not_found: {
    status: 404,
    title: "Workspace not found",
    detail: () => "This workspace doesn't exist, or it has been deleted.",
    action: HOME,
  },

  link_invalid: {
    status: 404,
    title: "This link no longer works",
    detail: () => "The share link is invalid, or sharing was turned off for this document.",
    hint: () => "Ask whoever sent it for a fresh link.",
  },
  link_password_required: {
    status: 403,
    title: "This link is password protected",
    detail: () => "Enter the password to open the document.",
    hint: () => "Ask whoever sent the link for the password.",
  },
  link_view_only: {
    status: 403,
    title: "This link is read-only",
    detail: () => "The owner shared this document for viewing, not editing.",
    hint: () => "Ask them for an edit link if you need to make changes.",
  },

  file_missing: {
    status: 400,
    title: "No file received",
    detail: () => "The upload arrived empty. Pick the file again.",
  },
  file_too_large: {
    status: 400,
    title: "File is too large",
    detail: () => "Uploads are capped at 20 MB.",
    hint: () => "Compress the file, or link to it instead of attaching it.",
  },
  file_type_unsupported: {
    status: 400,
    title: "Unsupported file type",
    detail: () => "loica can't store this kind of file.",
  },
  bad_request: {
    status: 400,
    title: "That request didn't make sense",
    detail: () => "Something was missing from the request. Reload and try once more.",
  },

  rate_limited: {
    status: 429,
    title: "Slow down a moment",
    detail: () => "You've made too many requests in a short window.",
    hint: () => "Wait a minute, then try again.",
  },
  export_failed: {
    status: 500,
    title: "Export failed",
    detail: () => "The document couldn't be converted. This is usually temporary.",
    hint: () => "Try again — if it keeps failing, the document may contain something we can't render.",
  },
  server_error: {
    status: 500,
    title: "Something went wrong on our end",
    detail: () => "The server hit an unexpected error.",
    hint: () => "Try again in a moment.",
  },
};

/** Generic nouns used when a route doesn't know (or shouldn't leak) the real name. */
const FALLBACK_SUBJECT: Partial<Record<AppErrorCode, string>> = {
  no_workspace_access: "this workspace",
  no_folder_access: "This folder",
  no_doc_access: "this document",
  read_only: "this workspace",
};

export function errorPayload(code: AppErrorCode, opts: AppErrorOptions = {}): AppErrorPayload {
  const spec = CATALOG[code];
  const subject = opts.subject ? `"${opts.subject}"` : (FALLBACK_SUBJECT[code] ?? "this");
  const action = opts.action === null ? undefined : (opts.action ?? spec.action);
  const detail = [spec.detail(subject), opts.extra].filter(Boolean).join(" ");

  return {
    loicaError: true,
    code,
    status: spec.status,
    title: spec.title,
    detail,
    ...(spec.hint ? { hint: spec.hint(opts.owner ?? null) } : {}),
    ...(action ? { action } : {}),
  };
}

/**
 * Throw from a loader or action. The payload lands on `error.data` in the
 * ErrorBoundary, which renders the title, detail, hint, and next step.
 *
 *   if (!role) throw appError("no_workspace_access", { subject: workspace.name });
 */
export function appError(code: AppErrorCode, opts: AppErrorOptions = {}): never {
  const payload = errorPayload(code, opts);
  throw data(payload, { status: payload.status });
}

/** Same catalog, as a plain body for API routes that return `{ ok: false }`. */
export function errorResponse(code: AppErrorCode, opts: AppErrorOptions = {}): Response {
  const payload = errorPayload(code, opts);
  return Response.json({ ok: false, error: payload }, { status: payload.status });
}

export function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { loicaError?: unknown }).loicaError === true
  );
}
