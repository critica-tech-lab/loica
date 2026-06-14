import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { EditorApi } from "~/lib/DocumentContext";
import type { ResolvedThread } from "~/components/comment-decorations";
import { authorColorFromName } from "~/components/comment-decorations";
import { timeAgo } from "~/lib/ui-utils";
import { TrashIcon } from "~/components/icons";

const CARD_MIN_H = 80;
const CARD_GAP = 8;
const CARD_W = 264;

interface Props {
  threads: ResolvedThread[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  mountRef: React.RefObject<HTMLDivElement | null>;
  editorApiRef: React.RefObject<EditorApi | null>;
  currentUserId: string;
}

export function FloatingComments({ threads, focusedId, onFocus, mountRef, editorApiRef, currentUserId }: Props) {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());

  const recalc = useCallback(() => {
    const container = mountRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const raw = editorApiRef.current?.getThreadPositions?.() ?? [];
    const map = new Map<string, number>();
    for (const { id, top } of raw) {
      map.set(id, top - rect.top + container.scrollTop);
    }
    setPositions(map);
  }, [editorApiRef, mountRef]);

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
          onFocus={onFocus}
          editorApiRef={editorApiRef}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}


function FloatingCard({ thread, top, focused, onFocus, editorApiRef, currentUserId }: {
  thread: ResolvedThread;
  top: number;
  focused: boolean;
  onFocus: (id: string | null) => void;
  editorApiRef: React.RefObject<EditorApi | null>;
  currentUserId: string;
}) {
  const editorApi = editorApiRef;
  const [reply, setReply] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(thread.body);
  const [hovered, setHovered] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const isOwn = thread.userId === currentUserId;
  const color = authorColorFromName(thread.userName || "");

  const submitReply = () => {
    if (!reply.trim()) return;
    editorApi.current?.addReply(thread.id, reply.trim());
    setReply("");
    setReplyOpen(false);
  };

  useEffect(() => {
    if (replyOpen && replyRef.current) replyRef.current.focus();
  }, [replyOpen]);

  return (
    <div
      onClick={() => onFocus(thread.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        top,
        right: 10,
        width: CARD_W - 20,
        background: "var(--surface)",
        borderRadius: "4px",
        boxShadow: focused
          ? "0 1px 8px rgba(0,0,0,0.20), 0 2px 4px rgba(0,0,0,0.12)"
          : "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)",
        border: focused ? "1px solid var(--border)" : "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        pointerEvents: "all",
        cursor: focused ? "default" : "pointer",
        transition: "box-shadow 120ms, border-color 120ms",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
      }}
    >
      {/* Root comment */}
      <CommentEntry
        body={editing ? editBody : thread.body}
        userName={thread.userName || "Unknown"}
        color={color}
        createdAt={thread.createdAt}
        isOwn={isOwn}
        editing={editing}
        showActions={focused && (hovered || editing)}
        onEditStart={() => { setEditBody(thread.body); setEditing(true); }}
        onEditChange={setEditBody}
        onEditSave={() => { editorApi.current?.updateComment(thread.id, editBody); setEditing(false); }}
        onEditCancel={() => setEditing(false)}
        onDelete={() => { editorApi.current?.deleteComment(thread.id); onFocus(null); }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {thread.replies.map(r => (
            <CommentEntry
              key={r.id}
              body={r.body}
              userName={r.userName || "Unknown"}
              color={authorColorFromName(r.userName || "")}
              createdAt={r.createdAt}
              isOwn={r.userId === currentUserId}
              editing={false}
              showActions={false}
              onDelete={() => editorApi.current?.deleteComment(r.id)}
              onClick={(e) => e.stopPropagation()}
            />
          ))}
        </div>
      )}

      {/* Footer actions */}
      {focused && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ borderTop: "1px solid var(--border)", padding: "6px 12px 8px" }}
        >
          {replyOpen ? (
            <>
              <textarea
                ref={replyRef}
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply(); if (e.key === "Escape") { setReplyOpen(false); setReply(""); } }}
                placeholder="Reply…"
                rows={2}
                style={{
                  width: "100%", resize: "none", border: "none", outline: "none",
                  borderBottom: "2px solid var(--accent)", padding: "2px 0",
                  fontSize: "0.8rem", fontFamily: "var(--font-ui)",
                  background: "transparent", color: "var(--fg)", lineHeight: 1.5,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "6px" }}>
                <GButton variant="text" onClick={() => { setReplyOpen(false); setReply(""); }}>Cancel</GButton>
                <GButton variant="filled" onClick={submitReply} disabled={!reply.trim()}>Reply</GButton>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={() => setReplyOpen(true)}
                style={{
                  flex: 1, textAlign: "left", background: "none", border: "none",
                  color: "var(--muted)", fontSize: "0.78rem", cursor: "text",
                  fontFamily: "var(--font-ui)", padding: "2px 0",
                }}
              >
                Reply…
              </button>
              <GButton
                variant="text"
                onClick={() => { editorApi.current?.resolveThread(thread.id); onFocus(null); }}
                style={{ color: "var(--success)", fontWeight: 600 }}
              >
                Resolve
              </GButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommentEntry({ body, userName, color, createdAt, isOwn, editing, showActions, onEditStart, onEditChange, onEditSave, onEditCancel, onDelete, onClick }: {
  body: string;
  userName: string;
  color: string;
  createdAt: number;
  isOwn: boolean;
  editing: boolean;
  showActions: boolean;
  onEditStart?: () => void;
  onEditChange?: (v: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  onDelete?: () => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <div onClick={onClick} style={{ padding: "10px 12px 8px", position: "relative" }}>
      {/* Author row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{
          width: 28, height: 28, borderRadius: "50%", background: color, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--accent-fg)", fontSize: "0.7rem", fontWeight: 700, userSelect: "none",
        }}>
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--fg)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {userName}
          </div>
          {createdAt > 0 && (
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.2 }}>
              {timeAgo(createdAt)}
            </div>
          )}
        </div>
        {/* Edit/Delete — show on hover when actions are visible */}
        {showActions && isOwn && !editing && (
          <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
            {onEditStart && (
              <IconBtn title="Edit" onClick={(e) => { e.stopPropagation(); onEditStart(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </IconBtn>
            )}
            {onDelete && (
              <IconBtn title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                <TrashIcon className="h-3.5 w-3.5 opacity-70" />
              </IconBtn>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {editing ? (
        <>
          <textarea
            value={body}
            onChange={e => onEditChange?.(e.target.value)}
            autoFocus
            rows={2}
            style={{
              width: "100%", resize: "none", border: "none", outline: "none",
              borderBottom: "2px solid var(--accent)", padding: "2px 0",
              fontSize: "0.8rem", fontFamily: "var(--font-ui)",
              background: "transparent", color: "var(--fg)", lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "6px" }}>
            <GButton variant="text" onClick={onEditCancel}>Cancel</GButton>
            <GButton variant="filled" onClick={onEditSave}>Save</GButton>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: "var(--fg)", wordBreak: "break-word" }}>
          {body || <em style={{ color: "var(--muted)" }}>Empty comment</em>}
        </p>
      )}
    </div>
  );
}

function GButton({ variant, children, onClick, disabled, style }: {
  variant: "text" | "filled";
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px",
        border: "none",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--font-ui)",
        transition: "background 100ms",
        ...(variant === "filled"
          ? { background: disabled ? "color-mix(in srgb, var(--fg) 8%, transparent)" : "var(--accent)", color: disabled ? "var(--muted)" : "var(--accent-fg)" }
          : { background: "transparent", color: "var(--accent)" }),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 26, height: 26, border: "none", borderRadius: "50%",
        background: "transparent", cursor: "pointer", color: "var(--muted)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 100ms",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 6%, transparent)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}
