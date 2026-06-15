import { authorColorFromName } from "./comment-decorations";

// Shared initials avatar. Colour defaults to the deterministic author colour
// derived from the name; pass `color` to override. `maxInitials` controls how
// many leading word-initials show (1 by default, matching the comment avatars).
export function Avatar({
  name,
  color,
  size = 24,
  maxInitials = 1,
  style,
}: {
  name: string;
  color?: string;
  size?: number;
  maxInitials?: number;
  style?: React.CSSProperties;
}) {
  const initials =
    (name || "").trim().split(/\s+/).filter(Boolean).slice(0, maxInitials).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span style={{
      width: size, height: size,
      borderRadius: "var(--radius-pill)",
      background: color ?? authorColorFromName(name || ""),
      flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.4, fontWeight: 700, userSelect: "none",
      ...style,
    }}>
      {initials}
    </span>
  );
}
