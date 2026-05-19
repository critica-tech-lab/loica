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
  const [showResolved, setShowResolved] = useState(false);

  const activeThreads = threads.filter((t) => !t.resolved);
  const resolvedCount = threads.length - activeThreads.length;
  const visibleThreads = showResolved ? threads : activeThreads;
  const totalCount = activeThreads.length + suggestions.length;

  const mergedItems: ListItem[] = [
    ...visibleThreads.map((thread): ListItem => ({ type: "thread", thread, top: thread.top })),
    ...suggestions.map((entry): ListItem => ({ type: "suggestion", entry, top: entry.top })),
  ].sort((a, b) => a.top - b.top);

  const focusedId = focusedThreadId || focusedSuggestionId;
  useEffect(() => {
    if (!focusedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-item-id="${focusedId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedId]);

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
            Comments{totalCount > 0 ? ` (${totalCount})` : ""}
          </span>
          {resolvedCount > 0 && (
            <button
              onClick={() => setShowResolved((s) => !s)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "0.6rem", color: "var(--fg)", opacity: 0.4 }}
            >
              {showResolved ? "hide resolved" : `${resolvedCount} resolved`}
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          style={closeBtnStyle}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >&times;</button>
      </div>

      <div ref={listRef} style={listStyle}>
        {mergedItems.length === 0 && (
          <div style={{ padding: "1rem 0.75rem", opacity: 0.4, fontSize: "0.78rem" }}>
            No comments or suggestions. Select text and use the toolbar to add one.
          </div>
        )}
        {mergedItems.map((item) => {
          if (item.type === "thread") {
            return (
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
            );
          }
          return (
            <SuggestionCard
              key={item.entry.id}
              entry={item.entry}
              readOnly={readOnly}
              focused={item.entry.id === focusedSuggestionId}
              onScrollTo={onScrollTo}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
            />
          );
        })}
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
  const [animating, setAnimating] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const [newCommentText, setNewCommentText] = useState("");

  const isNew = !thread.body && thread.replies.length === 0;

  // Auto-focus new empty threads for immediate typing
  useEffect(() => {
    if (isNew && newCommentRef.current) {
      newCommentRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (focused) {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [focused]);

  const accentColor = authorColorFromName(thread.userName);
  const isOwn = currentUserId === thread.userId;

  const handleReply = () => {
    const body = replyText.trim();
    if (!body) return;
    onReply(thread.id, body);
    if (hasMentions(body)) onMention?.(body);
    setReplyText("");
    onFinish?.();
  };

  const handleNewCommentSave = () => {
    const body = newCommentText.trim();
    if (!body) return;
    onEditComment(thread.id, body);
    if (hasMentions(body)) onMention?.(body);
    onFinish?.();
  };

  const handleNewCommentCancel = () => {
    if (!newCommentText.trim()) {
      onDeleteComment(thread.id);
    }
  };

  return (
    <div
      data-item-id={thread.id}
      style={{
        ...cardStyle,
        borderLeftColor: `color-mix(in srgb, ${accentColor} 70%, transparent)`,
        opacity: thread.resolved ? 0.5 : 1,
        ...(animating ? {
          background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
          transition: "background 1.2s ease-out",
        } : {
          background: "transparent",
          transition: "background 0.3s ease-out",
        }),
      }}
    >
      {/* Excerpt — click to scroll */}
      {thread.anchorText && !thread.anchorDeleted && (
        <div
          style={{ ...excerptStyle, background: `color-mix(in srgb, ${accentColor} 18%, transparent)` }}
          onClick={() => onScrollTo(thread.from)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") onScrollTo(thread.from); }}
        >
          {thread.anchorText.length > 100
            ? thread.anchorText.slice(0, 100) + "..."
            : thread.anchorText}
        </div>
      )}
      {thread.anchorDeleted && thread.anchorText && (
        <div style={{ ...excerptStyle, opacity: 0.4, fontStyle: "italic" }}>
          {thread.anchorText.length > 100
            ? thread.anchorText.slice(0, 100) + "..."
            : thread.anchorText}
          <div style={{ fontSize: "0.65rem", marginTop: "0.15rem" }}>Original text was removed</div>
        </div>
      )}

      {/* Root comment — inline editable for new empty threads */}
      {isNew ? (
        <div>
          <div style={{ ...authorStyle, color: accentColor, marginBottom: "0.15rem" }}>{thread.userName}</div>
          <MentionTextarea
            ref={newCommentRef}
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleNewCommentSave();
              }
              if (e.key === "Escape") {
                handleNewCommentCancel();
              }
            }}
            onBlur={() => {
              if (!newCommentText.trim()) {
                handleNewCommentCancel();
              }
            }}
            onSubmit={handleNewCommentSave}
            placeholder="Write a comment..."
            style={textareaStyle}
            rows={1}
          />
        </div>
      ) : (
        <CommentBody
          commentId={thread.id}
          userName={thread.userName}
          body={thread.body}
          createdAt={thread.createdAt}
          isOwn={isOwn}
          readOnly={readOnly}
          accentColor={accentColor}
          onEdit={onEditComment}
          onDelete={onDeleteComment}
          onMention={onMention}
        />
      )}

      {/* Replies */}
      {thread.replies.map((reply) => (
        <div key={reply.id} style={{ marginLeft: "0.75rem", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
          <CommentBody
            commentId={reply.id}
            userName={reply.userName}
            body={reply.body}
            createdAt={reply.createdAt}
            isOwn={currentUserId === reply.userId}
            readOnly={readOnly}
            accentColor={authorColorFromName(reply.userName)}
            onEdit={onEditComment}
            onDelete={onDeleteComment}
            onMention={onMention}
          />
        </div>
      ))}

      {/* Reply input + actions (hidden for new empty threads) */}
      {!readOnly && !isNew && (
        <div style={{ marginTop: "0.4rem" }}>
          <MentionTextarea
            ref={replyRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleReply();
              }
            }}
            onSubmit={handleReply}
            submitLabel="Press Enter to reply"
            placeholder="Reply..."
            style={{ ...textareaStyle, opacity: replyText ? 1 : 0.5 }}
            rows={1}
          />
          <div style={actionsRowStyle}>
            {canResolve && (
              <button
                onClick={() => thread.resolved ? onUnresolveThread(thread.id) : onResolveThread(thread.id)}
                style={actionLinkStyle}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
              >
                {thread.resolved ? "REOPEN" : "RESOLVE"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CommentBody (shared between root + replies) ─────────

function CommentBody({
  commentId,
  userName,
  body,
  createdAt,
  isOwn,
  readOnly,
  accentColor,
  onEdit,
  onDelete,
  onMention,
}: {
  commentId: string;
  userName: string;
  body: string;
  createdAt: number;
  isOwn: boolean;
  readOnly: boolean;
  accentColor: string;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  onMention?: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync external body changes
  useEffect(() => {
    if (!editing) setEditValue(body);
  }, [body, editing]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "0";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [editValue, editing]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const timeStr = timeAgo(createdAt);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.35rem", marginBottom: "0.15rem" }}>
        <span style={{ ...authorStyle, color: accentColor }}>{userName}</span>
        <span style={{ fontSize: "0.6rem", opacity: 0.3 }}>{timeStr}</span>
      </div>

      {editing ? (
        <MentionTextarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEdit(commentId, editValue);
              if (hasMentions(editValue) && editValue !== body) onMention?.(editValue);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setEditValue(body);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (editValue !== body) {
              onEdit(commentId, editValue);
              if (hasMentions(editValue)) onMention?.(editValue);
            }
            setEditing(false);
          }}
          onSubmit={() => {
            onEdit(commentId, editValue);
            if (hasMentions(editValue) && editValue !== body) onMention?.(editValue);
            setEditing(false);
          }}
          submitLabel="Press Enter to save"
          style={textareaStyle}
          rows={1}
        />
      ) : (
        <div style={readOnlyTextStyle}>
          {body ? renderBodyWithMentions(body) : <span style={{ opacity: 0.3 }}>empty comment</span>}
        </div>
      )}

      {!readOnly && isOwn && !editing && (
        <div style={{ ...actionsRowStyle, marginTop: "0.15rem" }}>
          <button
            onClick={() => setEditing(true)}
            style={{ ...actionLinkStyle, fontSize: "0.55rem" }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            EDIT
          </button>
          <button
            onClick={() => onDelete(commentId)}
            style={{ ...actionLinkStyle, fontSize: "0.55rem", color: "#ef4444" }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            DELETE
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SuggestionCard (unchanged) ──────────────────────────

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
    if (focused) {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [focused]);

  const accentColor =
    entry.kind === "addition" ? "#22c55e" :
    entry.kind === "deletion" ? "#ef4444" :
    "#f59e0b";

  const authorColor = authorColorFromName(entry.author);

  return (
    <div
      data-item-id={entry.id}
      style={{
        ...cardStyle,
        borderLeftColor: `color-mix(in srgb, ${accentColor} 70%, transparent)`,
        cursor: "pointer",
        ...(animating ? {
          background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
          transition: "background 1.2s ease-out",
        } : {
          background: "transparent",
          transition: "background 0.3s ease-out",
        }),
      }}
      onClick={() => onScrollTo(entry.fullFrom)}
    >
      {entry.author && (
        <div style={{ ...authorStyle, color: authorColor }}>{entry.author}</div>
      )}

      <div style={{
        fontSize: "0.6rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: accentColor,
        marginBottom: "0.3rem",
      }}>
        {entry.kind}
      </div>

      <div style={{ fontSize: "0.75rem", lineHeight: 1.4, wordBreak: "break-word" }}>
        {entry.kind === "addition" && (
          <span style={{
            color: "#22c55e",
            background: "color-mix(in srgb, #22c55e 12%, transparent)",
            borderRadius: "2px",
            padding: "0.05rem 0.2rem",
          }}>
            +{(entry.addedText ?? "").length > 80 ? entry.addedText!.slice(0, 80) + "..." : entry.addedText}
          </span>
        )}
        {entry.kind === "deletion" && (
          <span style={{
            color: "#ef4444",
            textDecoration: "line-through",
            background: "color-mix(in srgb, #ef4444 10%, transparent)",
            borderRadius: "2px",
            padding: "0.05rem 0.2rem",
          }}>
            {(entry.deletedText ?? "").length > 80 ? entry.deletedText!.slice(0, 80) + "..." : entry.deletedText}
          </span>
        )}
        {entry.kind === "substitution" && (
          <>
            <span style={{
              color: "#ef4444",
              textDecoration: "line-through",
              opacity: 0.7,
            }}>
              {(entry.oldText ?? "").length > 60 ? entry.oldText!.slice(0, 60) + "..." : entry.oldText}
            </span>
            <span style={{ opacity: 0.3, margin: "0 0.25rem" }}>&rarr;</span>
            <span style={{
              color: "#22c55e",
              background: "color-mix(in srgb, #22c55e 12%, transparent)",
              borderRadius: "2px",
              padding: "0.05rem 0.2rem",
            }}>
              {(entry.newText ?? "").length > 60 ? entry.newText!.slice(0, 60) + "..." : entry.newText}
            </span>
          </>
        )}
      </div>

      {!readOnly && (
        <div style={{ ...actionsRowStyle, marginTop: "0.4rem" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccept?.(entry);
            }}
            style={{ ...actionLinkStyle, color: "#22c55e" }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            ACCEPT
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject?.(entry);
            }}
            style={{ ...actionLinkStyle, color: "#ef4444" }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            REJECT
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────


// ─── Mention helpers ─────────────────────────────────────

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
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    const name = match[1];
    parts.push(
      <span key={match.index} style={{ fontWeight: 700, color: authorColorFromName(name) }}>
        @{name}
      </span>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }
  return parts.length > 0 ? parts : body;
}

// ─── Styles ──────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  width: "min(22rem, 35vw)",
  minWidth: "16rem",
  flexShrink: 0,
  background: "var(--bg)",
  borderLeft: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem",
  borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "1.2rem",
  color: "var(--fg)",
  cursor: "pointer",
  padding: "0 0.25rem",
  opacity: 0.5,
  transition: "opacity 150ms ease-out",
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0.25rem 0",
};

const cardStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  borderLeft: "3px solid",
  marginLeft: "0.5rem",
  marginBottom: "0.5rem",
};

const authorStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.02em",
  opacity: 0.55,
};

const excerptStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  lineHeight: 1.4,
  padding: "0.2rem 0.4rem",
  borderRadius: "3px",
  marginBottom: "0.4rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  cursor: "pointer",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "0.78rem",
  lineHeight: "1.5",
  background: "none",
  border: "none",
  color: "var(--fg)",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  padding: 0,
};

const readOnlyTextStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const actionsRowStyle: React.CSSProperties = {
  marginTop: "0.35rem",
  display: "flex",
  gap: "0.75rem",
};

const actionLinkStyle: React.CSSProperties = {
  fontSize: "0.6rem",
  fontWeight: 600,
  letterSpacing: "0.05em",
  background: "none",
  border: "none",
  color: "var(--fg)",
  cursor: "pointer",
  padding: 0,
  opacity: 0.5,
};
