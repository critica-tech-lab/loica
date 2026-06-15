import { Link } from "react-router";
import { LogoIcon } from "./icons";

interface NavbarProps {
  /** Extra content rendered after the logo separator (breadcrumb, title, etc.) */
  left?: React.ReactNode;
  /** Extra actions rendered on the right side */
  actions?: React.ReactNode;
}

export function Navbar({ left, actions }: NavbarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "2.25rem",
        padding: "0 1rem",
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
        position: "sticky",
        top: 0,
        zIndex: "var(--z-sticky)",
        background: "var(--bg)",
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Left group: logo + separator + breadcrumb content */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          minWidth: 0,
          flex: 1,
        }}
      >
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <LogoIcon style={{ width: "auto", height: "1rem" }} />
        </Link>
        {left && (
          <>
            <span style={{ opacity: 0.2, fontSize: "0.8rem", flexShrink: 0 }}>/</span>
            {left}
          </>
        )}
      </div>

      {/* Right side */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexShrink: 0,
        }}
      >
        {actions}
      </div>
    </header>
  );
}
