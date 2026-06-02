import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type { ResolvedThread } from "~/components/comment-decorations";
import { authorColorFromName } from "~/components/comment-decorations";

const CARD_MIN_H = 72;
const CARD_GAP = 8;
const CARD_W = 252;

interface Props {
  threads: ResolvedThread[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  mountRef: React.RefObject<HTMLDivElement | null>;
}

export function FloatingComments({ threads, focusedId, onFocus, mountRef }: Props) {
  const { editorApi, user } = useDocument();
  const [positions, setPositions] = useState<Map<string, number>>(new Map());

  const recalc = useCallback(() => {
    const container = mountRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const raw = editorApi.current?.getThreadPositions?.() ?? [];
    const map = new Map<string, number>();
    for (const { id, top } of raw) {
      map.set(id, top - rect.top + container.scrollTop);
    }
    setPositions(map);
  }, [editorApi, mountRef]);

  // Recalculate on scroll, resize, and thread changes
  useEffect(() => {
    recalc();
    const el = mountRef.current;
    el?.addEventListener("scroll", recalc);
    window.addEventListener("resize", recalc);
    return () => {
      el?.removeEventListener("scroll", recalc);
      window.removeEventListener("resize", recalc);
    };
  }, [recalc, threads]);

  const visible = useMemo(() => {
    const withPos = threads
      .filter(t => !t.resolved && positions.has(t.id))
      .map(t => ({ thread: t, ideal: positions.get(t.id)! }))
      .sort((a, b) => a.ideal - b.ideal);

    // Collision avoidance — shift down if overlapping
    let floor = -Infinity;
    return withPos.map(item => {
      const top = Math.max(item.ideal, floor + CARD_GAP);
      floor = top + CARD_MIN_H;
      return { thread: item.thread, top };
    });
  }, [threads, positions]);

  if (visible.length === 0) return null;

  return (
    <div style={{ position: "absolute", top: 0, right: 0, width: CARD_W, pointerEvents: "none", zIndex: 10 }}>
      {visible.map(({ thread, top }) => (
        <FloatingCard
          key={thread.id}
          thread={thread}
          top={top}
          focused={thread.id === focusedId}
          currentUserId={user.id}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

function FloatingCard({ thread, top, focused, currentUserId, onFocus }: {
  thread: ResolvedThread;
  top: number;
  focused: boolean;
  currentUserId: string;
  onFocus: (id: string | null) => void;
}) {
  const { editorApi } = useDocument();
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(thread.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const color = authorColorFromName(thread.userName || "");
  const isOwn = thread.userId === currentUserId;

  useEffect(() => {
    if (focused && reply === "" && textareaRef.current) {
      // Don't auto-focus — let user click reply explicitly
    }
  }, [focused]);

  const submitReply = () => {
    if (!reply.trim()) return;
    editorApi.current?.addReply(thread.id, reply.trim());
    setReply("");
  };

  const resolve = () => {
    editorApi.current?.resolveThread(thread.id);
    onFocus(null);
  };

  const deleteComment = () => {
    editorApi.current?.deleteComment(thread.id);
    onFocus(null);
  };

  return (
    <div
      onClick={() => onFocus(thread.id)}
      style={{
        position: "absolute",
        top,
        right: 8,
        width: CARD_W - 16,
        background: "var(--bg)",
        borderRadius: "8px",
        boxShadow: focused
          ? "0 2px 12px rgba(0,0,0,0.15), 0 0 0 1.5px rgba(249,171,0,0.5)"
          : "0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px color-mix(in srgb, var(--fg) 8%, transparent)",
        pointerEvents: "all",
        cursor: focused ? "default" : "pointer",
        transition: "box-shadow 150ms",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      {/* Thread root */}
      <div style={{ padding: "0.55rem 0.65rem 0.45rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
          <span style={{
            width: 22, height: 22, borderRadius: "50%", background: color, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: "0.65rem", fontWeight: 700,
          }}>
            {(thread.userName || "?").slice(0, 1).toUpperCase()}
          </span>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.userName || "Unknown"}
          </span>
          {isOwn && focused && (
            <button
              onClick={(e) => { e.stopPropagation(); deleteComment(); }}
              title="Delete comment"
              style={iconBtn}
            >×</button>
          )}
          {focused && (
            <button
              onClick={(e) => { e.stopPropagation(); resolve(); }}
              title="Resolve"
              style={{ ...iconBtn, color: "#16a34a", fontSize: "0.8rem" }}
            >✓</button>
          )}
        </div>

        {editing ? (
          <div>
            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              style={textareaStyle}
              rows={2}
              autoFocus
            />
            <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.3rem" }}>
              <button onClick={() => { editorApi.current?.updateComment(thread.id, editBody); setEditing(false); }} style={actionBtnStyle("#2563eb")}>Save</button>
              <button onClick={() => setEditing(false)} style={actionBtnStyle("color-mix(in srgb, var(--fg) 50%, transparent)")}>Cancel</button>
            </div>
          </div>
        ) : (
          <p
            onDoubleClick={() => { if (isOwn) { setEditBody(thread.body); setEditing(true); } }}
            style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.45, color: "var(--fg)", wordBreak: "break-word" }}
          >
            {thread.body || <em style={{ opacity: 0.5 }}>Empty comment</em>}
          </p>
        )}
      </div>

      {/* Quoted anchor text */}
      {thread.anchorText && (
        <div style={{
          margin: "0 0.65rem 0.35rem",
          padding: "0.2rem 0.45rem",
          borderLeft: "3px solid rgba(249,171,0,0.6)",
          background: "rgba(249,171,0,0.08)",
          borderRadius: "0 3px 3px 0",
          fontSize: "0.72rem",
          color: "color-mix(in srgb, var(--fg) 60%, transparent)",
          fontStyle: "italic",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {thread.anchorText}
        </div>
      )}

      {/* Replies — only when focused */}
      {focused && thread.replies.length > 0 && (
        <div style={{ borderTop: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}>
          {thread.replies.map(r => (
            <div key={r.id} style={{ padding: "0.45rem 0.65rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.2rem" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: authorColorFromName(r.userName || ""), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.55rem", fontWeight: 700, flexShrink: 0 }}>
                  {(r.userName || "?").slice(0, 1).toUpperCase()}
                </span>
                <span style={{ fontSize: "0.71rem", fontWeight: 600 }}>{r.userName || "Unknown"}</span>
              </div>
              <p style={{ margin: 0, fontSize: "0.78rem", lineHeight: 1.4, color: "var(--fg)" }}>{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input — only when focused */}
      {focused && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ padding: "0.4rem 0.65rem 0.5rem", borderTop: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)" }}
        >
          <textarea
            ref={textareaRef}
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply(); }}
            placeholder="Reply…"
            rows={1}
            style={textareaStyle}
          />
          {reply.trim() && (
            <button onClick={submitReply} style={{ ...actionBtnStyle("#2563eb"), marginTop: "0.3rem" }}>Reply</button>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", padding: "0 2px",
  color: "color-mix(in srgb, var(--fg) 40%, transparent)", fontSize: "1rem", lineHeight: 1,
  fontFamily: "var(--font-ui)",
};

const textareaStyle: React.CSSProperties = {
  width: "100%", resize: "none", border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  borderRadius: "5px", padding: "0.3rem 0.4rem", fontSize: "0.78rem", fontFamily: "var(--font-ui)",
  background: "var(--bg)", color: "var(--fg)", outline: "none", lineHeight: 1.4, boxSizing: "border-box",
};

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "0.18rem 0.6rem", border: `1px solid ${color}40`, borderRadius: "4px",
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    color, fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)",
  };
}
