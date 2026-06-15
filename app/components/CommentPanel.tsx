import { useEffect, useRef, useState } from "react";
import type { ResolvedThread } from "./comment-decorations";
import { MentionTextarea, renderMentions, hasMentions } from "./MentionTextarea";
import { CommentIcon } from "~/components/icons";
import { timeAgo } from "~/lib/ui-utils";

interface CommentPanelProps {
  threads: ResolvedThread[];
  currentUserId?: string;
  onClose: () => void;
  onScrollTo: (pos: number) => void;
  onReply: (threadId: string, body: string) => void;
  onEditComment: (commentId: string, body: string) => void;
  onDeleteComment: (commentId: string) => void;
  onResolveThread: (threadId: string) => void;
  onUnresolveThread: (threadId: string) => void;
  onFinish?: () => void;
  onMention?: (body: string) => void;
  readOnly?: boolean;
  canResolve?: boolean;
  focusedThreadId?: string | null;
  focusedSuggestionId?: string | null;
}

type ListItem =
  | { type: "thread"; thread: ResolvedThread; top: number };

export function CommentPanel({
  threads,
  currentUserId,
  onClose,
  onScrollTo,
  onReply,
  onEditComment,
  onDeleteComment,
  onResolveThread,
  onUnresolveThread,
  onFinish,
  onMention,
  readOnly = false,
  canResolve = true,
  focusedThreadId,
  focusedSuggestionId,
}: CommentPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"open" | "resolved">("open");

  const openThreads = threads.filter(t => !t.resolved);
  const resolvedThreads = threads.filter(t => t.resolved);
  const visibleThreads = tab === "open" ? openThreads : resolvedThreads;

  const mergedItems: ListItem[] = [
    ...visibleThreads.map((thread): ListItem => ({
      type: "thread", thread,
      top: thread.from > 0 ? thread.from : Number.MAX_SAFE_INTEGER,
    })),
  ].sort((a, b) => a.top - b.top);

  const focusedId = focusedThreadId || focusedSuggestionId;
  useEffect(() => {
    if (!focusedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-item-id="${focusedId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusedId]);

  return (
    <div style={{
      width: "min(22rem, 38vw)",
      minWidth: "16rem",
      flexShrink: 0,
      background: "var(--bg)",
      borderLeft: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "var(--font-ui)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.85rem 1rem 0",
      }}>
        <span style={{ fontWeight: 600, fontSize: "var(--fs-lg)" }}>Comments</span>
        <button
          onClick={onClose}
          title="Close"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--fs-2xl)", opacity: 0.4, padding: "0 0.2rem", color: "var(--fg)", lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}
        >×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", padding: "0.5rem 1rem 0.75rem" }}>
        {(["open", "resolved"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: "var(--fs-base)",
              fontFamily: "var(--font-ui)",
              padding: "0.2rem 0.65rem",
              borderRadius: "var(--radius-pill)",
              border: tab === t
                ? "1px solid color-mix(in srgb, var(--fg) 25%, transparent)"
                : "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
              background: tab === t
                ? "color-mix(in srgb, var(--fg) 8%, transparent)"
                : "transparent",
              color: "var(--fg)",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              transition: "all var(--ease-fast)",
            }}
          >
            {t === "open" ? `Open${openThreads.length > 0 ? ` (${openThreads.length})` : ""}` : `Resolved${resolvedThreads.length > 0 ? ` (${resolvedThreads.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "0 0.75rem 1rem" }}>
        {mergedItems.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem 1rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)", fontSize: "var(--fs-base)" }}>
            <div style={{ marginBottom: "0.5rem", opacity: 0.4, display: "flex", justifyContent: "center" }}><CommentIcon width={22} height={22} /></div>
            {tab === "open" ? "No open comments. Select text to add one." : "No resolved comments."}
          </div>
        )}
        {mergedItems.map(item =>
          item.type === "thread" ? (
            <ThreadCard
              key={item.thread.id}
              thread={item.thread}
              currentUserId={currentUserId}
              readOnly={readOnly}
              focused={item.thread.id === focusedThreadId}
              canResolve={canResolve}
              onScrollTo={onScrollTo}
              onReply={onReply}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              onResolveThread={onResolveThread}
              onUnresolveThread={onUnresolveThread}
              onFinish={onFinish}
              onMention={onMention}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

// ─── ThreadCard ───────────────────────────────────────────

function ThreadCard({
  thread,
  currentUserId,
  readOnly,
  focused,
  canResolve = true,
  onScrollTo,
  onReply,
  onEditComment,
  onDeleteComment,
  onResolveThread,
  onUnresolveThread,
  onFinish,
  onMention,
}: {
  thread: ResolvedThread;
  currentUserId?: string;
  readOnly: boolean;
  focused: boolean;
  canResolve?: boolean;
  onScrollTo: (pos: number) => void;
  onReply: (threadId: string, body: string) => void;
  onEditComment: (commentId: string, body: string) => void;
  onDeleteComment: (commentId: string) => void;
  onResolveThread: (threadId: string) => void;
  onUnresolveThread: (threadId: string) => void;
  onFinish?: () => void;
  onMention?: (body: string) => void;
}) {
  const [replyText, setReplyText] = useState("");
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const [isWriting, setIsWriting] = useState(false);
  const wasWritingRef = useRef(false);

  const isNew = !thread.body && thread.replies.length === 0;
  const isOwn = currentUserId === thread.userId;

  useEffect(() => {
    if (isNew && newCommentRef.current) newCommentRef.current.focus();
  }, []);

  useEffect(() => {
    if (!focused || !cardRef.current) return;
    const el = cardRef.current;
    el.classList.remove("comment-thread-focused");
    void el.offsetWidth;
    el.classList.add("comment-thread-focused");
  }, [focused]);

  // When user stops writing, trigger fade from the persisted highlight
  useEffect(() => {
    if (isWriting) { wasWritingRef.current = true; return; }
    if (!wasWritingRef.current || !cardRef.current) return;
    wasWritingRef.current = false;
    const el = cardRef.current;
    el.classList.remove("comment-thread-writing");
    el.classList.remove("comment-thread-focused");
    void el.offsetWidth;
    el.classList.add("comment-thread-focused");
  }, [isWriting]);

  const handleNewSave = () => {
    const body = newCommentText.trim();
    if (!body) return;
    onEditComment(thread.id, body);
    if (hasMentions(body)) onMention?.(body);
    onFinish?.();
  };

  const handleNewCancel = () => {
    if (!newCommentText.trim()) onDeleteComment(thread.id);
  };

  const handleReply = () => {
    const body = replyText.trim();
    if (!body) return;
    onReply(thread.id, body);
    if (hasMentions(body)) onMention?.(body);
    setReplyText("");
    onFinish?.();
  };

  return (
    <div
      ref={cardRef}
      data-item-id={thread.id}
      onFocus={(e) => {
        if ((e.target as HTMLElement).tagName === "TEXTAREA") {
          setIsWriting(true);
          cardRef.current?.classList.add("comment-thread-writing");
          cardRef.current?.classList.remove("comment-thread-focused");
        }
      }}
      onBlur={(e) => {
        if ((e.target as HTMLElement).tagName === "TEXTAREA") setIsWriting(false);
      }}
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
        background: "var(--bg)",
        boxShadow: "var(--shadow-sm)",
        padding: "0.75rem 0.85rem",
        marginBottom: "0.5rem",
        opacity: thread.resolved ? 0.55 : 1,
      }}
    >
      {/* New empty comment — textarea to type */}
      {isNew ? (
        <div>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, marginBottom: "0.35rem", color: "var(--fg)" }}>
            {thread.userName}
          </div>
          <MentionTextarea
            ref={newCommentRef}
            value={newCommentText}
            onChange={e => setNewCommentText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleNewSave(); }
              if (e.key === "Escape") handleNewCancel();
            }}
            onBlur={() => { if (!newCommentText.trim()) handleNewCancel(); }}
            onSubmit={handleNewSave}
            placeholder="Write a comment…"
            style={textareaStyle}
            rows={2}
          />
          <div style={{ fontSize: "var(--fs-2xs)", color: "color-mix(in srgb, var(--fg) 35%, transparent)", marginTop: "0.3rem" }}>
            Enter to post · Esc to cancel
          </div>
        </div>
      ) : (
        <>
          {/* Root comment */}
          <CommentBody
            commentId={thread.id}
            userName={thread.userName}
            body={thread.body}
            createdAt={thread.createdAt}
            isOwn={isOwn}
            readOnly={readOnly}
            onEdit={onEditComment}
            onDelete={onDeleteComment}
            onMention={onMention}
            resolveButton={canResolve ? (
              <button
                onClick={() => thread.resolved ? onUnresolveThread(thread.id) : onResolveThread(thread.id)}
                title={thread.resolved ? "Reopen" : "Resolve"}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: thread.resolved ? "var(--accent)" : "color-mix(in srgb, var(--fg) 35%, transparent)",
                  padding: "0.1rem",
                  display: "flex", alignItems: "center",
                  transition: "color var(--ease-fast)",
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--color-success)")}
                onMouseLeave={e => (e.currentTarget.style.color = thread.resolved ? "var(--accent)" : "color-mix(in srgb, var(--fg) 35%, transparent)")}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 8.5l3.5 3.5 7-7" />
                </svg>
              </button>
            ) : undefined}
          />

          {/* Replies */}
          {thread.replies.length > 0 && (
            <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: "2px solid color-mix(in srgb, var(--fg) 10%, transparent)" }}>
              {thread.replies.map(reply => (
                <div key={reply.id} style={{ marginBottom: "0.5rem" }}>
                  <CommentBody
                    commentId={reply.id}
                    userName={reply.userName}
                    body={reply.body}
                    createdAt={reply.createdAt}
                    isOwn={currentUserId === reply.userId}
                    readOnly={readOnly}
                    onEdit={onEditComment}
                    onDelete={onDeleteComment}
                    onMention={onMention}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Reply input */}
          {!readOnly && !thread.resolved && (
            <div style={{ marginTop: "0.6rem", borderTop: "1px solid color-mix(in srgb, var(--fg) 7%, transparent)", paddingTop: "0.5rem" }}>
              <MentionTextarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                onSubmit={handleReply}
                placeholder="Reply…"
                style={{ ...textareaStyle, opacity: replyText ? 1 : 0.45 }}
                rows={1}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── CommentBody ─────────────────────────────────────────

function CommentBody({
  commentId,
  userName,
  body,
  createdAt,
  isOwn,
  readOnly,
  onEdit,
  onDelete,
  onMention,
  resolveButton,
}: {
  commentId: string;
  userName: string;
  body: string;
  createdAt: number;
  isOwn: boolean;
  readOnly: boolean;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onMention?: (body: string) => void;
  resolveButton?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(body);
  const [hovered, setHovered] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setEditValue(body); }, [body, editing]);
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.selectionStart = taRef.current.value.length;
    }
  }, [editing]);

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Header: name · time · actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--fg)" }}>{userName}</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "color-mix(in srgb, var(--fg) 35%, transparent)" }}>·</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "color-mix(in srgb, var(--fg) 35%, transparent)" }}>{timeAgo(createdAt)}</span>

        {/* Actions — appear on hover */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.15rem", opacity: (hovered && !readOnly && isOwn && !editing) ? 1 : 0, transition: "opacity var(--ease-fast)" }}>
          <IconBtn title="Edit" onClick={() => setEditing(true)}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 2l3 3-9 9H2v-3L11 2z" />
            </svg>
          </IconBtn>
          <IconBtn title="Delete" onClick={() => onDelete(commentId)} danger>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 13 6" /><path d="M5 6V4h6v2" /><path d="M4 6l1 8h6l1-8" />
            </svg>
          </IconBtn>
          {resolveButton && <div style={{ marginLeft: "0.1rem" }}>{resolveButton}</div>}
        </div>

        {/* Resolve button always shown when not hovering */}
        {resolveButton && (
          <div style={{ marginLeft: hovered && !readOnly && isOwn ? "0" : "auto", opacity: (hovered && !readOnly && isOwn) ? 0 : 1, transition: "opacity var(--ease-fast)", pointerEvents: (hovered && !readOnly && isOwn) ? "none" : "auto" }}>
            {!isOwn && resolveButton}
          </div>
        )}
      </div>

      {/* Body */}
      {editing ? (
        <>
          <MentionTextarea
            ref={taRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEdit(commentId, editValue); if (hasMentions(editValue)) onMention?.(editValue); setEditing(false); }
              if (e.key === "Escape") { setEditValue(body); setEditing(false); }
            }}
            onBlur={() => { if (editValue !== body) { onEdit(commentId, editValue); if (hasMentions(editValue)) onMention?.(editValue); } setEditing(false); }}
            onSubmit={() => { onEdit(commentId, editValue); if (hasMentions(editValue)) onMention?.(editValue); setEditing(false); }}
            style={textareaStyle}
            rows={1}
          />
          <div style={{ fontSize: "var(--fs-2xs)", color: "color-mix(in srgb, var(--fg) 35%, transparent)", marginTop: "0.2rem" }}>Enter to save · Esc to cancel</div>
        </>
      ) : (
        <div style={{ fontSize: "var(--fs-base)", lineHeight: 1.55, color: "var(--fg)", wordBreak: "break-word" }}>
          {body ? renderMentions(body) : <span style={{ opacity: 0.3, fontStyle: "italic" }}>empty comment</span>}
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: "0.2rem",
        color: danger ? "var(--color-danger)" : "color-mix(in srgb, var(--fg) 45%, transparent)",
        display: "flex", alignItems: "center", borderRadius: "var(--radius-xs)",
        transition: "background 100ms ease-out, color 100ms ease-out",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 8%, transparent)"; e.currentTarget.style.color = danger ? "var(--color-danger)" : "var(--fg)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = danger ? "var(--color-danger)" : "color-mix(in srgb, var(--fg) 45%, transparent)"; }}
    >
      {children}
    </button>
  );
}


const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "var(--fs-base)",
  lineHeight: "1.55",
  background: "none",
  border: "none",
  color: "var(--fg)",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  padding: 0,
  fontFamily: "var(--font-ui)",
};
