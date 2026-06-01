import { useOptionalDocument } from "~/lib/DocumentContext";
import type { PMActiveState } from "./editor/types";

interface Props {
  activeState: PMActiveState | null;
  onLink?: () => void;
  onImageUpload?: (file: File) => void;
}

export function PMToolbar({ activeState, onLink, onImageUpload }: Props) {
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

  const blockType = active?.heading
    ? `h${active.heading}`
    : active?.inBlockquote
    ? "blockquote"
    : "p";

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
      {/* Block type dropdown-style buttons */}
      <Btn title="Paragraph (Ctrl+Alt+0)" active={blockType === "p"} onActivate={run(() => api?.clearFormatting?.())}>P</Btn>
      <Btn title="Heading 1 (Ctrl+Alt+1)" active={blockType === "h1"} style={{ fontWeight: 700, fontSize: "0.95rem" }} onActivate={run(() => api?.setHeading?.(1))}>H1</Btn>
      <Btn title="Heading 2 (Ctrl+Alt+2)" active={blockType === "h2"} style={{ fontWeight: 700, fontSize: "0.88rem" }} onActivate={run(() => api?.setHeading?.(2))}>H2</Btn>
      <Btn title="Heading 3 (Ctrl+Alt+3)" active={blockType === "h3"} style={{ fontWeight: 700, fontSize: "0.8rem" }} onActivate={run(() => api?.setHeading?.(3))}>H3</Btn>
      <Btn title="Heading 4 (Ctrl+Alt+4)" active={blockType === "h4"} style={{ fontWeight: 700, fontSize: "0.75rem" }} onActivate={run(() => api?.setHeading?.(4))}>H4</Btn>

      <Sep />

      {/* Inline marks */}
      <Btn title="Bold (Ctrl+B)" active={active?.strong} style={{ fontWeight: 700 }} onActivate={fmt("**")}>B</Btn>
      <Btn title="Italic (Ctrl+I)" active={active?.em} style={{ fontStyle: "italic" }} onActivate={fmt("*")}>I</Btn>
      <Btn title="Underline (Ctrl+U)" active={active?.underline} style={{ textDecoration: "underline", textUnderlineOffset: 2 }} onActivate={fmt("__")}>U</Btn>
      <Btn title="Strikethrough (Ctrl+Shift+X)" active={active?.strikethrough} style={{ textDecoration: "line-through" }} onActivate={fmt("~~")}>S</Btn>
      <Btn title="Inline code (Ctrl+`)" active={active?.code} style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em" }} onActivate={fmt("`")}>{"<>"}</Btn>
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

      <Sep />

      {/* Link */}
      <Btn title="Link (Ctrl+K)" active={false} onActivate={run(() => onLink?.())} style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>Link</Btn>

      <Sep />

      {/* Lists */}
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

      <Sep />

      {/* Blockquote */}
      <Btn title="Blockquote" active={active?.inBlockquote} style={{ fontSize: "1rem", fontWeight: 700, opacity: active?.inBlockquote ? 1 : 0.6 }} onActivate={run(() => api?.toggleBlockquote?.())}>{"“”"}</Btn>

      <Sep />

      {/* Table */}
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

      {/* Horizontal rule */}
      <Btn title="Horizontal rule" active={false} onActivate={run(() => api?.insertHr?.())} style={{ letterSpacing: "-1px" }}>{"—"}</Btn>

      {/* Image upload */}
      {imgUpload && (
        <>
          <Sep />
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
        </>
      )}
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
