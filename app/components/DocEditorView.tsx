import { AppShell } from "~/components/AppShell";
import { ProseMirrorEditor } from "~/components/ProseMirrorEditor";
import { PMToolbar } from "~/components/PMToolbar";
import { TrackChangePopup } from "~/components/TrackChangePopup";
import type { PMActiveState, EditingMode } from "~/components/editor/types";
import { UserMenu } from "~/components/UserMenu";
import { DocMenu } from "~/components/DocMenu";
import type { DocMenuItem } from "~/components/DocMenu";
import { Editor } from "~/components/Editor";
import { useToast } from "~/components/Toast";
import { consumeUndoCreate } from "~/lib/undoCreate";
import { useFetcher, useNavigate } from "react-router";
import { extensionTemplates } from "~/extensions";
import { useDocTypeExtension } from "~/extensions/hooks";
import { Toolbar } from "~/components/Toolbar";
import { LinkModal } from "~/components/LinkModal";
import { PresenceIndicator } from "~/components/PresenceIndicator";
import { SidePanel } from "~/components/SidePanel";
import { CommentIcon, ShareIcon, StarIcon, ClockIcon, DocIcon, TrashIcon } from "~/components/icons";
import { useDocument, userColor } from "~/lib/DocumentContext";
import type { DocumentProps } from "~/lib/DocumentContext";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { diffWords } from "diff";

const TOOLBAR_OPEN_KEY = "loica.docToolbar.open";
const USE_PM = import.meta.env.VITE_PM_EDITOR === "1";
export type { DocumentProps as DocEditorViewProps };

