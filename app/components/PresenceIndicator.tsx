import { useState, useRef, useEffect } from "react";
import { useOptionalDocument, userColor } from "~/lib/DocumentContext";
import type { Peer } from "./Editor";

export function PresenceIndicator(props?: { peers?: Peer[]; currentUser?: Peer }) {
  const ctx = useOptionalDocument();
  const peers = props?.peers ?? ctx?.peers ?? [];
  const currentUser: Peer | undefined = props?.currentUser ?? (ctx ? { name: ctx.user.name, color: userColor(ctx.user.id) } : undefined);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const allUsers = currentUser ? [currentUser, ...peers] : peers;

  if (allUsers.length === 0) return null;

  const shown = allUsers.slice(0, 4);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.15rem 0.4rem",
          background: open
            ? "color-mix(in srgb, var(--fg) 12%, transparent)"
            : "color-mix(in srgb, var(--fg) 5%, transparent)",
          border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
          borderRadius: "var(--radius-pill)",
          cursor: "pointer",
          fontSize: "var(--text-xs)",
          color: "var(--fg)",
          lineHeight: 1,
          transition: "background var(--ease-out)",
        }}
        title={`${allUsers.length} user${allUsers.length === 1 ? "" : "s"} online`}
      >
        {/* Stacked colored dots */}
        <span style={{ display: "flex", alignItems: "center" }}>
          {shown.map((p, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: p.color,
                border: "1.5px solid var(--bg)",
                marginLeft: i > 0 ? -3 : 0,
                flexShrink: 0,
              }}
            />
          ))}
        </span>
        <span style={{ opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          {allUsers.length} online
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: "10rem",
            background: "var(--bg)",
            border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px color-mix(in srgb, var(--fg) 8%, transparent)",
            padding: "0.375rem 0",
            zIndex: "var(--z-panel)",
          }}
        >
          <div
            style={{
              padding: "0.25rem 0.75rem 0.375rem",
              fontSize: "var(--text-2xs)",
              opacity: 0.4,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Online now
          </div>
          {allUsers.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.3rem 0.75rem",
                fontSize: "var(--text-base)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: p.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
