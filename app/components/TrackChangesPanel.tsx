import { useDocument } from "~/lib/DocumentContext";
import type { TrackedChangeEntry } from "~/components/editor/types";

export function TrackChangesPanel() {
  const { trackChangesState, editorApi } = useDocument();

  const changes = trackChangesState?.changes ?? [];
  const enabled = trackChangesState?.enabled ?? false;

  const accept = (id: string) => editorApi.current?.acceptChangeById?.(id);
  const reject = (id: string) => editorApi.current?.rejectChangeById?.(id);
  const acceptAll = () => editorApi.current?.acceptAllChanges?.();
  const rejectAll = () => editorApi.current?.rejectAllChanges?.();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-ui)" }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem 0.5rem",
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            Track changes
            {changes.length > 0 && (
              <span style={{
                marginLeft: "0.4rem",
                background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                color: "var(--accent)",
                borderRadius: "999px",
                padding: "0 0.4rem",
                fontSize: "0.72rem",
                fontWeight: 700,
              }}>{changes.length}</span>
            )}
          </span>
          {!enabled && (
            <span style={{ fontSize: "0.72rem", color: "color-mix(in srgb, var(--fg) 45%, transparent)" }}>
              Tracking off
            </span>
          )}
        </div>
        {changes.length > 0 && (
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
            <button
              onClick={acceptAll}
              style={bulkBtnStyle("#16a34a")}
            >
              Accept all
            </button>
            <button
              onClick={rejectAll}
              style={bulkBtnStyle("#dc2626")}
            >
              Reject all
            </button>
          </div>
        )}
      </div>

      {/* Change list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
        {changes.length === 0 ? (
          <div style={{
            padding: "2rem 1rem",
            textAlign: "center",
            color: "color-mix(in srgb, var(--fg) 40%, transparent)",
            fontSize: "0.8rem",
          }}>
            {enabled ? "No pending changes" : "Enable track changes to start tracking edits"}
          </div>
        ) : (
          changes.map((change) => (
            <ChangeRow key={change.id} change={change} onAccept={accept} onReject={reject} />
          ))
        )}
      </div>
    </div>
  );
}

function ChangeRow({
  change,
  onAccept,
  onReject,
}: {
  change: TrackedChangeEntry;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const label = change.type === "insert" ? "Inserted" : change.type === "delete" ? "Deleted" : "Changed";
  const color = change.type === "insert" ? "#15803d" : change.type === "delete" ? "#b91c1c" : "var(--fg)";
  const bg = change.type === "insert" ? "rgba(34,197,94,0.08)" : change.type === "delete" ? "rgba(239,68,68,0.08)" : "transparent";

  return (
    <div style={{
      margin: "0.25rem 0.5rem",
      padding: "0.5rem 0.6rem",
      borderRadius: "6px",
      background: bg,
      border: `1px solid ${change.type === "insert" ? "rgba(34,197,94,0.2)" : change.type === "delete" ? "rgba(239,68,68,0.2)" : "color-mix(in srgb, var(--fg) 10%, transparent)"}`,
      fontSize: "0.8rem",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem", marginBottom: "0.4rem" }}>
        <span style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          color,
          background: `${color}18`,
          borderRadius: "3px",
          padding: "1px 5px",
          flexShrink: 0,
          marginTop: "1px",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}>
          {label}
        </span>
        {change.text && (
          <span style={{
            color: "color-mix(in srgb, var(--fg) 80%, transparent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            fontStyle: change.type === "delete" ? "italic" : "normal",
            textDecoration: change.type === "delete" ? "line-through" : "none",
            textDecorationColor: "#dc2626",
          }}>
            {change.text.length > 80 ? change.text.slice(0, 80) + "…" : change.text}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button onClick={() => onAccept(change.id)} style={actionBtnStyle("#16a34a")}>
          ✓ Accept
        </button>
        <button onClick={() => onReject(change.id)} style={actionBtnStyle("#dc2626")}>
          ✗ Reject
        </button>
      </div>
    </div>
  );
}

function bulkBtnStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "0.25rem 0.5rem",
    border: `1px solid ${color}40`,
    borderRadius: "5px",
    background: `${color}10`,
    color,
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "0.15rem 0.5rem",
    border: `1px solid ${color}40`,
    borderRadius: "4px",
    background: `${color}0d`,
    color,
    fontSize: "0.7rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };
}
