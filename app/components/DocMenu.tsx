import { useEffect, useRef, useState } from "react";

export type DocMenuItem =
  | {
      kind?: "action";
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      title?: string;
    }
  | { kind: "separator" }
  | {
      /**
       * A row of compact pill buttons — used for same-kind actions like
       * picking a download format. Much more compact than stacking N labels.
       */
      kind: "pills";
      heading?: string;
      items: { label: string; onClick: () => void; title?: string }[];
    };

interface DocMenuProps {
  items: DocMenuItem[];
  /** Accessible label for the trigger button. Default: "Document actions". */
  label?: string;
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 6px)",
  minWidth: "180px",
  background: "var(--bg)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-lg)",
  padding: "4px 0",
  boxShadow: "var(--shadow-md)",
  zIndex: "var(--z-panel)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  gap: "8px",
  padding: "6px 12px",
  fontSize: "0.72rem",
  color: "var(--fg)",
  background: "none",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  opacity: 0.7,
  transition: "opacity var(--ease-out), background var(--ease-out)",
};

const iconSlotStyle: React.CSSProperties = {
  width: "14px",
  height: "14px",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.75,
};

const separatorStyle: React.CSSProperties = {
  height: "1px",
  margin: "4px 0",
  background: "color-mix(in srgb, var(--fg) 8%, transparent)",
};

const pillsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: "4px",
  padding: "4px 10px 8px",
};

const pillBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: "0.66rem",
  fontWeight: 500,
  letterSpacing: "0.01em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, var(--fg) 65%, transparent)",
  background: "color-mix(in srgb, var(--fg) 5%, transparent)",
  border: "1px solid transparent",
  borderRadius: "var(--radius-xs)",
  cursor: "pointer",
  transition: "background 120ms, color 120ms",
};

const pillsHeadingStyle: React.CSSProperties = {
  display: "block",
  padding: "4px 12px 2px",
  fontSize: "0.62rem",
  fontWeight: 500,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, var(--fg) 45%, transparent)",
};

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.opacity = "1";
  e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
}

function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.opacity = "0.7";
  e.currentTarget.style.background = "none";
}

function pillHoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "var(--fg)";
  e.currentTarget.style.color = "var(--bg)";
}

function pillHoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
  e.currentTarget.style.color = "color-mix(in srgb, var(--fg) 65%, transparent)";
}

/**
 * Topbar "⋯" menu for document-level actions (favorites, formatting toggle,
 * version history, downloads, etc). Separate from the avatar menu, which is
 * reserved for user/account actions.
 */
export function DocMenu({ items, label = "Document actions" }: DocMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
        style={{
          height: "28px",
          width: "28px",
          padding: 0,
          border: "none",
          background: open ? "color-mix(in srgb, var(--fg) 10%, transparent)" : "transparent",
          borderRadius: "5px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: open ? "var(--fg)" : "color-mix(in srgb, var(--fg) 55%, transparent)",
          transition: "background var(--ease-fast), color var(--ease-fast)",
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
            e.currentTarget.style.color = "var(--fg)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "color-mix(in srgb, var(--fg) 55%, transparent)";
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div role="menu" style={menuStyle}>
          {items.map((item, i) => {
            if (item.kind === "separator") {
              return <div key={`sep-${i}`} style={separatorStyle} />;
            }
            if (item.kind === "pills") {
              return (
                <div key={`pills-${i}`}>
                  {item.heading && <span style={pillsHeadingStyle}>{item.heading}</span>}
                  <div style={pillsRowStyle}>
                    {item.items.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        role="menuitem"
                        title={p.title ?? p.label}
                        style={pillBtnStyle}
                        onMouseEnter={pillHoverIn}
                        onMouseLeave={pillHoverOut}
                        onClick={() => {
                          setOpen(false);
                          p.onClick();
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                title={item.title ?? item.label}
                style={itemStyle}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                <span style={iconSlotStyle} aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
