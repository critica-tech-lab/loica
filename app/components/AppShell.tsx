import { useEffect, useRef, useCallback } from "react";
import { useRevalidator } from "react-router";
import { Navbar } from "./Navbar";

declare const __COMMIT_HASH__: string;
declare const __BUILD_DATE__: string;

const POLL_INTERVAL = 30_000; // 30 seconds
const WAKE_DELAY = 1_500; // delay after tab becomes visible before revalidating

interface AppShellProps {
  children: React.ReactNode;
  navLeft?: React.ReactNode;
  navActions?: React.ReactNode;
  scrollable?: boolean;
  footerLeft?: React.ReactNode;
  footerCenter?: React.ReactNode;
  sidebar?: React.ReactNode;
  /** "drive" adds a warm tint + accent strip to signal management mode. */
  tone?: "drive" | "editor";
}

/**
 * Top-level layout wrapper: sticky navbar + full-height content area.
 * Used by all authenticated and public pages.
 */
export function AppShell({ children, navLeft, navActions, scrollable, footerLeft, footerCenter, sidebar, tone }: AppShellProps) {
  const revalidator = useRevalidator();
  const visibleRef = useRef(typeof document !== "undefined" ? !document.hidden : true);

  const safeRevalidate = useCallback(() => {
    if (revalidator.state === "idle" && !document.hidden && navigator.onLine) {
      revalidator.revalidate();
    }
  }, [revalidator]);

  useEffect(() => {
    // Poll only while the tab is visible
    const id = setInterval(() => {
      if (visibleRef.current) safeRevalidate();
    }, POLL_INTERVAL);

    // Revalidate when tab becomes visible again (e.g. after sleep/idle)
    // with a short delay to let the network reconnect
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    function onVisibilityChange() {
      visibleRef.current = !document.hidden;
      if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
      if (!document.hidden) {
        wakeTimer = setTimeout(safeRevalidate, WAKE_DELAY);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(id);
      if (wakeTimer) clearTimeout(wakeTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [safeRevalidate]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        ...(scrollable ? {} : { height: "100dvh" }),
      }}
    >
      <Navbar left={navLeft} actions={navActions} />
      {tone === "drive" && (
        <div
          style={{
            height: "2px",
            background: "linear-gradient(to right, color-mix(in srgb, var(--accent) 40%, transparent), color-mix(in srgb, var(--color-tawny) 40%, transparent), color-mix(in srgb, var(--color-sage) 40%, transparent))",
            flexShrink: 0,
          }}
        />
      )}
      {sidebar ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {sidebar}
          <main
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              ...(scrollable ? { overflowY: "auto" } : { overflow: "hidden" }),
              ...(tone === "drive" ? { background: "color-mix(in srgb, var(--color-tawny) 2%, var(--bg))" } : {}),
            }}
          >
            {children}
          </main>
        </div>
      ) : (
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            ...(scrollable ? {} : { overflow: "hidden" }),
            ...(tone === "drive" ? { background: "color-mix(in srgb, var(--color-tawny) 2%, var(--bg))" } : {}),
          }}
        >
          {children}
        </main>
      )}
      <footer
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "2rem",
          padding: "0 0.75rem",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-2xs)",
          color: "color-mix(in srgb, var(--fg) 50%, transparent)",
          borderTop: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {footerLeft}
        </div>
        {footerCenter && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {footerCenter}
          </div>
        )}
        <span>{__COMMIT_HASH__}</span>
      </footer>
    </div>
  );
}