export function DocEditorView(_props: DocumentProps) {
  const ctx = useDocument();
  const {
    document,
    user,
    canEdit,
    wsUrl,

    title,
    content,
    setPeers,
    editorKey,
    editorReady,
    mounted,

    comments,
    setComments,
    trackChangesState,
    setTrackChangesState,
    activePanel,
    setActivePanel,
    togglePanel,
    focusedCommentId,
    setFocusedCommentId,
    setFocusedSuggestionId,
    setSelectionBubble,
    setConnectionStatus,

    hasCustomEditor,
    spellLang,

    scheduleSave,
    handleContentChange,
    registerEditorApi,
    historyPreview,
  } = ctx;

  // Look up the extension EditorView (if any) for this doc type. When the
  // extension owns the editing surface, we mount its component instead of
  // the default markdown editor and hide the markdown toolbar/footer.
  // Hook gates on the admin's enabled set: a disabled extension returns
  // null, so the doc falls back to the plain markdown editor.
  const docTypeExtension = useDocTypeExtension(ctx.docType ?? null);
  const ExtensionEditor = docTypeExtension?.EditorView ?? null;

  // Default visible — users who want it hidden dismiss with ×, preference sticks.
  // SSR-safe: start with the default, then reconcile with localStorage on mount.
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [pmActiveState, setPmActiveState] = useState<PMActiveState | null>(null);
  const [editingMode, setEditingMode] = useState<EditingMode>("editing");
  const [trackPopup, setTrackPopup] = useState<{ changeId: string; pos: { x: number; y: number } } | null>(null);
  const focusComment = useCallback((id: string | null) => {
    setFocusedCommentId(id);
  }, [setFocusedCommentId]);

  // ── Undo-create toast ─────────────────────────────────
  // If this doc was just created (flash arming happens at the caller before
  // the redirect), show a toast with an Undo action that trashes the doc
  // and navigates back to where we came from.
  const { toast } = useToast();
  const navigate = useNavigate();
  const undoCreateFetcher = useFetcher();
  useEffect(() => {
    const flash = consumeUndoCreate();
    if (!flash) return;
    // Cross-check freshness against the doc itself — if the user navigated
    // to an existing doc within the flash window, we must NOT show a bogus
    // "just created" toast.
    const createdAtMs = document.created_at ? new Date(document.created_at).getTime() : 0;
    if (!createdAtMs || Date.now() - createdAtMs > 60_000) return;

    const tpl = extensionTemplates.find((t) => t.id === flash.kind);
    const label = tpl ? `${tpl.label} created` : "Document created";
    const docId = document.id;
    const returnTo = flash.returnTo;
    toast(label, {
      type: "success",
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          undoCreateFetcher.submit(
            { intent: "delete", docId },
            { method: "post", action: returnTo },
          );
          navigate(returnTo);
        },
      },
    });
    // Intentionally empty deps — this runs once per DocEditorView mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Link modal is opened from the selection bubble, the pill toolbar,
  // or from clicking Edit on an existing link in the editor.
  const [linkModal, setLinkModal] = useState<
    | { mode: "add"; initialUrl?: string; onApply: (url: string) => void }
    | { mode: "edit"; initialUrl: string; onApply: (url: string) => void }
    | null
  >(null);
  const openLinkModal = useCallback(() => {
    setLinkModal({
      mode: "add",
      onApply: (url) => {
        ctx.editorApi.current?.format("[", `](${url})`);
      },
    });
  }, [ctx]);
  const openEditLinkModal = useCallback((currentUrl: string, apply: (newUrl: string) => void) => {
    setLinkModal({
      mode: "edit",
      initialUrl: currentUrl,
      onApply: apply,
    });
  }, []);
  // Hydrate toolbar visibility on mount.
  // Freshly-created docs (< 60s old) always show the toolbar regardless of the
  // stored preference — first impression matters more than power-user muscle
  // memory, and the user can still dismiss it afterwards.
  useEffect(() => {
    const createdAtMs = document.created_at ? new Date(document.created_at).getTime() : 0;
    const isFreshDoc = createdAtMs && Date.now() - createdAtMs < 60_000;
    if (isFreshDoc) {
      setToolbarOpen(true);
      return;
    }
    try {
      const saved = localStorage.getItem(TOOLBAR_OPEN_KEY);
      if (saved === "0") setToolbarOpen(false);
      else if (saved === "1") setToolbarOpen(true);
    } catch { /* localStorage unavailable — stay on default */ }
  }, [document.created_at]);
  const toggleToolbar = useCallback(() => {
    setToolbarOpen((v) => {
      const next = !v;
      try { localStorage.setItem(TOOLBAR_OPEN_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);
  const closeToolbar = useCallback(() => {
    setToolbarOpen(false);
    try { localStorage.setItem(TOOLBAR_OPEN_KEY, "0"); } catch {}
  }, []);
  // ⌘/ toggles the formatting toolbar. Esc closes it when open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        toggleToolbar();
      } else if (e.key === "Escape" && toolbarOpen) {
        const activeTag = (e.target as HTMLElement | null)?.tagName;
        if (activeTag !== "INPUT" || (e.target as HTMLInputElement).type !== "search") {
          closeToolbar();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleToolbar, closeToolbar, toolbarOpen]);

  return (
    <AppShell
      navLeft={<DocNavLeft />}
      navActions={<DocNavActions toolbarOpen={toolbarOpen} onToggleToolbar={toggleToolbar} />}
      footerLeft={<DocFooterLeft />}
      footerCenter={hasCustomEditor ? null : <DocFooterCenter />}
      sidebar={null}
    >
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0, position: "relative" }}>
        {/* Shimmer skeleton while editor loads */}
        {!editorReady && (
          <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", overflow: "hidden" }}>
            <div style={{ maxWidth: "70ch", margin: "0 auto", padding: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[0.6, 1, 1, 0.8, 1, 0.5, 1, 0.9, 0.7, 1, 0.4].map((w, i) => (
                <div
                  key={i}
                  className="skeleton-line"
                  style={{ width: `${w * 100}%`, height: "0.9rem", borderRadius: "var(--radius-sm)", animationDelay: `${i * 50}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", opacity: editorReady ? 1 : 0, transition: "opacity 150ms ease-out", position: "relative" }}>
        {/* Suggesting mode banner */}
        {editingMode === "suggesting" && (
          <div style={{
            padding: "0.3rem 1rem",
            background: "color-mix(in srgb, #16a34a 10%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, #16a34a 25%, transparent)",
            fontSize: "0.75rem",
            color: "#15803d",
            fontFamily: "var(--font-ui)",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            flexShrink: 0,
          }}>
            <span>💬</span>
            <span><strong>You&apos;re suggesting.</strong> Your edits will be tracked and can be accepted or rejected.</span>
          </div>
        )}

        {historyPreview && (
          <HistoryPreviewPane
            content={historyPreview.content}
            title={historyPreview.title}
            label={historyPreview.label}
            currentContent={historyPreview.currentContent}
          />
        )}
        {!hasCustomEditor && (
          USE_PM
            ? <PMToolbar
                activeState={pmActiveState}
                trackChangesState={trackChangesState}
                editingMode={editingMode}
                onLink={openLinkModal}
                onOpenChangesPanel={() => setActivePanel(activePanel === "changes" ? null : "changes")}
                onModeChange={(mode) => {
                  const prev = editingMode;
                  setEditingMode(mode);
                  const api = ctx.editorApi.current;
                  if (mode === "suggesting" && prev !== "suggesting") {
                    if (!trackChangesState?.enabled) api?.toggleTrackChanges?.();
                    api?.setViewOnly?.(false);
                  } else if (mode === "editing") {
                    if (trackChangesState?.enabled) api?.toggleTrackChanges?.();
                    api?.setViewOnly?.(false);
                  } else if (mode === "viewing") {
                    if (trackChangesState?.enabled) api?.toggleTrackChanges?.();
                    api?.setViewOnly?.(true);
                  }
                }}
              />
            : toolbarOpen && <Toolbar variant="pill" onLink={openLinkModal} />
        )}
        {(() => {
          const Banner = docTypeExtension?.EditorBanner;
          return Banner ? (
            <Banner
              document={{ id: document.id, content }}
              isShared={ctx.isShared ?? false}
            />
          ) : null;
        })()}
        {ExtensionEditor && mounted ? (
          <ExtensionEditor
            key={editorKey}
            initialContent={document.content}
            onChange={(val) => {
              ctx.setContent(val);
              scheduleSave(title, val);
            }}
            onReady={() => { ctx.setEditorReady(true); }}
            readOnly={!canEdit}
            docId={document.id}
            wsUrl={wsUrl}
            userInfo={{ name: user.name, color: userColor(user.id) }}
            onConnectionStatus={setConnectionStatus}
            onPresenceChange={setPeers}
          />
        ) : USE_PM ? (
          <ProseMirrorEditor
            key={editorKey}
            docId={document.id}
            wsUrl={wsUrl}
            userInfo={{ name: user.name, color: userColor(user.id) }}
            currentUserId={user.id}
            readOnly={!canEdit}
            autoFocus={canEdit}
            onReady={(api) => registerEditorApi(api)}
            onPresenceChange={setPeers}
            onConnectionStatus={setConnectionStatus}
            onChange={handleContentChange}
            onStateChange={setPmActiveState}
            onTrackChangesStateChange={setTrackChangesState}
            onTrackChangeClick={(changeId, pos) => setTrackPopup({ changeId, pos })}
            focusedCommentId={focusedCommentId}
            onThreadsChange={setComments}
            onThreadClick={(thread) => {
              setActivePanel("comments");
              focusComment(thread.id);
              setFocusedSuggestionId(null);
            }}
            onSelectionChange={(sel) => {
              if (!sel) {
                // Editor blurred (click into panel etc) — clear bubble/focus but keep panel open
                setSelectionBubble(null);
                focusComment(null);
                return;
              }
              if (sel.to > sel.from) {
                // Range selection
                setSelectionBubble({ top: sel.top, left: sel.left });
                const hit = comments.find(
                  t => !t.resolved && t.from > 0 && t.to > t.from
                    && sel.from < t.to && sel.to > t.from
                );
                focusComment(hit?.id ?? null);
                if (hit) setActivePanel("comments");
              } else {
                // Cursor click inside editor — close comments panel if cursor not on commented text
                setSelectionBubble(null);
                focusComment(null);
                if (activePanel === "comments") setActivePanel(null);
              }
            }}
          />
        ) : (
          <Editor
            key={editorKey}
            initialValue={document.content}
            onChange={handleContentChange}
            onThreadsChange={setComments}
            onThreadClick={(thread) => {
              setActivePanel("comments");
              setFocusedCommentId(thread.id);
              setFocusedSuggestionId(null);
            }}
            onSelectionChange={(sel) => {
              if (sel && sel.to > sel.from) {
                setSelectionBubble({ top: sel.top, left: sel.left });
              } else {
                setSelectionBubble(null);
              }
            }}
            onReady={(api) => registerEditorApi(api)}
            onEditLink={openEditLinkModal}
            onPresenceChange={setPeers}
            autoFocus={canEdit}
            readOnly={!canEdit}
            docId={document.id}
            wsUrl={wsUrl}
            currentUserId={user.id}
            userInfo={{ name: user.name, color: userColor(user.id) }}
            userName={user.name}
            spellLang={spellLang}
            onConnectionStatus={setConnectionStatus}
          />
        )}
        </div>

        <SelectionBubble onLink={openLinkModal} />

        {/* Track change inline popup */}
        {trackPopup && (() => {
          const change = trackChangesState?.changes.find(c => c.id === trackPopup.changeId);
          return change ? (
            <TrackChangePopup
              change={change}
              pos={trackPopup.pos}
              onAccept={(id) => { ctx.editorApi.current?.acceptChangeById?.(id); }}
              onReject={(id) => { ctx.editorApi.current?.rejectChangeById?.(id); }}
              onDismiss={() => setTrackPopup(null)}
            />
          ) : null;
        })()}

        {/* Side panel */}
        {activePanel && <SidePanel />}

        <LinkModal
          open={linkModal !== null}
          mode={linkModal?.mode ?? "add"}
          initialUrl={linkModal?.initialUrl ?? ""}
          onCancel={() => setLinkModal(null)}
          onSubmit={(url) => {
            linkModal?.onApply(url);
            setLinkModal(null);
          }}
        />
      </div>
    </AppShell>
  );
}

function HistoryPreviewPane({
  content,
  title,
  label,
  currentContent,
}: {
  content: string;
  title: string;
  label: string;
  currentContent: string;
}) {
  // Merged diff view: walk through each part from diffWords and render it with
  // styling that reflects what happens if the user restores this version.
  // - part.removed (in version, not in current) → will be RECOVERED → green
  // - part.added   (in current, not in version) → will be LOST → red strikethrough
  // - unchanged                                 → normal
  const parts = useMemo(() => diffWords(content, currentContent), [content, currentContent]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "0.5rem 1rem",
          background: "color-mix(in srgb, var(--accent) 12%, transparent)",
          borderBottom: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          fontSize: "0.75rem",
          color: "var(--fg)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Viewing version:</span>
        <span>{label}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 1rem" }}>
        <div
          className="markdown-preview"
          style={{
            maxWidth: "70ch",
            margin: "0 auto",
            fontFamily: "var(--font-editor)",
            fontSize: "0.95rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {title && (
            <h1 style={{ marginTop: 0, fontSize: "1.5rem" }}>
              {title}
            </h1>
          )}
          {parts.map((p, i) => {
            if (p.removed) {
              return (
                <span
                  key={i}
                  style={{
                    background: "color-mix(in srgb, #22c55e 18%, transparent)",
                    borderRadius: "2px",
                  }}
                >
                  {p.value}
                </span>
              );
            }
            if (p.added) {
              return (
                <span
                  key={i}
                  style={{
                    background: "color-mix(in srgb, #ef4444 18%, transparent)",
                    textDecoration: "line-through",
                    borderRadius: "2px",
                  }}
                >
                  {p.value}
                </span>
              );
            }
            return <span key={i}>{p.value}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

function SelectionBubble({ onLink }: { onLink: () => void }) {
  const { selectionBubble, setSelectionBubble, editorApi, setActivePanel, setFocusedCommentId, canEdit } = useDocument();
  if (!selectionBubble) return null;

  const dismiss = () => setSelectionBubble(null);
  const runFormat = (before: string, after: string) => {
    editorApi.current?.format(before, after);
    dismiss();
  };
  const runLink = () => {
    dismiss();
    onLink();
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: "fixed",
        top: selectionBubble.top - 42,
        left: selectionBubble.left,
        zIndex: 60,
        display: "inline-flex",
        alignItems: "stretch",
        background: "var(--fg)",
        color: "var(--bg)",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(16,15,15,0.25), 0 2px 6px rgba(16,15,15,0.15)",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      {canEdit && (
        <>
          <BubbleBtn label="B" title="Bold (⌘B)" onActivate={() => runFormat("**", "**")} style={{ fontWeight: 700 }} />
          <BubbleBtn label="I" title="Italic (⌘I)" onActivate={() => runFormat("*", "*")} style={{ fontStyle: "italic" }} />
          <BubbleBtn
            title="Highlight"
            onActivate={() => runFormat("{==", "==}")}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l6 6" />
                <path d="M4 20l4-1 11-11-3-3-11 11z" />
                <line x1="14" y1="6" x2="18" y2="10" />
              </svg>
            }
          />
          <BubbleBtn label="Link" title="Link (⌘K)" onActivate={runLink} style={{ textDecoration: "underline", textUnderlineOffset: "2px" }} />
          <BubbleSep />
        </>
      )}
      <BubbleBtn
        label="Comment"
        title="Add comment"
        onActivate={() => {
          const id = editorApi.current?.addComment() ?? null;
          setActivePanel("comments");
          setFocusedCommentId(id);
          dismiss();
        }}
      />
    </div>
  );
}

function BubbleBtn({
  label,
  icon,
  title,
  style,
  onActivate,
}: {
  label?: string;
  icon?: React.ReactNode;
  title: string;
  style?: React.CSSProperties;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onActivate();
      }}
      style={{
        minWidth: "32px",
        padding: "0 10px",
        height: "32px",
        background: "transparent",
        color: "inherit",
        border: "none",
        cursor: "pointer",
        fontSize: "13px",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        transition: "background 80ms ease-out",
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--bg) 15%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
      {label}
    </button>
  );
}

function BubbleSep() {
  return (
    <span
      aria-hidden
      style={{
        width: "1px",
        alignSelf: "stretch",
        background: "color-mix(in srgb, var(--bg) 18%, transparent)",
      }}
    />
  );
}

// ─── Navbar components ──────────────────────────────────

/**
 * Navbar left: parent-folder back-link + compact editable title + inline star.
 * Kept small here (rather than in the body) so it doesn't compete visually with
 * the `# Title` heading that most Loica docs still carry as their first line.
 */
function DocNavLeft() {
  const {
    isShared,
    folderPath,
    baseUrl,
    canEdit,
    title,
    setTitle,
    content,
    scheduleSave,
    titleSetByUser,
  } = useDocument();

  const parentHref = isShared
    ? (folderPath.length > 0 ? `/shared/folder/${folderPath[folderPath.length - 1].id}` : "/shared")
    : (folderPath.length > 0 ? `${baseUrl}/folder/${folderPath[folderPath.length - 1].id}` : baseUrl);
  const parentLabel = folderPath.length > 0
    ? folderPath[folderPath.length - 1].name
    : (isShared ? "Shared" : "Files");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
      <a
        href={parentHref}
        title={`Back to ${parentLabel}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          color: "color-mix(in srgb, var(--fg) 55%, transparent)",
          textDecoration: "none",
          fontSize: "0.75rem",
          padding: "0.15rem 0.3rem",
          borderRadius: "4px",
          flexShrink: 0,
          transition: "background 120ms ease-out, color 120ms ease-out",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
          e.currentTarget.style.color = "var(--fg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "color-mix(in srgb, var(--fg) 55%, transparent)";
        }}
      >
        <span>←</span>
        <span style={{ maxWidth: "10ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parentLabel}</span>
      </a>
      {canEdit ? (
        <input
          value={title}
          maxLength={80}
          onChange={(e) => {
            titleSetByUser.current = true;
            setTitle(e.target.value);
            scheduleSave(e.target.value, content);
          }}
          placeholder="Untitled"
          style={{
            minWidth: 0,
            flex: "0 1 auto",
            fontFamily: "var(--font-ui)",
            fontSize: "0.85rem",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            background: "none",
            border: "none",
            color: "var(--fg)",
            outline: "none",
            padding: "0.1rem 0.25rem",
            borderRadius: "4px",
          }}
        />
      ) : (
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-ui)",
            fontSize: "0.85rem",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: "var(--fg)",
          }}
        >
          {title || "Untitled"}
        </span>
      )}
    </div>
  );
}


function DocNavActions({
  toolbarOpen,
  onToggleToolbar,
}: {
  toolbarOpen: boolean;
  onToggleToolbar: () => void;
}) {
  const {
    user,
    isShared,
    sessionUser,
    document,
    togglePanel,
    comments,
    isStarred,
    toggleStar,
    canEdit,
    docType,
    role,
  } = useDocument();
  const docTypeExtension = useDocTypeExtension(docType);
  const trashFetcher = useFetcher();
  const canTrash = !isShared && canEdit && (role === "owner" || role === "admin");
  const trashDoc = () => {
    if (!window.confirm("Move this document to trash? You can restore it later from the Trash page.")) return;
    trashFetcher.submit({ intent: "trash-doc" }, { method: "post" });
  };
  const unreadComments = comments.filter((c) => !c.resolved).length;
  // Only surface the Comments button when there's something to read — adds UI
  // pressure only for docs that actually have a conversation on them.
  // First comment is created via the selection bubble (+ Comment).
  const hasComments = comments.length > 0;

  const { editorApi, title } = useDocument();
  const download = (kind: "md" | "pdf" | "docx") => {
    if (USE_PM && kind === "docx") {
      editorApi.current?.exportDocx?.(`${title || "document"}.docx`);
      return;
    }
    const path =
      kind === "md" ? `/api/doc-download/${document.id}` :
      kind === "pdf" ? `/api/doc-pdf/${document.id}` :
      `/api/doc-docx/${document.id}`;
    window.open(path, "_blank");
  };

  // Extension-contributed menu items go at the top, separated from core actions.
  const extensionMenuItems = docTypeExtension?.getDocMenuItems?.({
    document: { id: document.id, content: document.content ?? "" },
    isShared: isShared ?? false,
  }) ?? [];

  const docMenuItems: DocMenuItem[] = [
    ...extensionMenuItems.flatMap<DocMenuItem>((item, i) => {
      const Icon = item.icon;
      return [
        {
          label: item.label,
          icon: Icon ? <Icon className="w-[14px] h-[14px]" /> : undefined,
          onClick: item.onClick,
        },
        // Trailing separator only after the last contributed item.
        ...(i === extensionMenuItems.length - 1 ? [{ kind: "separator" } as DocMenuItem] : []),
      ];
    }),
    // Favorites only make sense for authenticated users with a doc they can see
    // in their workspace sidebar — hide for anon view-only visitors.
    ...(canEdit || !isShared
      ? [
          {
            label: isStarred ? "Favorited" : "Favorite",
            icon: <StarIcon filled={isStarred} className="w-[14px] h-[14px]" />,
            onClick: toggleStar,
          } as DocMenuItem,
          { kind: "separator" } as DocMenuItem,
        ]
      : []),
    {
      label: "Formatting",
      title: "⌘/",
      icon: <FormatIcon />,
      onClick: onToggleToolbar,
    },
    {
      label: "History",
      icon: <ClockIcon className="w-[14px] h-[14px]" />,
      onClick: () => togglePanel("history"),
    },
    {
      label: "Info",
      icon: <DocIcon className="w-[14px] h-[14px]" />,
      onClick: () => togglePanel("info"),
    },
    { kind: "separator" },
    {
      kind: "pills",
      heading: "Download",
      items: [
        { label: "md",   title: "Markdown (.md)",          onClick: () => download("md") },
        { label: "pdf",  title: "PDF",                     onClick: () => download("pdf") },
        { label: "docx", title: "Microsoft Word (.docx)",  onClick: () => download("docx") },
      ],
    },
    ...(canTrash
      ? [
          { kind: "separator" } as DocMenuItem,
          {
            label: "Move to trash",
            icon: <TrashIcon className="w-[14px] h-[14px]" />,
            onClick: trashDoc,
          } as DocMenuItem,
        ]
      : []),
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
      <PresenceIndicator />
      {hasComments && (
        <TopbarIconBtn
          title={unreadComments > 0 ? `Comments · ${unreadComments} unread` : "Comments"}
          onClick={() => togglePanel("comments")}
        >
          <CommentIcon className="h-4 w-4" />
          {unreadComments > 0 && <TopbarBadge count={unreadComments} />}
        </TopbarIconBtn>
      )}
      <TopbarIconBtn title="Share this doc" onClick={() => togglePanel("share")}>
        <ShareIcon className="h-4 w-4" />
      </TopbarIconBtn>
      <DocMenu items={docMenuItems} />
      <span style={{ width: "6px" }} />
      {isShared ? (
        sessionUser && <UserMenu userName={sessionUser.name} isAdmin={Boolean(sessionUser.is_admin)} />
      ) : (
        <UserMenu userName={user.name} isAdmin={Boolean(user.is_admin)} />
      )}
    </div>
  );
}

// ─── Topbar primitives ────────────────────────────────────

function TopbarIconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        height: "28px",
        minWidth: "28px",
        padding: "0 8px",
        border: "none",
        background: "transparent",
        borderRadius: "5px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        color: "color-mix(in srgb, var(--fg) 55%, transparent)",
        position: "relative",
        transition: "background 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 5%, transparent)";
        e.currentTarget.style.color = "var(--fg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "color-mix(in srgb, var(--fg) 55%, transparent)";
      }}
    >
      {children}
    </button>
  );
}

/** Typography "Aa" glyph for the formatting-toolbar menu item. */
function FormatIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        fontFamily: "var(--font-ui)",
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: "13px", fontWeight: 600 }}>A</span>
      <span style={{ fontSize: "9px", fontWeight: 500, marginLeft: "0.5px" }}>a</span>
    </span>
  );
}

function TopbarBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        position: "absolute",
        top: "2px",
        right: "2px",
        minWidth: "15px",
        height: "15px",
        padding: "0 4px",
        background: "var(--color-scarlet)",
        color: "var(--bg)",
        borderRadius: "999px",
        fontFamily: "var(--font-mono)",
        fontSize: "9.5px",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 0 2px var(--bg)",
      }}
    >
      {count}
    </span>
  );
}

// ─── Footer components ──────────────────────────────────

/**
 * Unified document status: connection + save state rolled into a single dot.
 * - sage  → connected & saved (steady state; no label)
 * - tawny → saving, or reconnecting to the websocket
 * - scarlet → disconnected
 */
function DocFooterLeft() {
  const { connectionStatus, saving } = useDocument();

  // Stoplight palette: green (all good) → yellow (in progress) → red (broken).
  // Flexoki's sage (#66800B) and green-400 (#879A39) are olive-leaning and read grey
  // at the 6-7px dot size, so we use saturated greens/yellows/reds to read at a glance.
  let color = "#16A34A"; // vivid green
  let label = "Saved";
  let showLabel = false;

  if (connectionStatus === "disconnected") {
    color = "#DC2626"; // vivid red
    label = "Offline";
    showLabel = true;
  } else if (connectionStatus === "connecting") {
    color = "#EAB308"; // vivid amber
    label = "Reconnecting…";
    showLabel = true;
  } else if (saving) {
    color = "#EAB308"; // vivid amber
    label = "Saving…";
    showLabel = true;
  }

  return (
    <span
      title={label}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "color-mix(in srgb, var(--fg) 55%, transparent)" }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          transition: "background 200ms ease-out",
        }}
      />
      {showLabel && <span>{label}</span>}
    </span>
  );
}

function DocFooterCenter() {
  const { docStats } = useDocument();
  return <span>{docStats.words.toLocaleString()} words</span>;
}
