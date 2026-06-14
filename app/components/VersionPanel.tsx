import { useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { useToast } from "~/components/Toast";
import { timeAgo } from "~/lib/ui-utils";
import { useDocument } from "~/lib/DocumentContext";
import { menuItemHighlight } from "~/lib/popover-styles";
import type { DocumentVersionSummary, DocumentVersion, UpdateSession } from "~/lib/document.server";

interface VersionPanelProps {
  docId: string;
  onClose: () => void;
  onRestore: (versionId: string) => void;
  onSaveVersion: () => void;
  inline?: boolean;
}

type HistoryRow =
  | { type: "session"; session: UpdateSession; sessionId: string }
  | { type: "version"; version: DocumentVersionSummary };

export function VersionPanel({
  docId,
  onClose,
  onRestore,
  onSaveVersion,
  inline = false,
}: VersionPanelProps) {
  const historyFetcher = useFetcher<{ sessions: UpdateSession[] }>();
  const versionsFetcher = useFetcher<{ versions: DocumentVersionSummary[] }>();
  const versionFetcher = useFetcher<{ version: DocumentVersion }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast } = useToast();
  const { setHistoryPreview, content: currentContent } = useDocument();

  // Load on mount, poll every 15s
  useEffect(() => {
    historyFetcher.load(`/api/doc-history/${docId}`);
    versionsFetcher.load(`/api/doc-versions/${docId}`);
    const interval = setInterval(() => {
      historyFetcher.load(`/api/doc-history/${docId}`);
      versionsFetcher.load(`/api/doc-versions/${docId}`);
    }, 15_000);
    return () => clearInterval(interval);
  }, [docId]);

  const sessions = historyFetcher.data?.sessions ?? [];
  const versions = versionsFetcher.data?.versions ?? [];
  const previewVersion = versionFetcher.data?.version;

  // Show sessions (attributed edits) + manual saves only.
  // Auto-saves are internal baselines for diffs — not user-meaningful rows.
  const rows: HistoryRow[] = [];

  for (const session of sessions) {
    rows.push({
      type: "session",
      session,
      sessionId: `s-${session.startedAt}-${session.userId ?? "anon"}`,
    });
  }

  for (const v of versions) {
    if (!v.auto) {
      rows.push({ type: "version", version: v });
    }
  }

  rows.sort((a, b) => {
    const timeA = a.type === "session" ? a.session.endedAt : a.version.created_at;
    const timeB = b.type === "session" ? b.session.endedAt : b.version.created_at;
    return timeB - timeA;
  });

  // Find selected row (could be session or version)
  const selectedSession = selectedId?.startsWith("s-")
    ? sessions.find(s => `s-${s.startedAt}-${s.userId ?? "anon"}` === selectedId)
    : null;

  const selectedVersion = !selectedId?.startsWith("s-")
    ? versions.find(v => v.id === selectedId)
    : null;

  // Session selected: diff is already in the session object (contentBefore/contentAfter)
  useEffect(() => {
    if (!selectedSession) {
      if (!selectedVersion) setHistoryPreview(null);
      return;
    }
    setHistoryPreview({
      content: selectedSession.contentAfter,
      title: "",
      label: `${timeAgo(selectedSession.endedAt)} · ${selectedSession.updateCount} edit${selectedSession.updateCount !== 1 ? "s" : ""} by ${selectedSession.userName || "Anonymous"}`,
      currentContent: selectedSession.contentBefore,
      yjsState: undefined,
      versionId: selectedSession.snapshotVersionId ?? undefined,
    });
  }, [selectedId, selectedSession]);

  // Version selected: load it, then publish preview
  useEffect(() => {
    if (!selectedVersion) return;
    if (previewVersion?.id === selectedVersion.id) return;
    versionFetcher.load(`/api/doc-versions/${docId}?versionId=${selectedVersion.id}`);
  }, [selectedId, docId, selectedVersion]);

  // Publish preview for manual version
  useEffect(() => {
    if (!selectedVersion || !previewVersion || previewVersion.id !== selectedVersion.id) return;
    setHistoryPreview({
      content: previewVersion.content,
      title: previewVersion.title,
      label: `${timeAgo(selectedVersion.created_at)} · ${
        selectedVersion.auto ? "auto-save" : (selectedVersion.creator_name ?? "manual save")
      }`,
      currentContent,
      yjsState: previewVersion.yjs_state ?? undefined,
      versionId: selectedVersion.id,
    });
  }, [selectedId, previewVersion?.id, currentContent, selectedVersion]);

  // Clear on unmount
  useEffect(() => () => setHistoryPreview(null), []);

  function handleSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id);
  }

  function handleRestore() {
    if (!selectedVersion) return;
    if (!confirm("Restore this version? Current content will be overwritten.")) return;
    onRestore(selectedVersion.id);
    setSelectedId(null);
  }

  function handleSave() {
    onSaveVersion();
    toast("Version saved", "success");
    setTimeout(() => versionsFetcher.load(`/api/doc-versions/${docId}`), 500);
  }

  return (
    <div style={inline ? inlinePanelStyle : panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>Version history</span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-2xl)", opacity: 0.5, padding: "0 2px", color: "var(--fg)" }}
        >×</button>
      </div>

      {/* Save button */}
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)" }}>
        <button onClick={handleSave} style={saveBtnStyle}>
          Save current version
        </button>
      </div>

      {/* History list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {historyFetcher.state === "loading" && rows.length === 0 && (
          <div style={{ padding: "1rem 0.75rem", fontSize: "var(--text-base)", opacity: 0.4 }}>Loading…</div>
        )}
        {historyFetcher.state !== "loading" && rows.length === 0 && (
          <div style={{ padding: "1rem 0.75rem", fontSize: "var(--text-base)", opacity: 0.4 }}>
            No saved versions yet. Versions are saved automatically every minute while editing.
          </div>
        )}

        {/* "Now" row — always at top, deselects */}
        {rows.length > 0 && (
          <button
            onClick={() => setSelectedId(null)}
            style={{
              ...rowStyle,
              background: selectedId === null ? "color-mix(in srgb, var(--fg) 7%, transparent)" : "transparent",
              borderBottom: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>Current version</span>
            <span style={badgeStyle("live")}>live</span>
          </button>
        )}

        {rows.map((row) => {
          const rowId = row.type === "session" ? row.sessionId : row.version.id;
          const isSelected = selectedId === rowId;
          const isVersionLoading = isSelected && row.type === "version" && versionFetcher.state === "loading";

          if (row.type === "session") {
            const { session } = row;
            return (
              <button
                key={rowId}
                onClick={() => handleSelect(rowId)}
                style={{
                  ...rowStyle,
                  ...menuItemHighlight(isSelected),
                  paddingLeft: "calc(0.75rem - 2px)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: "var(--text-base)", fontWeight: isSelected ? 600 : 400 }}>
                    {session.userName || "Anonymous"}
                  </span>
                  <span style={{ fontSize: "var(--text-sm)", opacity: 0.45, marginLeft: "0.4rem" }}>
                    {timeAgo(session.endedAt)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                  {isSelected && (
                    <span style={{ fontSize: "var(--text-2xs)", opacity: 0.55, color: "var(--accent)" }}>preview ↗</span>
                  )}
                  <span style={{ fontSize: "var(--text-xs)", opacity: 0.45 }}>
                    {session.updateCount} edit{session.updateCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </button>
            );
          } else {
            const { version } = row;
            return (
              <button
                key={rowId}
                onClick={() => handleSelect(rowId)}
                style={{
                  ...rowStyle,
                  ...menuItemHighlight(isSelected),
                  paddingLeft: "calc(0.75rem - 2px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
                  <span style={{ fontSize: "var(--text-base)", fontWeight: isSelected ? 600 : 400, color: "var(--fg)" }}>
                    {timeAgo(version.created_at)}
                  </span>
                  {isVersionLoading && <span style={{ fontSize: "var(--text-xs)", opacity: 0.5 }}>loading…</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                  {version.creator_name && !version.auto && (
                    <span style={{ fontSize: "var(--text-xs)", opacity: 0.55, maxWidth: "6rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {version.creator_name}
                    </span>
                  )}
                  <span style={badgeStyle(version.auto ? "auto" : "manual")}>
                    {version.auto ? "auto" : "saved"}
                  </span>
                </div>
              </button>
            );
          }
        })}
      </div>

      {/* Restore footer (only for manual versions) */}
      {selectedVersion && (
        <div style={{ padding: "0.75rem", borderTop: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0 }}>
          <button onClick={handleRestore} style={restoreBtnStyle}>
            Restore this version
          </button>
          <p style={{ margin: "0.4rem 0 0", fontSize: "var(--text-xs)", opacity: 0.5, lineHeight: 1.4 }}>
            Current content will be overwritten. A backup is saved automatically before restoring.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "var(--nav-h, 3rem)",
  right: 0,
  bottom: 0,
  width: "min(20rem, 90vw)",
  background: "var(--bg)",
  borderLeft: "1.5px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  zIndex: "var(--z-panel)",
  boxShadow: "-4px 0 16px color-mix(in srgb, var(--fg) 6%, transparent)",
};

const inlinePanelStyle: React.CSSProperties = {
  width: "min(20rem, 35vw)",
  flexShrink: 0,
  background: "var(--bg)",
  borderLeft: "1.5px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem",
  borderBottom: "1.5px solid color-mix(in srgb, var(--fg) 10%, transparent)",
};

const rowStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.55rem 0.75rem",
  border: "none",
  borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)",
  cursor: "pointer",
  textAlign: "left",
  color: "var(--fg)",
  transition: "background 80ms ease-out",
  fontFamily: "var(--font-ui)",
  gap: "0.5rem",
};

const saveBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  width: "100%",
  padding: "0.4rem 0.5rem",
  background: "color-mix(in srgb, var(--fg) 8%, transparent)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "0",
  color: "var(--fg)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
};

const restoreBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  width: "100%",
  padding: "0.4rem 0.5rem",
  background: "var(--accent)",
  border: "none",
  borderRadius: "0",
  color: "var(--bg)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
};

function badgeStyle(type: "auto" | "manual" | "live" | "session"): React.CSSProperties {
  const colors: Record<string, string> = {
    auto: "color-mix(in srgb, var(--fg) 12%, transparent)",
    manual: "color-mix(in srgb, var(--color-sage) 25%, transparent)",
    live: "color-mix(in srgb, var(--color-blue) 20%, transparent)",
    session: "color-mix(in srgb, var(--color-orange) 20%, transparent)",
  };
  return {
    fontSize: "var(--text-2xs)",
    padding: "1px 5px",
    background: colors[type],
    color: "var(--fg)",
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-ui)",
    letterSpacing: "0.02em",
    flexShrink: 0,
  };
}
