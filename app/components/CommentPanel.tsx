import { useEffect, useRef, useState } from "react";
import type { SuggestionEntry } from "./criticmarkup";
import { authorColorFromName } from "./criticmarkup";
import type { ResolvedThread } from "./comment-decorations";
import { MentionTextarea } from "./MentionTextarea";
import { timeAgo } from "~/lib/ui-utils";

interface CommentPanelProps {
  threads: ResolvedThread[];
  suggestions?: SuggestionEntry[];
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
  onAcceptSuggestion?: (entry: SuggestionEntry) => void;
  onRejectSuggestion?: (entry: SuggestionEntry) => void;
}

type ListItem =
  | { type: "thread"; thread: ResolvedThread; top: number }
  | { type: "suggestion"; entry: SuggestionEntry; top: number };

export function CommentPanel({
  threads,
  suggestions = [],
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
  onAcceptSuggestion,
  onRejectSuggestion,
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
    ...(tab === "open" ? suggestions.map((entry): ListItem => ({ type: "suggestion", entry, top: entry.top })) : []),
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
        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Comments</span>
        <button
          onClick={onClose}
          title="Close"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", opacity: 0.4, padding: "0 0.2rem", color: "var(--fg)", lineHeight: 1 }}
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
              fontSize: "0.78rem",
              fontFamily: "var(--font-ui)",
              padding: "0.2rem 0.65rem",
              borderRadius: "999px",
              border: tab === t
                ? "1px solid color-mix(in srgb, var(--fg) 25%, transparent)"
                : "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
              background: tab === t
                ? "color-mix(in srgb, var(--fg) 8%, transparent)"
                : "transparent",
              color: "var(--fg)",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              transition: "all 120ms ease-out",
            }}
          >
            {t === "open" ? `Open${openThreads.length + suggestions.length > 0 ? ` (${openThreads.length + suggestions.length})` : ""}` : `Resolved${resolvedThreads.length > 0 ? ` (${resolvedThreads.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "0 0.75rem 1rem" }}>
        {mergedItems.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem 1rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)", fontSize: "0.8rem" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem", opacity: 0.4 }}>💬</div>
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
          ) : (
            <SuggestionCard
              key={item.entry.id}
              entry={item.entry}
              readOnly={readOnly}
              focused={item.entry.id === focusedSuggestionId}
              onScrollTo={onScrollTo}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
            />
          )
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

  const isNew = !thread.body && thread.replies.length === 0;
  const isOwn = currentUserId === thread.userId;

  useEffect(() => {
    if (isNew && newCommentRef.current) newCommentRef.current.focus();
  }, []);

  useEffect(() => {
    if (!focused || !cardRef.current) return;
    const el = cardRef.current;
    el.classList.remove("comment-thread-focused");
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add("comment-thread-focused");
  }, [focused]);

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
      style={{
        borderRadius: "6px",
        border: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
        background: "var(--bg)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        padding: "0.75rem 0.85rem",
        marginBottom: "0.5rem",
        opacity: thread.resolved ? 0.55 : 1,
      }}
    >
      {/* New empty comment — textarea to type */}
      {isNew ? (
        <div>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem", color: "var(--fg)" }}>
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
          <div style={{ fontSize: "0.65rem", color: "color-mix(in srgb, var(--fg) 35%, transparent)", marginTop: "0.3rem" }}>
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
                  transition: "color 120ms ease-out",
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#22c55e")}
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
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--fg)" }}>{userName}</span>
        <span style={{ fontSize: "0.7rem", color: "color-mix(in srgb, var(--fg) 35%, transparent)" }}>·</span>
        <span style={{ fontSize: "0.7rem", color: "color-mix(in srgb, var(--fg) 35%, transparent)" }}>{timeAgo(createdAt)}</span>

        {/* Actions — appear on hover */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.15rem", opacity: (hovered && !readOnly && isOwn && !editing) ? 1 : 0, transition: "opacity 120ms ease-out" }}>
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
          <div style={{ marginLeft: hovered && !readOnly && isOwn ? "0" : "auto", opacity: (hovered && !readOnly && isOwn) ? 0 : 1, transition: "opacity 120ms ease-out", pointerEvents: (hovered && !readOnly && isOwn) ? "none" : "auto" }}>
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
          <div style={{ fontSize: "0.65rem", color: "color-mix(in srgb, var(--fg) 35%, transparent)", marginTop: "0.2rem" }}>Enter to save · Esc to cancel</div>
        </>
      ) : (
        <div style={{ fontSize: "0.82rem", lineHeight: 1.55, color: "var(--fg)", wordBreak: "break-word" }}>
          {body ? renderBodyWithMentions(body) : <span style={{ opacity: 0.3, fontStyle: "italic" }}>empty comment</span>}
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
        color: danger ? "#ef4444" : "color-mix(in srgb, var(--fg) 45%, transparent)",
        display: "flex", alignItems: "center", borderRadius: "4px",
        transition: "background 100ms ease-out, color 100ms ease-out",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 8%, transparent)"; e.currentTarget.style.color = danger ? "#ef4444" : "var(--fg)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = danger ? "#ef4444" : "color-mix(in srgb, var(--fg) 45%, transparent)"; }}
    >
      {children}
    </button>
  );
}

