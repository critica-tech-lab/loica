import { useEffect, useRef } from "react";
import type { TrackedChangeEntry } from "~/components/editor/types";
import { authorTrackColor } from "~/components/editor/types";
import { timeAgo } from "~/lib/ui-utils";
import { popoverSurface } from "~/lib/popover-styles";
import { Avatar } from "./Avatar";

const POPUP_W = 240;
const GAP = 8;

interface Props {
  change: TrackedChangeEntry;
  pos: { x: number; y: number };
  editorRef?: React.RefObject<HTMLDivElement | null>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: () => void;
}

export function TrackChangePopup({ change, pos, onAccept, onReject, onDismiss, editorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const authorColor = authorTrackColor(change.authorId);
  const snippet = change.text?.trim().slice(0, 80);

  const editorRight = editorRef?.current?.getBoundingClientRect().right ?? null;
  const left = editorRight != null
    ? Math.min(editorRight + GAP, window.innerWidth - POPUP_W - GAP)
    : Math.min(Math.max(pos.x - 60, GAP), window.innerWidth - POPUP_W - GAP);
  const top = Math.min(Math.max(pos.y - 20, GAP), window.innerHeight - 160 - GAP);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        width: POPUP_W,
        zIndex: 400,
        ...popoverSurface,
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-base)",
        color: "var(--fg)",
      }}
    >
      {/* Author + time */}
      <div style={{ padding: "10px 12px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: snippet ? "8px" : 0 }}>
          <Avatar name={change.authorName || "?"} color={authorColor} size={26} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "var(--text-base)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
              {change.authorName || "Unknown"}
            </div>
            <div style={{ fontSize: "var(--text-2xs)", color: "color-mix(in srgb, var(--fg) 45%, transparent)", fontVariantNumeric: "tabular-nums" }}>
              {timeAgo(change.createdAt)}
            </div>
          </div>
        </div>

        {snippet && (
          <div style={{
            padding: "3px 8px",
            borderLeft: `2px solid ${authorColor}`,
            fontSize: "var(--text-xs)",
            color: "color-mix(in srgb, var(--fg) 55%, transparent)",
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            <strong>{change.type === "insert" ? "Add:" : "Remove:"}</strong> "{snippet}"
          </div>
        )}
      </div>

      <div style={{ height: "1px", background: "color-mix(in srgb, var(--fg) 12%, transparent)" }} />

      {/* Accept / Reject */}
      <div style={{ display: "flex", gap: "8px", padding: "8px 12px" }}>
        <SmallBtn onClick={() => { onAccept(change.id); onDismiss(); }} primary>Accept</SmallBtn>
        <SmallBtn onClick={() => { onReject(change.id); onDismiss(); }}>Reject</SmallBtn>
      </div>
    </div>
  );
}

function SmallBtn({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px",
      border: primary
        ? "1px solid var(--fg)"
        : "1px solid color-mix(in srgb, var(--fg) 30%, transparent)",
      borderRadius: 0,
      fontSize: "var(--text-xs)",
      fontWeight: 600,
      cursor: "pointer",
      background: primary ? "var(--fg)" : "transparent",
      color: primary ? "var(--bg)" : "var(--fg)",
      fontFamily: "var(--font-ui)",
      letterSpacing: "0.02em",
    }}>
      {children}
    </button>
  );
}
