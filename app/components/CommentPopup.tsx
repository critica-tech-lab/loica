import { useState, useEffect, useRef } from "react";
import type { EditorApi } from "~/lib/DocumentContext";
import type { ResolvedThread } from "~/components/comment-decorations";
import { authorColorFromName } from "~/components/comment-decorations";

const POPUP_W = 320;
const POPUP_MAX_H = 480;
const GAP = 8;

interface Props {
  thread: ResolvedThread;
  pos: { x: number; y: number };
  currentUserId: string;
  editorApiRef: React.RefObject<EditorApi | null>;
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

export function CommentPopup({ thread, pos, currentUserId, editorApiRef, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(thread.body);
  const isOwn = thread.userId === currentUserId;
  const color = authorColorFromName(thread.userName || "");

  // Position: to the right of the anchor text, vertically aligned with it.
  // Falls back left if there's no room on the right.
  const spaceRight = window.innerWidth - pos.x - GAP;
  const left = spaceRight >= POPUP_W + GAP
    ? pos.x + GAP
    : Math.max(GAP, pos.x - POPUP_W - GAP);
  // Vertically: align top with click Y, clamp to viewport
  const top = Math.min(Math.max(pos.y - 20, GAP), window.innerHeight - 200 - GAP);

  // Dismiss on outside click or Escape
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
        left,
        top,
        width: POPUP_W,
        maxHeight: POPUP_MAX_H,
        overflowY: "auto",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)",
        zIndex: 300,
        fontFamily: "var(--font-ui)",
        fontSize: "0.82rem",
      }}
    >
      {/* Root comment */}
      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <Avatar name={thread.userName || "?"} color={color} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {thread.userName || "Unknown"}
            </div>
            <div style={{ fontSize: "0.68rem", color: "#9b9b9b" }}>{timeAgo(thread.createdAt)}</div>
          </div>
          <button onClick={resolve} title="Resolve" style={resolveBtn}>Resolve</button>
          {isOwn && (
            <button
              onClick={() => { editorApiRef.current?.deleteComment(thread.id); onDismiss(); }}
              title="Delete"
              style={iconBtnStyle}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          )}
        </div>

        {/* Anchor quote */}
        {thread.anchorText && (
          <div style={{
            margin: "0 0 8px",
            padding: "4px 8px",
            borderLeft: "3px solid #f59e0b",
            background: "rgba(251,191,36,0.1)",
            borderRadius: "0 4px 4px 0",
            fontSize: "0.73rem",
            color: "#6b6b6b",
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
            style={{ margin: 0, lineHeight: 1.55, color: "#1a1a1a", wordBreak: "break-word" }}
          >
            {thread.body || <em style={{ color: "#aaa" }}>Empty comment</em>}
          </p>
        )}
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div style={{ borderTop: "1px solid #f0f0f0" }}>
          {thread.replies.map(r => (
            <div key={r.id} style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
                <Avatar name={r.userName || "?"} color={authorColorFromName(r.userName || "")} size={22} />
                <span style={{ fontWeight: 600, fontSize: "0.76rem", color: "#1a1a1a" }}>{r.userName || "Unknown"}</span>
                <span style={{ fontSize: "0.67rem", color: "#9b9b9b", marginLeft: "auto" }}>{timeAgo(r.createdAt)}</span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.5, color: "#1a1a1a", fontSize: "0.8rem" }}>{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 14px 12px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <Avatar name={currentUserId} color={authorColorFromName(currentUserId)} size={22} style={{ marginTop: 2, flexShrink: 0 }} />
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
      width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.38, fontWeight: 700, userSelect: "none",
      ...style,
    }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SmallBtn({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", border: "none", borderRadius: "4px",
      fontSize: "0.73rem", fontWeight: 600, cursor: "pointer",
      background: primary ? "#2383e2" : "#f0f0f0",
      color: primary ? "#fff" : "#444",
      fontFamily: "var(--font-ui)",
    }}>{children}</button>
  );
}

const resolveBtn: React.CSSProperties = {
  padding: "3px 10px", border: "1px solid #e0e0e0", borderRadius: "4px",
  background: "transparent", color: "#137333", fontSize: "0.71rem",
  fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0,
};

const iconBtnStyle: React.CSSProperties = {
  width: 26, height: 26, border: "none", borderRadius: "50%", background: "transparent",
  cursor: "pointer", color: "#9b9b9b", display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};

const inlineTextarea: React.CSSProperties = {
  width: "100%", resize: "none", border: "none", outline: "none",
  borderBottom: "1.5px solid #2383e2", padding: "2px 0",
  fontSize: "0.8rem", fontFamily: "var(--font-ui)",
  background: "transparent", color: "#1a1a1a", lineHeight: 1.5, boxSizing: "border-box",
};
