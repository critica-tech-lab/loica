import { useState, useEffect, useRef } from "react";
import type { EditorApi } from "~/lib/DocumentContext";
import type { ResolvedThread } from "~/components/comment-decorations";
import { authorColorFromName } from "~/components/comment-decorations";

const POPUP_W = 300;
const POPUP_MAX_H = 480;
const GAP = 8;
const MOBILE_BP = 600;

type Layout = {
  left: number | string; right?: number | string; top: number | string; bottom?: number | string;
  width: number | string; maxHeight: number | string; borderRadius: number;
};

function computeLayout(
  pos: { x: number; y: number },
  editorRef?: React.RefObject<HTMLDivElement | null>,
): Layout {
  if (window.innerWidth < MOBILE_BP) {
    return { left: 0, right: 0, top: "auto", bottom: 0, width: "100%", maxHeight: "70vh", borderRadius: 0 };
  }
  const editorRight = editorRef?.current?.getBoundingClientRect().right ?? pos.x;
  const left = Math.min(editorRight + GAP, window.innerWidth - POPUP_W - GAP);
  const top = Math.min(Math.max(pos.y - 20, GAP), window.innerHeight - 200 - GAP);
  return { left, top, width: POPUP_W, maxHeight: POPUP_MAX_H, borderRadius: 0 };
}

interface Props {
  thread: ResolvedThread;
  pos: { x: number; y: number };
  currentUserId: string;
  editorApiRef: React.RefObject<EditorApi | null>;
  editorRef?: React.RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}

function timeAgo(ts: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CommentPopup({ thread, pos, currentUserId, editorApiRef, editorRef, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(thread.body);
  const isOwn = thread.userId === currentUserId;
  const color = authorColorFromName(thread.userName || "");

  const [layout, setLayout] = useState<Layout>(() => computeLayout(pos, editorRef));

  useEffect(() => {
    const update = () => setLayout(computeLayout(pos, editorRef));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [pos, editorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const submitReply = () => {
    if (!reply.trim()) return;
    editorApiRef.current?.addReply(thread.id, reply.trim());
    setReply("");
  };

  const resolve = () => {
    editorApiRef.current?.resolveThread(thread.id);
    onDismiss();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        ...layout,
        overflowY: "auto",
        background: "var(--bg)",
        border: "1.5px solid var(--fg)",
        boxShadow: "4px 4px 0 color-mix(in srgb, var(--fg) 18%, transparent)",
        zIndex: 300,
        fontFamily: "var(--font-ui)",
        fontSize: "0.82rem",
        color: "var(--fg)",
      }}
    >
      {/* Root comment */}
      <div style={{ padding: "12px 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <Avatar name={thread.userName || "?"} color={color} size={26} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "0.78rem", color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
              {thread.userName || "Unknown"}
            </div>
            <div style={{ fontSize: "0.66rem", color: "color-mix(in srgb, var(--fg) 45%, transparent)", fontVariantNumeric: "tabular-nums" }}>
              {timeAgo(thread.createdAt)}
            </div>
          </div>
          <button onClick={resolve} title="Resolve" style={resolveBtn}>Resolve</button>
          {isOwn && (
            <button
              onClick={() => { editorApiRef.current?.deleteComment(thread.id); onDismiss(); }}
              title="Delete"
              style={iconBtnStyle}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          )}
        </div>

        {thread.anchorText && (
          <div style={{
            margin: "0 0 8px",
            padding: "3px 8px",
            borderLeft: "2px solid var(--accent)",
            fontSize: "0.71rem",
            color: "color-mix(in srgb, var(--fg) 55%, transparent)",
            fontStyle: "italic",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {thread.anchorText}
          </div>
        )}

        {editing ? (
          <>
            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              autoFocus
              rows={2}
              style={inlineTextarea}
            />
            <div style={{ display: "flex", gap: "6px", marginTop: "6px", justifyContent: "flex-end" }}>
              <SmallBtn onClick={() => setEditing(false)}>Cancel</SmallBtn>
              <SmallBtn primary onClick={() => { editorApiRef.current?.updateComment(thread.id, editBody); setEditing(false); }}>Save</SmallBtn>
            </div>
          </>
        ) : (
          <p
            onDoubleClick={() => { if (isOwn) { setEditBody(thread.body); setEditing(true); } }}
            style={{ margin: 0, lineHeight: 1.55, color: "var(--fg)", wordBreak: "break-word" }}
          >
            {thread.body || <em style={{ color: "color-mix(in srgb, var(--fg) 35%, transparent)" }}>Empty comment</em>}
          </p>
        )}
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div style={{ borderTop: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)" }}>
          {thread.replies.map(r => (
            <div key={r.id} style={{ padding: "9px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                <Avatar name={r.userName || "?"} color={authorColorFromName(r.userName || "")} size={20} />
                <span style={{ fontWeight: 700, fontSize: "0.74rem", color: "var(--fg)" }}>{r.userName || "Unknown"}</span>
                <span style={{ fontSize: "0.64rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{timeAgo(r.createdAt)}</span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.5, color: "var(--fg)", fontSize: "0.79rem" }}>{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      <div style={{ borderTop: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)", padding: "9px 12px 11px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <Avatar name={currentUserId} color={authorColorFromName(currentUserId)} size={20} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply();
              if (e.key === "Escape") { e.stopPropagation(); onDismiss(); }
            }}
            placeholder="Reply…"
            rows={1}
            style={inlineTextarea}
          />
          {reply.trim() && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "5px" }}>
              <SmallBtn primary onClick={submitReply}>Reply</SmallBtn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, color, size, style }: { name: string; color: string; size: number; style?: React.CSSProperties }) {
  return (
    <span style={{
      width: size, height: size,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.4, fontWeight: 700, userSelect: "none",
      ...style,
    }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SmallBtn({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px",
      border: primary
        ? "1px solid var(--fg)"
        : "1px solid color-mix(in srgb, var(--fg) 30%, transparent)",
      borderRadius: 0,
      fontSize: "0.71rem",
      fontWeight: 600,
      cursor: "pointer",
      background: primary ? "var(--fg)" : "transparent",
      color: primary ? "var(--bg)" : "var(--fg)",
      fontFamily: "var(--font-ui)",
      letterSpacing: "0.02em",
    }}>{children}</button>
  );
}

const resolveBtn: React.CSSProperties = {
  padding: "3px 8px",
  border: "1px solid var(--accent)",
  borderRadius: 0,
  background: "transparent",
  color: "var(--accent)",
  fontSize: "0.68rem",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  flexShrink: 0,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const iconBtnStyle: React.CSSProperties = {
  width: 24, height: 24,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  cursor: "pointer",
  color: "color-mix(in srgb, var(--fg) 35%, transparent)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};

const inlineTextarea: React.CSSProperties = {
  width: "100%", resize: "none", border: "none", outline: "none",
  borderBottom: "1.5px solid var(--fg)",
  padding: "2px 0",
  fontSize: "0.79rem", fontFamily: "var(--font-ui)",
  background: "transparent", color: "var(--fg)", lineHeight: 1.5, boxSizing: "border-box",
};
