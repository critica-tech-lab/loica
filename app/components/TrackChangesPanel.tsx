import { useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { TrackedChangeEntry } from "~/components/editor/types";
import { authorTrackColor } from "~/components/editor/types";

export function TrackChangesPanel() {
  const { trackChangesState, editorApi } = useDocument();
  const [activeIdx, setActiveIdx] = useState(0);

  const changes = trackChangesState?.changes ?? [];
  const enabled = trackChangesState?.enabled ?? false;

  const toggle = () => editorApi.current?.toggleTrackChanges?.();
  const accept = (id: string) => editorApi.current?.acceptChangeById?.(id);
  const reject = (id: string) => editorApi.current?.rejectChangeById?.(id);
  const acceptAll = () => editorApi.current?.acceptAllChanges?.();
  const rejectAll = () => editorApi.current?.rejectAllChanges?.();

  const goTo = (idx: number) => {
    const i = Math.max(0, Math.min(idx, changes.length - 1));
    setActiveIdx(i);
    const c = changes[i];
    if (c) editorApi.current?.scrollToPos(c.from);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-ui)" }}>

      {/* Mode switcher — like Google Docs Editing / Suggesting */}
      <div style={{ padding: "0.75rem 0.75rem 0.6rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0 }}>
        <div style={{ display: "flex", background: "color-mix(in srgb, var(--fg) 6%, transparent)", borderRadius: "8px", padding: "3px", gap: "2px" }}>
          <ModeBtn label="✏ Editing" active={!enabled} onClick={() => { if (enabled) toggle(); }} />
          <ModeBtn label="📝 Suggesting" active={enabled} onClick={() => { if (!enabled) toggle(); }} />
        </div>
        {enabled && (
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.72rem", color: "color-mix(in srgb, var(--fg) 50%, transparent)", lineHeight: 1.4 }}>
            Your edits appear as suggestions. Others can accept or reject them.
          </p>
        )}
      </div>

      {/* Bulk actions + navigation */}
      {changes.length > 0 && (
        <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "color-mix(in srgb, var(--fg) 55%, transparent)", flex: 1 }}>
            {changes.length} pending
          </span>
          {changes.length > 1 && (
            <>
              <NavBtn label="↑" title="Previous" onClick={() => goTo(activeIdx - 1)} disabled={activeIdx === 0} />
              <NavBtn label="↓" title="Next" onClick={() => goTo(activeIdx + 1)} disabled={activeIdx >= changes.length - 1} />
            </>
          )}
          <button onClick={acceptAll} style={bulkBtn("#16a34a")}>✓ All</button>
          <button onClick={rejectAll} style={bulkBtn("#dc2626")}>✗ All</button>
        </div>
      )}

      {/* Change list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {changes.length === 0 ? (
          <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{enabled ? "✍" : "👁"}</div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--fg)", marginBottom: "0.25rem" }}>
              {enabled ? "Suggesting mode on" : "No tracked changes"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "color-mix(in srgb, var(--fg) 45%, transparent)", lineHeight: 1.5 }}>
              {enabled
                ? "Start typing — your edits will appear as suggestions."
                : "Switch to Suggesting mode to track edits, or edits from others will appear here."}
            </div>
          </div>
        ) : (
          changes.map((c, i) => (
            <ChangeCard
              key={c.id}
              change={c}
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

function ChangeCard({ change, active, onClick, onAccept, onReject }: {
  change: TrackedChangeEntry;
  active: boolean;
  onClick: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const color = authorTrackColor(change.authorId);
  const isInsert = change.type === "insert";
  const isDelete = change.type === "delete";
  const date = change.createdAt
    ? new Date(change.createdAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      onClick={onClick}
      style={{
        borderLeft: `3px solid ${active ? color : "transparent"}`,
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)",
        padding: "0.6rem 0.75rem 0.6rem 0.65rem",
        background: active ? `color-mix(in srgb, ${color} 4%, var(--bg))` : "var(--bg)",
        cursor: "pointer",
        transition: "background 100ms, border-color 100ms",
      }}
    >
      {/* Author row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.35rem" }}>
        <span style={{
          width: 20, height: 20, borderRadius: "50%", background: color,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: "0.6rem", fontWeight: 700, flexShrink: 0,
          userSelect: "none",
        }}>
          {(change.authorId || "?").slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {change.authorId || "Unknown"}
        </span>
        {date && (
          <span style={{ fontSize: "0.67rem", color: "color-mix(in srgb, var(--fg) 38%, transparent)", flexShrink: 0 }}>
            {date}
          </span>
        )}
      </div>

      {/* Change preview */}
      <div style={{
        fontSize: "0.78rem",
        marginBottom: "0.4rem",
        padding: "0.25rem 0.4rem",
        borderRadius: "4px",
        background: isInsert
          ? `color-mix(in srgb, ${color} 10%, transparent)`
          : isDelete
          ? "color-mix(in srgb, #dc2626 8%, transparent)"
          : "color-mix(in srgb, var(--fg) 5%, transparent)",
        borderLeft: `2px solid ${color}`,
      }}>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.35rem" }}>
          {isInsert ? "+" : isDelete ? "−" : "~"}
        </span>
        <span style={{
          color: "color-mix(in srgb, var(--fg) 80%, transparent)",
          textDecoration: isDelete ? `line-through ${color}` : "none",
          fontStyle: isDelete ? "italic" : "normal",
        }}>
          {change.text ? (change.text.length > 60 ? change.text.slice(0, 60) + "…" : change.text) : (isInsert ? "(paragraph break)" : "(node deleted)")}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onAccept(change.id); }}
          style={cardActionBtn("#16a34a")}
        >
          ✓ Accept
        </button>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onReject(change.id); }}
          style={cardActionBtn("#dc2626")}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}

function ModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "0.3rem 0.5rem",
        border: "none",
        borderRadius: "6px",
        background: active ? "var(--bg)" : "transparent",
        boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
        color: active ? "var(--fg)" : "color-mix(in srgb, var(--fg) 50%, transparent)",
        fontSize: "0.75rem",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        transition: "all 100ms",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function NavBtn({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 24,
        border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
        borderRadius: "4px", background: "none",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "color-mix(in srgb, var(--fg) 25%, transparent)" : "var(--fg)",
        fontSize: "0.8rem",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-ui)",
      }}
    >{label}</button>
  );
}

function bulkBtn(color: string): React.CSSProperties {
  return {
    padding: "0.2rem 0.5rem",
    border: `1px solid ${color}35`, borderRadius: "5px",
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    color, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}

function cardActionBtn(color: string): React.CSSProperties {
  return {
    padding: "0.18rem 0.55rem",
    border: `1px solid ${color}30`,
    borderRadius: "4px",
    background: `color-mix(in srgb, ${color} 7%, transparent)`,
    color, fontSize: "0.7rem", fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}
