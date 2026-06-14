import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useOptionalDocument } from "~/lib/DocumentContext";
import type { EditorApi } from "~/lib/DocumentContext";
import type { PMActiveState, TrackChangesActiveState, EditingMode } from "./editor/types";
import {
  HighlightIcon, BulletListIcon, OrderedListIcon, TableIcon, FootnoteIcon, ImageIcon,
  AlignLeftIcon, AlignCenterIcon, AlignRightIcon, AlignJustifyIcon,
  EditModeIcon, SuggestModeIcon, ViewModeIcon,
} from "./icons";

interface Props {
  activeState: PMActiveState | null;
  trackChangesState?: TrackChangesActiveState | null;
  editingMode?: EditingMode;
  onLink?: () => void;
  onImageUpload?: (file: File) => void;
  onOpenChangesPanel?: () => void;
  onModeChange?: (mode: EditingMode) => void;
  // Overrides for hosts without a DocumentProvider (e.g. the public share
  // edit view), which otherwise resolve canEdit=false and hide the toolbar.
  canEdit?: boolean;
  editorApiRef?: React.RefObject<EditorApi | null>;
}

export function PMToolbar({ activeState, trackChangesState, editingMode = "editing", onLink, onImageUpload, onOpenChangesPanel, onModeChange, canEdit: canEditProp, editorApiRef }: Props) {
  const ctx = useOptionalDocument();
  const api = editorApiRef?.current ?? ctx?.editorApi.current;
  const canEdit = canEditProp ?? ctx?.canEdit ?? false;

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
        active={active?.highlight}
        onActivate={fmt("{==", "==}")}
        icon={<HighlightIcon />}
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
        icon={<BulletListIcon />}
      />
      <Btn
        title="Ordered list"
        active={active?.inOrderedList}
        onActivate={run(() => api?.toggleOrderedList?.())}
        icon={<OrderedListIcon />}
      />
      <Btn title="Blockquote" active={active?.inBlockquote} style={{ fontSize: "1rem", fontWeight: 700, opacity: active?.inBlockquote ? 1 : 0.6 }} onActivate={run(() => api?.toggleBlockquote?.())}>&#8220;</Btn>

      <Sep />

      {/* Insert: Table, HR, Image */}
      <Btn
        title="Insert table"
        active={false}
        onActivate={run(() => api?.insertTable?.())}
        icon={<TableIcon />}
      />
      <Btn title="Horizontal rule" active={false} onActivate={run(() => api?.insertHr?.())} style={{ letterSpacing: "-1px" }}>{"—"}</Btn>
      <Btn
        title="Insert footnote"
        active={false}
        onActivate={run(() => api?.insertFootnote?.())}
        icon={<FootnoteIcon />}
      />
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
          icon={<ImageIcon />}
        />
      )}

      <Sep />

      {/* Text alignment */}
      <Btn title="Align left"    active={!active?.textAlign || active.textAlign === "left"}    onActivate={run(() => api?.setTextAlign?.(null))}         icon={<AlignLeftIcon />} />
      <Btn title="Align center"  active={active?.textAlign === "center"}                        onActivate={run(() => api?.setTextAlign?.("center"))}     icon={<AlignCenterIcon />} />
      <Btn title="Align right"   active={active?.textAlign === "right"}                         onActivate={run(() => api?.setTextAlign?.("right"))}      icon={<AlignRightIcon />} />
      <Btn title="Justify"       active={active?.textAlign === "justify"}                       onActivate={run(() => api?.setTextAlign?.("justify"))}    icon={<AlignJustifyIcon />} />

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

const MODE_META: Record<EditingMode, { label: string; icon: ReactNode; color?: string }> = {
  editing:    { label: "Editing",    icon: <EditModeIcon /> },
  suggesting: { label: "Suggesting", icon: <SuggestModeIcon />, color: "var(--success)" },
  viewing:    { label: "Viewing",    icon: <ViewModeIcon /> },
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
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        title={meta.label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "2px",
          padding: "0.18rem 0.3rem",
          border: "none",
          borderRadius: "5px",
          background: "transparent",
          color: meta.color ?? "color-mix(in srgb, var(--fg) 65%, transparent)",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          transition: "background 100ms, color 100ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 7%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ display: "inline-flex", lineHeight: 1 }}>{meta.icon}</span>
        <span style={{ fontSize: "0.55rem", opacity: 0.5 }}>▾</span>
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
                <span style={{ display: "inline-flex", justifyContent: "center", width: 18, flexShrink: 0 }}>{item.icon}</span>
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
