import { useOptionalDocument } from "~/lib/DocumentContext";

interface ToolbarProps {
  onFormat?: (before: string, after: string) => void;
  onFormatLine?: (prefix: string) => void;
  onImageUpload?: (file: File) => void;
  onCopyFormatted?: () => void;
  onInsertFootnote?: () => void;
  /**
   * Layout variant.
   * - "full" (default): full-width strip with bottom border. Used on public
   *   share route where the editor has no other chrome.
   * - "pill": compact, rounded, centered — summoned on demand via ⌘/.
   */
  variant?: "full" | "pill";
  /** Only shown when variant="pill". */
  onDismiss?: () => void;
  /**
   * Link handler. When provided, clicking the Link button calls this instead
   * of opening the native prompt. Use it to show a nicer modal at a higher level.
   */
  onLink?: () => void;
}

type InlineAction = { kind: "inline"; label: string; title: string; before: string; after: string; style?: React.CSSProperties; icon?: React.ReactNode };
type LineAction   = { kind: "line";   label: string; title: string; prefix: string; style?: React.CSSProperties; icon?: React.ReactNode };
type Sep          = { kind: "sep" };
type Item         = InlineAction | LineAction | Sep;

const ITEMS: Item[] = [
  // Inline formatting
  { kind: "inline", label: "B",     title: "Bold (Ctrl+B)",          before: "**",   after: "**",     style: { fontWeight: 700 } },
  { kind: "inline", label: "I",     title: "Italic (Ctrl+I)",        before: "*",    after: "*",      style: { fontStyle: "italic" } },
  { kind: "inline", label: "S",     title: "Strikethrough",          before: "~~",   after: "~~",     style: { textDecoration: "line-through" } },
  { kind: "inline", label: "",      title: "Highlight (Ctrl+Shift+H)", before: "{==",  after: "==}",    style: { color: "var(--warning)" }, icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l6 6" /><path d="M4 20l4-1 11-11-3-3-11 11z" /><line x1="14" y1="6" x2="18" y2="10" /></svg> },
  { kind: "sep" },
  // Link
  { kind: "inline", label: "Link",  title: "Link (Ctrl+K)",          before: "__link__",    after: "" },
  { kind: "sep" },
  // Headings
  { kind: "line",   label: "H1",    title: "Heading 1",              prefix: "# ",   style: { fontWeight: 700, fontSize: "0.95rem" } },
  { kind: "line",   label: "H2",    title: "Heading 2",              prefix: "## ",  style: { fontWeight: 700, fontSize: "0.88rem" } },
  { kind: "line",   label: "H3",    title: "Heading 3",              prefix: "### ", style: { fontWeight: 700, fontSize: "0.8rem" } },
  { kind: "line",   label: "H4",    title: "Heading 4",              prefix: "#### ", style: { fontWeight: 700, fontSize: "0.75rem" } },
  { kind: "sep" },
  // Lists
  { kind: "line",   label: "",      title: "Unordered list",         prefix: "- ",   icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="9" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="2" fill="currentColor" stroke="none" /></svg> },
  { kind: "line",   label: "",      title: "Ordered list",           prefix: "1. ",  icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="11" y1="6" x2="21" y2="6" /><line x1="11" y1="12" x2="21" y2="12" /><line x1="11" y1="18" x2="21" y2="18" /><text x="2" y="8" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">1</text><text x="2" y="14.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">2</text><text x="2" y="21" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui">3</text></svg> },
  { kind: "sep" },
  // Block
  { kind: "line",   label: "\u201C\u201D", title: "Blockquote",             prefix: "> ",   style: { fontSize: "1rem", fontWeight: 700, lineHeight: 1, opacity: 0.6 } },
  { kind: "sep" },
  // Table
  { kind: "inline", label: "",     title: "Insert table",           before: "\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n", after: "", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="12" y1="3" x2="12" y2="21" /></svg> },
  { kind: "sep" },
  // Horizontal rule
  { kind: "inline", label: "\u2014",     title: "Horizontal rule",        before: "\n---\n", after: "" },
  { kind: "sep" },
  // Footnote (handled via custom callback, before/after are unused placeholders)
  { kind: "inline", label: "",     title: "Insert footnote",        before: "__footnote__", after: "", icon: <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><text x="1" y="16" fontSize="16" fontFamily="serif" fontWeight="700">A</text><text x="13" y="9" fontSize="9" fontFamily="serif" fontWeight="700">1</text></svg> },
];

export function Toolbar(props: ToolbarProps = {}) {
  const ctx = useOptionalDocument();

  const onFormat = props.onFormat ?? ((b: string, a: string) => ctx?.editorApi.current?.format(b, a));
  const onFormatLine = props.onFormatLine ?? ((p: string) => ctx?.editorApi.current?.formatLine(p));
  const onImageUpload = props.onImageUpload ?? (ctx?.canEdit ? (file: File) => ctx.editorApi.current?.uploadImage(file) : undefined);
  const onCopyFormatted = props.onCopyFormatted ?? ctx?.copyFormatted;
  const onInsertFootnote = props.onInsertFootnote ?? (ctx?.canEdit ? ctx.insertFootnote : undefined);
  const variant = props.variant ?? "full";
  const onDismiss = props.onDismiss;

  const containerStyle: React.CSSProperties = variant === "pill"
    ? {
        position: "sticky",
        top: "8px",
        zIndex: 10,
        alignSelf: "center",
        display: "inline-flex",
        alignItems: "center",
        gap: "0",
        padding: "2px 4px",
        margin: "0.75rem auto 0.25rem",
        background: "var(--bg)",
        border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
        borderRadius: "999px",
        boxShadow: "0 2px 8px rgba(16,15,15,0.04), 0 1px 2px rgba(16,15,15,0.02)",
        flexShrink: 0,
        flexWrap: "nowrap",
        overflow: "hidden",
        maxWidth: "calc(100% - 2rem)",
      }
    : {
        display: "flex",
        alignItems: "center",
        gap: "0.15rem",
        padding: "0.3rem max(1rem, calc(50% - 22rem))",
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        flexShrink: 0,
        flexWrap: "wrap",
      };
  return (
    <div style={containerStyle}>
      {ITEMS.map((item, i) => {
        if (item.kind === "sep") {
          return (
            <span
              key={i}
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
        return (
          <ToolbarBtn
            key={item.label + i}
            label={item.label}
            icon={item.icon}
            title={item.title}
            style={item.style}
            onActivate={() => {
              if (item.kind === "inline" && item.before === "__footnote__" && onInsertFootnote) {
                onInsertFootnote();
              } else if (item.kind === "inline" && item.before === "__link__") {
                props.onLink?.();
              } else if (item.kind === "inline") {
                onFormat(item.before, item.after);
              } else {
                onFormatLine(item.prefix);
              }
            }}
          />
        );
      })}
      {/* Track changes toggle hidden — feature needs more work */}
      {onImageUpload && (
        <>
          <span
            style={{
              width: "1px",
              height: "0.85rem",
              background: "color-mix(in srgb, var(--fg) 15%, transparent)",
              margin: "0 0.2rem",
              flexShrink: 0,
            }}
          />
          <ToolbarBtn
            label=""
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            }
            title="Upload image"
            onActivate={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
              input.onchange = () => {
                const file = input.files?.[0];
                if (file) onImageUpload(file);
              };
              input.click();
            }}
          />
        </>
      )}
      {onCopyFormatted && (
        <>
          <span
            style={{
              width: "1px",
              height: "0.85rem",
              background: "color-mix(in srgb, var(--fg) 15%, transparent)",
              margin: "0 0.2rem",
              flexShrink: 0,
            }}
          />
          <ToolbarBtn
            label=""
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                <text x="13" y="18.5" fontSize="8" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui">A</text>
              </svg>
            }
            title="Copy with formatting"
            onActivate={onCopyFormatted}
          />
        </>
      )}
      {variant === "pill" && onDismiss && (
        <>
          <span
            style={{
              width: "1px",
              height: "0.85rem",
              background: "color-mix(in srgb, var(--fg) 15%, transparent)",
              margin: "0 0.2rem",
              flexShrink: 0,
            }}
          />
          <ToolbarBtn
            label="×"
            title="Hide toolbar (Esc)"
            style={{ opacity: 0.5 }}
            onActivate={onDismiss}
          />
        </>
      )}
    </div>
  );
}

export function ToolbarBtn({
  label,
  icon,
  title,
  style,
  onActivate,
}: {
  label: string;
  icon?: React.ReactNode;
  title: string;
  style?: React.CSSProperties;
  onActivate: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      className="toolbar-btn"
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        onActivate();
      }}
      style={style}
    >
      {icon || label}
    </button>
  );
}
