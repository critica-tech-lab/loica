import { useState, useEffect, useRef } from "react";
import { useOptionalDocument } from "~/lib/DocumentContext";
import type { PMActiveState, TrackChangesActiveState, EditingMode } from "./editor/types";

interface Props {
  activeState: PMActiveState | null;
  trackChangesState?: TrackChangesActiveState | null;
  editingMode?: EditingMode;
  onLink?: () => void;
  onImageUpload?: (file: File) => void;
  onOpenChangesPanel?: () => void;
  onModeChange?: (mode: EditingMode) => void;
}

export function PMToolbar({ activeState, trackChangesState, editingMode = "editing", onLink, onImageUpload, onOpenChangesPanel, onModeChange }: Props) {
  const ctx = useOptionalDocument();
  const api = ctx?.editorApi.current;
  const canEdit = ctx?.canEdit ?? false;

  if (!canEdit) return null;

  const active = activeState;

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
    api?.focus?.();
  };

  const fmt = (before: string, after = before) =>
    run(() => api?.format(before, after));

  const imgUpload = onImageUpload ?? (canEdit ? (file: File) => api?.uploadImage?.(file) : undefined);

  const blockType = active?.heading ? `h${active.heading}` : "p";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0.2rem 1rem",
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        flexShrink: 0,
        flexWrap: "wrap",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      {/* Inline marks */}
      <Btn title="Bold (Ctrl+B)" active={active?.strong} style={{ fontWeight: 700 }} onActivate={fmt("**")}>B</Btn>
      <Btn title="Italic (Ctrl+I)" active={active?.em} style={{ fontStyle: "italic" }} onActivate={fmt("*")}>I</Btn>
      <Btn title="Underline (Ctrl+U)" active={active?.underline} style={{ textDecoration: "underline", textUnderlineOffset: 2 }} onActivate={fmt("__")}>U</Btn>
      <Btn title="Strikethrough (Ctrl+Shift+X)" active={active?.strikethrough} style={{ textDecoration: "line-through" }} onActivate={fmt("~~")}>S</Btn>
      <Btn title="Inline code (Ctrl+`)" active={active?.code} style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em" }} onActivate={fmt("`")}>{"<>"}</Btn>

      <Sep />

      {/* Highlight + Link */}
      <Btn
        title="Highlight"
        active={false}
        onActivate={fmt("{==", "==}")}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l6 6" />
            <path d="M4 20l4-1 11-11-3-3-11 11z" />
            <line x1="14" y1="6" x2="18" y2="10" />
          </svg>
        }
      />
      <Btn title="Link (Ctrl+K)" active={false} onActivate={run(() => onLink?.())} style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>Link</Btn>

      <Sep />

      {/* Headings */}
      <Btn title="Heading 1 (Ctrl+Alt+1)" active={blockType === "h1"} style={{ fontWeight: 700, fontSize: "0.95rem" }} onActivate={run(() => api?.setHeading?.(1))}>H1</Btn>
      <Btn title="Heading 2 (Ctrl+Alt+2)" active={blockType === "h2"} style={{ fontWeight: 700, fontSize: "0.88rem" }} onActivate={run(() => api?.setHeading?.(2))}>H2</Btn>
      <Btn title="Heading 3 (Ctrl+Alt+3)" active={blockType === "h3"} style={{ fontWeight: 700, fontSize: "0.8rem" }} onActivate={run(() => api?.setHeading?.(3))}>H3</Btn>
      <Btn title="Heading 4 (Ctrl+Alt+4)" active={blockType === "h4"} style={{ fontWeight: 700, fontSize: "0.75rem" }} onActivate={run(() => api?.setHeading?.(4))}>H4</Btn>

      <Sep />

      {/* Lists + Blockquote */}
      <Btn
        title="Bullet list"
        active={active?.inBulletList}
        onActivate={run(() => api?.toggleBulletList?.())}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="9" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="9" y1="18" x2="21" y2="18" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        }
      />
      <Btn
        title="Ordered list"
        active={active?.inOrderedList}
        onActivate={run(() => api?.toggleOrderedList?.())}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="11" y1="6" x2="21" y2="6" /><line x1="11" y1="12" x2="21" y2="12" /><line x1="11" y1="18" x2="21" y2="18" />
            <text x="2" y="8" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">1</text>
            <text x="2" y="14.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">2</text>
            <text x="2" y="21" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">3</text>
          </svg>
        }
      />
      <Btn title="Blockquote" active={active?.inBlockquote} style={{ fontSize: "1rem", fontWeight: 700, opacity: active?.inBlockquote ? 1 : 0.6 }} onActivate={run(() => api?.toggleBlockquote?.())}>&#8220;</Btn>

      <Sep />

      {/* Insert: Table, HR, Image */}
      <Btn
        title="Insert table"
        active={false}
        onActivate={run(() => api?.insertTable?.())}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
        }
      />
      <Btn title="Horizontal rule" active={false} onActivate={run(() => api?.insertHr?.())} style={{ letterSpacing: "-1px" }}>{"—"}</Btn>
      {imgUpload && (
        <Btn
          title="Upload image"
          active={false}
          onActivate={run(() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
            input.onchange = () => { const f = input.files?.[0]; if (f) imgUpload(f); };
            input.click();
          })}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          }
        />
      )}

      <Sep />

      {/* Editing mode dropdown — Google Docs style */}
      <ModeDropdown mode={editingMode} onModeChange={onModeChange} onOpenChangesPanel={onOpenChangesPanel} />
    </div>
  );
}

function Sep() {
  return (
    <span
      aria-hidden
      style={{
        width: "1px",
        height: "1.1rem",
        background: "color-mix(in srgb, var(--fg) 15%, transparent)",
        margin: "0 0.25rem",
        flexShrink: 0,
      }}
    />
  );
}

function Btn({
  children,
  icon,
  title,
  active,
  style,
  onActivate,
}: {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
  active?: boolean;
  style?: React.CSSProperties;
  onActivate: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="toolbar-btn"
      onMouseDown={onActivate}
      style={{
        background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : undefined,
        color: active ? "var(--accent)" : undefined,
        boxShadow: active ? "inset 0 -2px 0 var(--accent)" : undefined,
        borderRadius: active ? "var(--radius-md) var(--radius-md) 2px 2px" : undefined,
        ...style,
      }}
    >
      {icon ?? children}
    </button>
  );
}

const MODE_META: Record<EditingMode, { label: string; icon: string; color?: string }> = {
  editing:    { label: "Editing",    icon: "✏" },
  suggesting: { label: "Suggesting", icon: "💬", color: "#16a34a" },
  viewing:    { label: "Viewing",    icon: "👁" },
};

function ModeDropdown({ mode, onModeChange, onOpenChangesPanel }: {
  mode: EditingMode;
  onModeChange?: (m: EditingMode) => void;
  onOpenChangesPanel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const meta = MODE_META[mode];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (m: EditingMode) => {
    setOpen(false);
    onModeChange?.(m);
    if (m === "suggesting") onOpenChangesPanel?.();
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.18rem 0.45rem",
          border: `1px solid ${meta.color ? meta.color + "50" : "color-mix(in srgb, var(--fg) 14%, transparent)"}`,
          borderRadius: "6px",
          background: meta.color ? `color-mix(in srgb, ${meta.color} 10%, transparent)` : "transparent",
          color: meta.color ?? "var(--fg)",
          fontSize: "0.75rem",
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          transition: "background 100ms",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ fontSize: "0.8rem" }}>{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ fontSize: "0.6rem", opacity: 0.6, marginLeft: "1px" }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 160,
            background: "var(--bg)",
            border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 100,
            overflow: "hidden",
            fontFamily: "var(--font-ui)",
          }}
        >
          {(["editing", "suggesting", "viewing"] as EditingMode[]).map((m) => {
            const item = MODE_META[m];
            const active = m === mode;
            return (
              <button
                key={m}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => { e.preventDefault(); select(m); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  padding: "0.5rem 0.75rem",
                  border: "none",
                  background: active ? "color-mix(in srgb, var(--fg) 5%, transparent)" : "transparent",
                  color: item.color ?? "var(--fg)",
                  fontSize: "0.8rem",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-ui)",
                  transition: "background 80ms",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 6%, transparent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? "color-mix(in srgb, var(--fg) 5%, transparent)" : "transparent"; }}
              >
                <span style={{ fontSize: "0.9rem", width: 18, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {active && <span style={{ fontSize: "0.75rem", color: "var(--accent)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
