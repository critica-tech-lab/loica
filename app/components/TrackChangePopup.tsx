import { useEffect, useRef } from "react";
import type { TrackedChangeEntry } from "~/components/editor/types";
import { authorTrackColor } from "~/components/editor/types";

interface Props {
  change: TrackedChangeEntry;
  pos: { x: number; y: number };
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: () => void;
}

export function TrackChangePopup({ change, pos, onAccept, onReject, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const color = authorTrackColor(change.authorId);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const label = change.type === "insert" ? "Insertion" : change.type === "delete" ? "Deletion" : "Change";
  const date = change.createdAt ? new Date(change.createdAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  // Position popup above the click point, clamped to viewport
  const POPUP_W = 220;
  const left = Math.min(Math.max(pos.x - POPUP_W / 2, 8), window.innerWidth - POPUP_W - 8);
  const top = pos.y - 8; // will use translateY(-100%) to go above

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left,
        top,
        transform: "translateY(-100%)",
        width: POPUP_W,
        background: "var(--bg)",
        border: `1px solid ${color}40`,
        borderTop: `3px solid ${color}`,
        borderRadius: "6px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        zIndex: 200,
        fontFamily: "var(--font-ui)",
        fontSize: "0.78rem",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "0.4rem 0.6rem 0.3rem", borderBottom: `1px solid ${color}20`, display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{
          fontWeight: 700,
          color,
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}>{label}</span>
        {date && <span style={{ color: "color-mix(in srgb, var(--fg) 45%, transparent)", marginLeft: "auto", fontSize: "0.68rem" }}>{date}</span>}
      </div>

      {/* Change text preview */}
      {change.text && (
        <div style={{
          padding: "0.3rem 0.6rem",
          color: "color-mix(in srgb, var(--fg) 75%, transparent)",
          fontStyle: change.type === "delete" ? "italic" : "normal",
          textDecoration: change.type === "delete" ? "line-through" : "none",
          textDecorationColor: color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          borderBottom: `1px solid color-mix(in srgb, var(--fg) 7%, transparent)`,
        }}>
          {change.text.length > 50 ? change.text.slice(0, 50) + "…" : change.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 0 }}>
        <button
          onMouseDown={(e) => { e.preventDefault(); onAccept(change.id); onDismiss(); }}
          style={actionBtn("#16a34a")}
        >
          ✓ Accept
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); onReject(change.id); onDismiss(); }}
          style={actionBtn("#dc2626")}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "0.3rem",
    border: "none",
    background: "transparent",
    borderTop: `1px solid color-mix(in srgb, var(--fg) 7%, transparent)`,
    color,
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}
