import { useEffect, useRef } from "react";
import type { TrackedChangeEntry } from "~/components/editor/types";

const TYPE_BG = {
  insert: "color-mix(in srgb, #66800B 22%, #100F0F)",
  delete: "color-mix(in srgb, #AF3029 22%, #100F0F)",
  other:  "#100F0F",
} as const;

interface Props {
  change: TrackedChangeEntry;
  pos: { x: number; y: number };
  editorRef?: React.RefObject<HTMLDivElement | null>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: () => void;
}

export function TrackChangePopup({ change, pos, onAccept, onReject, onDismiss }: Props) {
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

  const bg = TYPE_BG[change.type];
  const top = pos.y - 42;
  const left = Math.min(Math.max(pos.x - 60, 8), window.innerWidth - 144);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 400,
        display: "inline-flex",
        alignItems: "stretch",
        background: bg,
        color: "var(--bg)",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(16,15,15,0.25), 0 2px 6px rgba(16,15,15,0.15)",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      <Btn label="Accept" onActivate={() => { onAccept(change.id); onDismiss(); }} />
      <div style={{ width: "1px", background: "color-mix(in srgb, var(--bg) 15%, transparent)", flexShrink: 0 }} />
      <Btn label="Reject" onActivate={() => { onReject(change.id); onDismiss(); }} />
    </div>
  );
}

function Btn({ label, onActivate }: { label: string; onActivate: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onActivate(); }}
      style={{
        padding: "0 12px",
        height: "32px",
        background: "transparent",
        color: "inherit",
        border: "none",
        cursor: "pointer",
        fontSize: "13px",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        transition: "background 80ms ease-out",
        fontFamily: "var(--font-ui)",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--bg) 15%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
