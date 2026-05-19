import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/root";
import { getSessionUser } from "~/lib/auth.server";
import { getPendingGroupInviteCount } from "~/lib/group.server";
import { getPendingSharesForUser } from "~/lib/sharing.server";
import { getPendingDocSharesForUser } from "~/lib/doc-sharing.server";
import { getEnabledExtensionIdSet } from "~/extensions/index.server";
import { SearchModal } from "~/components/SearchModal";
import { ToastProvider } from "~/components/Toast";
import { LogoIcon } from "~/components/icons";
import stylesheet from "./app.css?url";

export const headers: Route.HeadersFunction = () => ({
  "Cache-Control": "no-cache, no-store, must-revalidate",
});

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  { rel: "stylesheet", href: stylesheet },
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  const pendingInviteCount = user ? getPendingGroupInviteCount(user.id) : 0;
  const pendingShareCount = user
    ? getPendingSharesForUser(user.id).length + getPendingDocSharesForUser(user.id).length
    : 0;
  const enabledExtensionIds = Array.from(getEnabledExtensionIdSet());
  return { user, pendingInviteCount, pendingShareCount, enabledExtensionIds };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const data = useRouteLoaderData<typeof loader>("root");
  const user = data?.user ?? null;
  const pendingInviteCount = data?.pendingInviteCount ?? 0;
  const pendingShareCount = data?.pendingShareCount ?? 0;

  useEffect(() => {
    // App loaded successfully — reset transient error retry counter
    sessionStorage.removeItem(RETRY_KEY);

    // Report unhandled client errors to server for admin visibility
    // Skip known CodeMirror/Yjs internal noise that isn't actionable
    const NOISE_RE = /No tile at position|Ranges must be added sorted|Error in input stream|Invalid position \d+ in document of length/;
    function reportError(message: string, stack?: string) {
      if (!message || NOISE_RE.test(message)) return;
      // Skip minified library TypeErrors (no app code in stack)
      if (/^TypeError:/.test(message) && stack && !stack.includes("/app/")) return;
      try {
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, stack, url: window.location.href }),
        }).catch(() => {});
      } catch { /* best-effort */ }
    }
    function onError(e: ErrorEvent) {
      reportError(e.message, e.error?.stack);
    }
    function onUnhandledRejection(e: PromiseRejectionEvent) {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
      const stack = e.reason instanceof Error ? e.reason.stack : undefined;
      reportError(msg, stack);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  // Reconnection overlay — detect server downtime and show waiting UI
  const [serverDown, setServerDown] = useState(false);
  const downSinceRef = useRef<number | null>(null);
  const overlayShownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const POLL_MS = 5000;
    const GRACE_MS = 3000; // don't flash overlay for brief hiccups

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) {
          if (downSinceRef.current !== null) {
            if (overlayShownRef.current) {
              // Server is back after a real outage — reload to get fresh assets/data
              window.location.reload();
              return;
            }
            // Brief hiccup recovered silently — reset without reloading
            downSinceRef.current = null;
          }
          setServerDown(false);
        } else {
          throw new Error("not ok");
        }
      } catch {
        if (downSinceRef.current === null) {
          downSinceRef.current = Date.now();
        }
        if (Date.now() - downSinceRef.current >= GRACE_MS) {
          overlayShownRef.current = true;
          setServerDown(true);
        }
      }
      if (!cancelled) setTimeout(check, POLL_MS);
    }

    const timer = setTimeout(check, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Don't intercept Cmd+K when focused inside the editor (used for link formatting)
        const active = document.activeElement;
        if (active?.closest(".cm-editor")) return;
        e.preventDefault();
        if (user) setSearchOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [user]);

  return (
    <ToastProvider>
      {pendingInviteCount > 0 && (
        <a
          href="/groups"
          className="block bg-accent/10 px-4 py-2 text-center text-xs font-medium text-accent no-underline hover:bg-accent/15"
        >
          You have {pendingInviteCount} pending group invitation{pendingInviteCount > 1 ? "s" : ""}
        </a>
      )}
      {pendingShareCount > 0 && (
        <a
          href="/shared"
          className="block bg-sage/10 px-4 py-2 text-center text-xs font-medium text-sage no-underline hover:bg-sage/15"
        >
          You have {pendingShareCount} pending share invitation{pendingShareCount > 1 ? "s" : ""}
        </a>
      )}
      <Outlet />
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {serverDown && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(4px)",
          }}
        >
          <LogoIcon style={{ width: "auto", height: 32, animation: "pulse 1.5s ease-in-out infinite" }} />
          <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>
            Updating, please wait...
          </p>
          <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.5 }}>
            The site will reload automatically
          </p>
          <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
        </div>
      )}
    </ToastProvider>
  );
}

/** Hook for child routes to read the current session user */
export function useSessionUser() {
  const data = useRouteLoaderData<typeof loader>("root");
  return data?.user ?? null;
}

/**
 * Set of extension IDs that are currently enabled by the admin. Used by
 * create menus and template lists to hide entries belonging to disabled
 * extensions.
 */
export function useEnabledExtensionIds(): Set<string> {
  const data = useRouteLoaderData<typeof loader>("root");
  return new Set(data?.enabledExtensionIds ?? []);
}



const MAX_AUTO_RETRIES = 3;
const RETRY_KEY = "__loica_transient_retries";

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  let isTransient = false;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "loica not found" : String(error.status);
    details =
      error.status === 404
        ? "This document doesn't exist or has been deleted."
        : error.statusText || details;
  } else if (error instanceof Error) {
    // Always log the error for debugging
    console.error("[ErrorBoundary]", error);
    // Detect network/fetch errors (common after sleep/idle)
    const msg = error.message.toLowerCase();
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch") || msg.includes("load failed")) {
      isTransient = true;
      details = "Connection lost. This can happen after your device sleeps.";
    }
    if (import.meta.env.DEV) {
      details = error.message;
      stack = error.stack;
    }
  }

  // Auto-retry transient errors with backoff (max 3 attempts)
  useEffect(() => {
    if (!isTransient) return;
    const retries = Number(sessionStorage.getItem(RETRY_KEY) || "0");
    if (retries >= MAX_AUTO_RETRIES) return;
    const delay = (retries + 1) * 3000; // 3s, 6s, 9s
    const timer = setTimeout(() => {
      sessionStorage.setItem(RETRY_KEY, String(retries + 1));
      window.location.reload();
    }, delay);
    return () => clearTimeout(timer);
  }, [isTransient]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        gap: "0.5rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <LogoIcon style={{ width: "auto", height: 28, opacity: 0.25, marginBottom: "0.5rem" }} />
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
        {message}
      </h1>
      <p style={{ opacity: 0.6, margin: 0 }}>{details}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1.5rem",
          fontSize: "0.85rem",
          cursor: "pointer",
          border: "1px solid rgba(28,22,18,0.15)",
          borderRadius: "var(--radius-md)",
          background: "transparent",
          color: "inherit",
        }}
      >
        {isTransient ? "Reconnect" : "Reload page"}
      </button>
      {stack && (
        <pre
          style={{
            marginTop: "2rem",
            textAlign: "left",
            fontSize: "0.75rem",
            opacity: 0.5,
            whiteSpace: "pre-wrap",
            maxWidth: "60ch",
          }}
        >
          {stack}
        </pre>
      )}
    </div>
  );
}
