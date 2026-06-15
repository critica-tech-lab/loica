import { useState, useRef, useEffect, useMemo } from "react";
import { Form } from "react-router";

const AVATAR_COLORS = [
  "#AF3029", // red
  "#DA702C", // orange
  "#D0A215", // yellow
  "#66800B", // green
  "#205EA6", // blue
  "#5E409D", // purple
  "#A02F6F", // magenta
  "#24837B", // cyan
];

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 6px)",
  minWidth: "160px",
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
  padding: "6px 12px",
  fontSize: "0.7rem",
  color: "var(--fg)",
  textDecoration: "none",
  background: "none",
  border: "none",
  textAlign: "left" as const,
  cursor: "pointer",
  opacity: 0.6,
  transition: "opacity 150ms ease-out, background 150ms ease-out",
};

const separatorStyle: React.CSSProperties = {
  height: "1px",
  margin: "4px 0",
  background: "color-mix(in srgb, var(--fg) 8%, transparent)",
};

function hoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.opacity = "1";
  e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
}

function hoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.opacity = "0.6";
  e.currentTarget.style.background = "none";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

interface UserMenuProps {
  userName: string;
  isAdmin?: boolean;
}

export function UserMenu({ userName, isAdmin }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const color = useMemo(() => avatarColor(userName), [userName]);
  const initials = getInitials(userName);

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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          border: "none",
          background: color,
          color: "#fff",
          fontSize: initials.length > 1 ? "0.6rem" : "0.75rem",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          opacity: open ? 1 : 0.85,
          transition: "opacity 0.15s",
        }}
        title={userName}
      >
        {initials}
      </button>
      {open && (
        <div style={menuStyle}>
          {/* Header with name */}
          <div style={{
            padding: "8px 12px 6px",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "var(--fg)",
            opacity: 0.5,
            borderBottom: "none",
          }}>
            {userName}
          </div>
          <div style={separatorStyle} />
          <a
            href="/settings"
            style={itemStyle}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          {isAdmin && (
            <>
              <div style={separatorStyle} />
              <a
                href="/groups"
                style={itemStyle}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
                onClick={() => setOpen(false)}
              >
                Groups
              </a>
              <a
                href="/admin"
                style={itemStyle}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
                onClick={() => setOpen(false)}
              >
                Admin panel
              </a>
            </>
          )}
          <div style={separatorStyle} />
          <Form method="post" action="/logout">
            <button
              type="submit"
              style={{ ...itemStyle, color: "var(--fg)", opacity: 0.45 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.45"; e.currentTarget.style.background = "none"; }}
            >
              Sign out
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
