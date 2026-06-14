import { useState, useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { TrackedChangeEntry } from "~/components/editor/types";
import { authorTrackColor } from "~/components/editor/types";

export function TrackChangesPanel() {
  const { trackChangesState, editorApi } = useDocument();
  const [activeIdx, setActiveIdx] = useState(0);
  const [showMarkup, setShowMarkupState] = useState(true);

  const changes = trackChangesState?.changes ?? [];
  const enabled = trackChangesState?.enabled ?? false;

  const toggle = () => editorApi.current?.toggleTrackChanges?.();
  const acceptAll = () => editorApi.current?.acceptAllChanges?.();
  const rejectAll = () => editorApi.current?.rejectAllChanges?.();

  const toggleMarkup = () => {
    const next = !showMarkup;
    setShowMarkupState(next);
    editorApi.current?.setShowMarkup?.(next);
  };

  // Clamp activeIdx when changes shrink (after accept/reject)
  useEffect(() => {
    if (changes.length > 0 && activeIdx >= changes.length) {
      const next = changes.length - 1;
      setActiveIdx(next);
      editorApi.current?.scrollToPos(changes[next].from);
    }
  }, [changes.length]);

  const scrollTo = (idx: number) => {
    const i = Math.max(0, Math.min(idx, changes.length - 1));
    setActiveIdx(i);
    const c = changes[i];
    if (c) editorApi.current?.scrollToPos(c.from);
  };

  const acceptAndNext = (id: string) => {
    editorApi.current?.acceptChangeById?.(id);
    // After accept, the array shrinks; same index → next item automatically
    // Scroll will be handled by the useEffect above if needed
  };

  const rejectAndNext = (id: string) => {
    editorApi.current?.rejectChangeById?.(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-ui)" }}>

      {/* Mode switcher */}
      <div style={{ padding: "0.75rem 0.75rem 0.6rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0 }}>
        <div style={{ display: "flex", background: "color-mix(in srgb, var(--fg) 6%, transparent)", borderRadius: "8px", padding: "3px", gap: "2px", marginBottom: "0.5rem" }}>
          <ModeBtn label="✏ Editing" active={!enabled} onClick={() => { if (enabled) toggle(); }} />
          <ModeBtn label="📝 Suggesting" active={enabled} onClick={() => { if (!enabled) toggle(); }} />
        </div>

        {/* Show markup toggle */}
        <button
          onClick={toggleMarkup}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.25rem 0.4rem",
            border: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
            borderRadius: "6px",
            background: showMarkup ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
            color: showMarkup ? "var(--accent)" : "color-mix(in srgb, var(--fg) 55%, transparent)",
            fontSize: "0.74rem",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "var(--font-ui)",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: "0.9rem" }}>{showMarkup ? "👁" : "👁‍🗨"}</span>
          {showMarkup ? "Showing markup" : "Markup hidden (final view)"}
        </button>

        {enabled && (
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.72rem", color: "color-mix(in srgb, var(--fg) 50%, transparent)", lineHeight: 1.4 }}>
            Your edits appear as suggestions. Others can accept or reject them.
          </p>
        )}
      </div>

      {/* Navigation + bulk actions */}
      {changes.length > 0 && (
        <div style={{ padding: "0.35rem 0.75rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.74rem", color: "color-mix(in srgb, var(--fg) 55%, transparent)", flex: 1 }}>
            {activeIdx + 1} / {changes.length}
          </span>
          {changes.length > 1 && (
            <>
              <NavBtn label="↑" title="Previous change (navigate without accepting)" onClick={() => scrollTo(activeIdx - 1)} disabled={activeIdx === 0} />
              <NavBtn label="↓" title="Next change" onClick={() => scrollTo(activeIdx + 1)} disabled={activeIdx >= changes.length - 1} />
            </>
          )}
          <button onClick={acceptAll} style={bulkBtn("#16a34a")} title="Accept all changes">✓ All</button>
          <button onClick={rejectAll} style={bulkBtn("#dc2626")} title="Reject all changes">✗ All</button>
        </div>
      )}

      {/* Change list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {changes.length === 0 ? (
          <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{enabled ? "✍" : "👁"}</div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--fg)", marginBottom: "0.25rem" }}>
              {enabled ? "Suggesting mode on" : "No pending changes"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "color-mix(in srgb, var(--fg) 45%, transparent)", lineHeight: 1.5 }}>
              {enabled
                ? "Start typing — your edits will appear as suggestions."
                : "Switch to Suggesting to track edits."}
            </div>
          </div>
        ) : (
          changes.map((c, i) => (
            <ChangeCard
              key={c.id}
              change={c}
              active={i === activeIdx}
              onClick={() => scrollTo(i)}
              onAccept={acceptAndNext}
              onReject={rejectAndNext}
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
          width: 20, height: 20, borderRadius: "50%", background: color, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: "0.6rem", fontWeight: 700, userSelect: "none",
        }}>
          {(change.authorId || "?").slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontSize: "0.74rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {change.authorId || "Unknown"}
        </span>
        {date && (
          <span style={{ fontSize: "0.67rem", color: "color-mix(in srgb, var(--fg) 38%, transparent)", flexShrink: 0 }}>{date}</span>
        )}
      </div>

      {/* Diff preview */}
      <div style={{
        fontSize: "0.78rem", marginBottom: "0.4rem",
        padding: "0.25rem 0.4rem", borderRadius: "4px",
        background: isInsert ? `color-mix(in srgb, ${color} 10%, transparent)` : isDelete ? "color-mix(in srgb, #dc2626 8%, transparent)" : "color-mix(in srgb, var(--fg) 5%, transparent)",
        borderLeft: `2px solid ${color}`,
      }}>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.35rem" }}>
          {isInsert ? "+" : isDelete ? "−" : "~"}
        </span>
        <span style={{ color: "color-mix(in srgb, var(--fg) 80%, transparent)", textDecoration: isDelete ? `line-through ${color}` : "none", fontStyle: isDelete ? "italic" : "normal" }}>
          {change.text ? (change.text.length > 60 ? change.text.slice(0, 60) + "…" : change.text) : isInsert ? "(paragraph break)" : "(node deleted)"}
        </span>
      </div>

      {/* Accept and Move to Next / Reject */}
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onAccept(change.id); }}
          style={cardActionBtn("#16a34a")}
          title="Accept and move to next"
        >
          ✓ Accept
        </button>
        <button
          onMouseDown={(e) => { e.stopPropagation(); onReject(change.id); }}
          style={cardActionBtn("#dc2626")}
          title="Reject and move to next"
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}

function ModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "0.3rem 0.5rem", border: "none", borderRadius: "6px",
      background: active ? "var(--bg)" : "transparent",
      boxShadow: active ? "var(--shadow-sm)" : "none",
      color: active ? "var(--fg)" : "color-mix(in srgb, var(--fg) 50%, transparent)",
      fontSize: "0.75rem", fontWeight: active ? 600 : 400, cursor: "pointer",
      fontFamily: "var(--font-ui)", transition: "all 100ms", whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

function NavBtn({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      width: 24, height: 24, border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
      borderRadius: "4px", background: "none", cursor: disabled ? "default" : "pointer",
      color: disabled ? "color-mix(in srgb, var(--fg) 25%, transparent)" : "var(--fg)",
      fontSize: "0.8rem", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-ui)",
    }}>{label}</button>
  );
}

function bulkBtn(color: string): React.CSSProperties {
  return { padding: "0.2rem 0.5rem", border: `1px solid ${color}35`, borderRadius: "5px", background: `color-mix(in srgb, ${color} 8%, transparent)`, color, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
}

function cardActionBtn(color: string): React.CSSProperties {
  return { padding: "0.18rem 0.55rem", border: `1px solid ${color}30`, borderRadius: "4px", background: `color-mix(in srgb, ${color} 7%, transparent)`, color, fontSize: "0.7rem", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" };
}
