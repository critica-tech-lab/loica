import { useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { useToast } from "~/components/Toast";
import { timeAgo } from "~/lib/ui-utils";
import { useDocument } from "~/lib/DocumentContext";
import type { DocumentVersionSummary, DocumentVersion } from "~/lib/document.server";

interface VersionPanelProps {
  docId: string;
  onClose: () => void;
  onRestore: (versionId: string) => void;
  onSaveVersion: () => void;
  inline?: boolean;
}

export function VersionPanel({
  docId,
  onClose,
  onRestore,
  onSaveVersion,
  inline = false,
}: VersionPanelProps) {
  const listFetcher = useFetcher<{ versions: DocumentVersionSummary[] }>();
  const versionFetcher = useFetcher<{ version: DocumentVersion }>();
  // scrubberPos: 0 = oldest, versions.length = Now (rightmost, default).
  // Stored as a fraction so it survives the list growing from polling.
  const [scrubberPos, setScrubberPos] = useState(-1);
  const { toast } = useToast();
  const { setHistoryPreview, content: currentContent } = useDocument();

  // Load version list on mount and when docId changes,
  // then poll every 15s so auto-saves show up without reopening the panel.
  useEffect(() => {
    listFetcher.load(`/api/doc-versions/${docId}`);
    const interval = setInterval(() => {
      listFetcher.load(`/api/doc-versions/${docId}`);
    }, 15_000);
    return () => clearInterval(interval);
  }, [docId]);

  const versions = listFetcher.data?.versions ?? [];
  // Default: anchor at "Now" (rightmost) until user moves the slider.
  const effectivePos = scrubberPos < 0 ? versions.length : scrubberPos;
  // Convert slider position → version index.
  // pos === versions.length → Now (no selected version)
  // pos === 0 → oldest
  // pos === k → versions[versions.length - 1 - k]
  const selectedVersion =
    effectivePos < versions.length
      ? versions[versions.length - 1 - effectivePos]
      : null;
  const previewVersion = versionFetcher.data?.version;

  // When the scrubber moves onto a version, fetch its content for the diff.
  useEffect(() => {
    if (!selectedVersion) {
      setHistoryPreview(null);
      return;
    }
    if (previewVersion && previewVersion.id === selectedVersion.id) return;
    versionFetcher.load(`/api/doc-versions/${docId}?versionId=${selectedVersion.id}`);
  }, [selectedVersion?.id, docId]);

  // Once the version content loads, publish it as the editor preview.
  useEffect(() => {
    if (!selectedVersion) return;
    if (!previewVersion || previewVersion.id !== selectedVersion.id) return;
    setHistoryPreview({
      content: previewVersion.content,
      title: previewVersion.title,
      label: `${timeAgo(selectedVersion.created_at)} · ${
        selectedVersion.auto ? "auto-save" : (selectedVersion.creator_name ?? "manual save")
      }`,
      currentContent,
    });
  }, [selectedVersion?.id, previewVersion?.id, currentContent]);

  // Clear the preview when the panel unmounts (user closes it).
  useEffect(() => {
    return () => setHistoryPreview(null);
  }, []);

  function handleRestore() {
    if (!selectedVersion) return;
    if (!confirm("Restore this version? Current content will be overwritten.")) return;
    onRestore(selectedVersion.id);
    // Post-restore toast (with Undo) fires from DocumentContext once the
    // fetcher completes and returns the backup version id.
    setScrubberPos(-1);
  }

  function handleSave() {
    onSaveVersion();
    toast("Version saved", "success");
    setTimeout(() => listFetcher.load(`/api/doc-versions/${docId}`), 500);
  }

  return (
    <div style={inline ? inlinePanelStyle : panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Version history</span>
        <button
          onClick={onClose}
          aria-label="Close version history"
          className="cursor-pointer border-none bg-transparent text-fg text-[1.2rem] px-1 opacity-50 transition-opacity hover:opacity-100"
        >&times;</button>
      </div>

      {/* Save button */}
      <div style={{ padding: "0 0.75rem 0.5rem" }}>
        <button onClick={handleSave} style={saveBtnStyle}>
          Save current version
        </button>
      </div>

      {/* Scrubber */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
        {versions.length === 0 && listFetcher.state === "loading" && (
          <div className="text-xs text-fg/40">Loading versions…</div>
        )}
        {versions.length === 0 && listFetcher.state === "idle" && (
          <div className="text-xs text-fg/40">No versions yet</div>
        )}
        {versions.length > 0 && (
          <>
            {/* Header: where you are */}
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-base font-semibold">
                {selectedVersion ? timeAgo(selectedVersion.created_at) : "Now"}
              </span>
              <span className="text-[0.68rem] text-fg/50">
                {selectedVersion
                  ? selectedVersion.auto
                    ? "auto-save"
                    : (selectedVersion.creator_name ?? "manual save")
                  : "current"}
              </span>
            </div>

            {/* Custom slider track */}
            <div className="relative h-6 select-none">
              {/* Base track */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-fg/10" />

              {/* Progress fill: from handle to the right (towards Now) */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent/20 transition-[left] duration-150"
                style={{
                  left: `${(effectivePos / versions.length) * 100}%`,
                  right: 0,
                }}
              />

              {/* Auto-save tick marks (visual only) */}
              {versions.length <= 60 &&
                versions.map((v, i) => {
                  if (!v.auto) return null;
                  const pos = versions.length - 1 - i;
                  const left = `${(pos / versions.length) * 100}%`;
                  return (
                    <div
                      key={v.id}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-2 bg-fg/25 pointer-events-none"
                      style={{ left }}
                    />
                  );
                })}

              {/* Manual-save dots (clickable) */}
              {versions.map((v, i) => {
                if (v.auto) return null;
                const pos = versions.length - 1 - i;
                const left = `${(pos / versions.length) * 100}%`;
                const isSelected = effectivePos === pos;
                return (
                  <button
                    key={v.id}
                    type="button"
                    title={`Manual save · ${timeAgo(v.created_at)}${v.creator_name ? ` · ${v.creator_name}` : ""}`}
                    onClick={() => setScrubberPos(pos)}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent ring-2 ring-bg cursor-pointer transition-transform z-20 hover:scale-125 ${
                      isSelected ? "scale-125" : ""
                    }`}
                    style={{ left }}
                  />
                );
              })}

              {/* Visible handle */}
              <div
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-bg border-2 border-accent pointer-events-none z-30 shadow-sm transition-[left] duration-150 ${
                  selectedVersion ? "ring-2 ring-accent/25" : ""
                }`}
                style={{ left: `${(effectivePos / versions.length) * 100}%` }}
              />

              {/* Invisible native range input drives interaction */}
              <input
                type="range"
                min={0}
                max={versions.length}
                step={1}
                value={effectivePos}
                onChange={(e) => setScrubberPos(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                aria-label="Scrub through version history"
              />
            </div>

            {/* Axis labels */}
            <div className="flex justify-between mt-2 text-[0.66rem] text-fg/50">
              <span>{timeAgo(versions[versions.length - 1].created_at)}</span>
              <span>Now</span>
            </div>

            {/* Legend */}
            <div className="flex gap-4 mt-3 text-xs text-fg/60">
              <span className="inline-flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-bg" />
                manual save
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-px h-3 bg-fg/40" />
                auto-save
              </span>
            </div>

            {/* Restore button + helper */}
            {selectedVersion && (
              <>
                <button
                  onClick={handleRestore}
                  className="mt-3 w-full px-2 py-1.5 rounded bg-accent text-accent-fg text-xs cursor-pointer hover:brightness-110 transition"
                >
                  Restore this version
                </button>
                <div className="mt-2 text-[0.68rem] text-fg/55 leading-relaxed">
                  The editor is showing this older version.{" "}
                  <span className="text-[color:color-mix(in_srgb,#22c55e_75%,transparent)]">Green</span>{" "}
                  = text that will come back,{" "}
                  <span className="text-[color:color-mix(in_srgb,#ef4444_75%,transparent)] line-through">red</span>{" "}
                  = text that will be lost. Drag back to "Now" to resume editing.
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "var(--nav-h, 3rem)",
  right: 0,
  bottom: 0,
  width: "min(22rem, 90vw)",
  background: "var(--bg)",
  borderLeft: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  zIndex: 50,
  boxShadow: "var(--shadow-sm)",
};

const inlinePanelStyle: React.CSSProperties = {
  width: "min(22rem, 35vw)",
  flexShrink: 0,
  background: "var(--bg)",
  borderLeft: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem",
  borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
};

const saveBtnStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  width: "100%",
  padding: "0.4rem 0.5rem",
  background: "color-mix(in srgb, var(--fg) 8%, transparent)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "4px",
  color: "var(--fg)",
  cursor: "pointer",
  transition: "background 150ms ease-out",
};


