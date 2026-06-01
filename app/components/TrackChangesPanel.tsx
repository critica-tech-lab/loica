import { useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { TrackedChangeEntry } from "~/components/editor/types";
import { authorTrackColor } from "~/components/editor/types";

export function TrackChangesPanel() {
  const { trackChangesState, editorApi } = useDocument();
  const [activeIdx, setActiveIdx] = useState<number>(0);

  const changes = trackChangesState?.changes ?? [];
  const enabled = trackChangesState?.enabled ?? false;

  const accept = (id: string) => editorApi.current?.acceptChangeById?.(id);
  const reject = (id: string) => editorApi.current?.rejectChangeById?.(id);
  const acceptAll = () => editorApi.current?.acceptAllChanges?.();
  const rejectAll = () => editorApi.current?.rejectAllChanges?.();

  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, changes.length - 1));
    setActiveIdx(clamped);
    const change = changes[clamped];
    if (change) editorApi.current?.scrollToPos(change.from);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-ui)" }}>
      {/* Header */}
      <div style={{ padding: "0.75rem 1rem 0.5rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: changes.length > 0 ? "0.5rem" : 0 }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem", flex: 1 }}>
            Track changes
            {changes.length > 0 && (
              <span style={{ marginLeft: "0.4rem", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", borderRadius: "999px", padding: "0 0.4rem", fontSize: "0.72rem", fontWeight: 700 }}>
                {changes.length}
              </span>
            )}
          </span>
          {/* Prev / Next navigation */}
          {changes.length > 1 && (
            <div style={{ display: "flex", gap: "2px" }}>
              <NavBtn label="↑" title="Previous change" onClick={() => goTo(activeIdx - 1)} disabled={activeIdx === 0} />
              <NavBtn label="↓" title="Next change" onClick={() => goTo(activeIdx + 1)} disabled={activeIdx >= changes.length - 1} />
            </div>
          )}
        </div>
        {changes.length > 0 && (
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button onClick={acceptAll} style={bulkBtn("#16a34a")}>Accept all</button>
            <button onClick={rejectAll} style={bulkBtn("#dc2626")}>Reject all</button>
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.4rem 0" }}>
        {changes.length === 0 ? (
          <div style={{ padding: "2rem 1rem", textAlign: "center", color: "color-mix(in srgb, var(--fg) 40%, transparent)", fontSize: "0.8rem" }}>
            {enabled ? "No pending changes" : "Enable track changes to start tracking edits"}
          </div>
        ) : (
          changes.map((change, i) => (
            <ChangeRow
              key={change.id}
              change={change}
              active={i === activeIdx}
              onClick={() => goTo(i)}
              onAccept={accept}
              onReject={reject}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ChangeRow({
  change, active, onClick, onAccept, onReject,
}: {
  change: TrackedChangeEntry;
  active: boolean;
  onClick: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const color = authorTrackColor(change.authorId);
  const label = change.type === "insert" ? "Inserted" : change.type === "delete" ? "Deleted" : "Changed";
  const date = change.createdAt
    ? new Date(change.createdAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      onClick={onClick}
      style={{
        margin: "0.2rem 0.5rem",
        padding: "0.45rem 0.6rem",
        borderRadius: "6px",
        border: active
          ? `1.5px solid ${color}60`
          : "1.5px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        background: active ? `color-mix(in srgb, ${color} 5%, var(--bg))` : "var(--bg)",
        cursor: "pointer",
        transition: "background 80ms",
      }}
    >
      {/* Top row: badge + author dot + date */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.3rem" }}>
        <span style={{
          fontSize: "0.65rem", fontWeight: 700, color,
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          borderRadius: "3px", padding: "1px 5px",
          textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0,
        }}>{label}</span>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} title={change.authorId || "Unknown"} />
        {date && <span style={{ fontSize: "0.68rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)", marginLeft: "auto" }}>{date}</span>}
      </div>

      {/* Change text */}
      {change.text && (
        <div style={{
          fontSize: "0.78rem",
          color: "color-mix(in srgb, var(--fg) 80%, transparent)",
          fontStyle: change.type === "delete" ? "italic" : "normal",
          textDecoration: change.type === "delete" ? `line-through ${color}` : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: "0.35rem",
        }}>
          {change.text.length > 70 ? change.text.slice(0, 70) + "…" : change.text}
        </div>
      )}

      {/* Accept / Reject */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onAccept(change.id); }}
          style={actionBtn("#16a34a")}
        >✓ Accept</button>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onReject(change.id); }}
          style={actionBtn("#dc2626")}
        >✗ Reject</button>
      </div>
    </div>
  );
}

function NavBtn({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 22, height: 22, border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
        borderRadius: "4px", background: "none", cursor: disabled ? "default" : "pointer",
        color: disabled ? "color-mix(in srgb, var(--fg) 25%, transparent)" : "var(--fg)",
        fontSize: "0.8rem", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-ui)",
      }}
    >{label}</button>
  );
}

function bulkBtn(color: string): React.CSSProperties {
  return {
    flex: 1, padding: "0.25rem 0.5rem",
    border: `1px solid ${color}40`, borderRadius: "5px",
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    color, fontSize: "0.72rem", fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}

function actionBtn(color: string): React.CSSProperties {
  return {
    padding: "0.15rem 0.5rem",
    border: `1px solid ${color}35`, borderRadius: "4px",
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    color, fontSize: "0.7rem", fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}
