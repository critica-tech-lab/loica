import type { ExtensionEditorBannerProps } from "~/extensions/sdk";

/** Count slides in a presentation's markdown — same split rules as PresentView. */
function countSlides(content: string): number {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let count = 1;
  for (const line of body.split(/\r?\n/)) {
    if (/^-{3,}\s*$/.test(line)) count += 1;
  }
  return count;
}

/**
 * Open the presentation URL in a detached popup window (not a tab).
 * Good for dual-monitor setups: the popup can be dragged to a second display
 * and made fullscreen without interfering with the editor tab.
 * If the browser's popup blocker swallows it, fall back to a new tab so the
 * user isn't left wondering why nothing happened.
 */
export function openPresentWindow(href: string) {
  const w = 1600;
  const h = 900;
  const screenW = typeof window !== "undefined" ? window.screen?.availWidth ?? 0 : 0;
  const screenH = typeof window !== "undefined" ? window.screen?.availHeight ?? 0 : 0;
  const left = screenW > w ? Math.round((screenW - w) / 2) : 0;
  const top = screenH > h ? Math.round((screenH - h) / 2) : 0;
  // Intentionally NOT using `noopener` — we need `window.opener` on the
  // popup so its Exit button can call `window.close()`.
  const features = `popup,width=${w},height=${h},left=${left},top=${top}`;
  const popup = window.open(href, "_blank", features);
  if (!popup) {
    window.open(href, "_blank");
  }
}

/** Build the per-doc href into present mode (different paths for shared vs owned). */
export function presentHref({ document, isShared }: ExtensionEditorBannerProps): string {
  return isShared
    ? `/shared/doc/${document.id}/present`
    : `/w/doc/${document.id}/present`;
}

/**
 * "N slides · Present" pill above the editor. The plugin's `EditorBanner`
 * — host renders this for any doc with `type: presentation`.
 */
export function PresentBanner({ document, isShared }: ExtensionEditorBannerProps) {
  const n = countSlides(document.content);
  const href = presentHref({ document, isShared });
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "0.75rem 0 0.25rem" }}>
      <button
        type="button"
        onClick={() => openPresentWindow(href)}
        title="Open presentation in its own window"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 12px",
          background: "var(--fg)",
          color: "var(--bg)",
          border: "none",
          borderRadius: "999px",
          textDecoration: "none",
          fontFamily: "var(--font-ui)",
          fontSize: "12px",
          fontWeight: 500,
          letterSpacing: "-0.005em",
          boxShadow: "0 2px 8px rgba(16,15,15,0.08)",
          transition: "transform 120ms ease-out, box-shadow 120ms ease-out",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(16,15,15,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(16,15,15,0.08)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
        </svg>
        <span>Present · {n} {n === 1 ? "slide" : "slides"}</span>
      </button>
    </div>
  );
}