// ─── SuggestionCard ───────────────────────────────────────

function SuggestionCard({
  entry,
  readOnly,
  focused,
  onScrollTo,
  onAccept,
  onReject,
}: {
  entry: SuggestionEntry;
  readOnly: boolean;
  focused: boolean;
  onScrollTo: (pos: number) => void;
  onAccept?: (entry: SuggestionEntry) => void;
  onReject?: (entry: SuggestionEntry) => void;
}) {
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (focused) { setAnimating(true); const t = setTimeout(() => setAnimating(false), 1000); return () => clearTimeout(t); }
  }, [focused]);

  const accentColor = entry.kind === "addition" ? "#22c55e" : entry.kind === "deletion" ? "#ef4444" : "#f59e0b";

  return (
    <div
      data-item-id={entry.id}
      onClick={() => onScrollTo(entry.fullFrom)}
      style={{
        borderRadius: "10px",
        border: `1px solid ${animating ? accentColor : "color-mix(in srgb, var(--fg) 10%, transparent)"}`,
        background: animating ? `color-mix(in srgb, ${accentColor} 6%, var(--bg))` : "var(--bg)",
        padding: "0.75rem 0.85rem",
        marginBottom: "0.6rem",
        cursor: "pointer",
        transition: "border-color 600ms ease-out, background 600ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: accentColor }}>
          {entry.kind}
        </span>
        {entry.author && (
          <span style={{ fontSize: "0.72rem", color: "color-mix(in srgb, var(--fg) 45%, transparent)" }}>· {entry.author}</span>
        )}
      </div>
      <div style={{ fontSize: "0.8rem", lineHeight: 1.4, wordBreak: "break-word" }}>
        {entry.kind === "addition" && (
          <span style={{ color: "#22c55e", background: "color-mix(in srgb, #22c55e 12%, transparent)", borderRadius: "3px", padding: "0.1rem 0.25rem" }}>
            +{(entry.addedText ?? "").length > 80 ? entry.addedText!.slice(0, 80) + "…" : entry.addedText}
          </span>
        )}
        {entry.kind === "deletion" && (
          <span style={{ color: "#ef4444", textDecoration: "line-through", background: "color-mix(in srgb, #ef4444 10%, transparent)", borderRadius: "3px", padding: "0.1rem 0.25rem" }}>
            {(entry.deletedText ?? "").length > 80 ? entry.deletedText!.slice(0, 80) + "…" : entry.deletedText}
          </span>
        )}
        {entry.kind === "substitution" && (
          <>
            <span style={{ color: "#ef4444", textDecoration: "line-through", opacity: 0.7 }}>{(entry.oldText ?? "").slice(0, 60)}</span>
            <span style={{ opacity: 0.3, margin: "0 0.3rem" }}>→</span>
            <span style={{ color: "#22c55e", background: "color-mix(in srgb, #22c55e 12%, transparent)", borderRadius: "3px", padding: "0.1rem 0.25rem" }}>{(entry.newText ?? "").slice(0, 60)}</span>
          </>
        )}
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onAccept?.(entry)} style={{ fontSize: "0.72rem", padding: "0.2rem 0.6rem", borderRadius: "6px", border: "1px solid #22c55e", color: "#22c55e", background: "none", cursor: "pointer", fontFamily: "var(--font-ui)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, #22c55e 10%, transparent)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>Accept</button>
          <button onClick={() => onReject?.(entry)} style={{ fontSize: "0.72rem", padding: "0.2rem 0.6rem", borderRadius: "6px", border: "1px solid #ef4444", color: "#ef4444", background: "none", cursor: "pointer", fontFamily: "var(--font-ui)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, #ef4444 10%, transparent)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>Reject</button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────

const mentionRegex = /@\[(.+?)\]\(user:(.+?)\)/g;

function hasMentions(text: string): boolean {
  return /@\[.+?\]\(user:.+?\)/.test(text);
}

function renderBodyWithMentions(body: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(mentionRegex.source, "g");
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    const name = match[1];
    parts.push(
      <span key={match.index} style={{ fontWeight: 700, color: authorColorFromName(name) }}>@{name}</span>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts.length > 0 ? parts : body;
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "0.82rem",
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
