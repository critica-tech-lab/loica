import { AppShell } from "~/components/AppShell";
import { ProseMirrorEditor } from "~/components/ProseMirrorEditor";
import { PMToolbar } from "~/components/PMToolbar";
import { CommentPopup } from "~/components/CommentPopup";
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

// ProseMirror is the default editor on this branch. Set VITE_PM_EDITOR=0 to
// fall back to the legacy CodeMirror editor.
const USE_PM = import.meta.env.VITE_PM_EDITOR !== "0";
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
    setFrontmatter,
    maybeAdoptTitle,
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
  const [pmActiveState, setPmActiveState] = useState<PMActiveState | null>(null);
  const [editingMode, setEditingMode] = useState<EditingMode>(() => {
    if (typeof window === "undefined") return "editing";
    const stored = localStorage.getItem(`loica.editingMode.${document.id}`);
    return (stored as EditingMode) ?? "editing";
  });
  const [commentPopup, setCommentPopup] = useState<{ threadId: string; pos: { x: number; y: number } } | null>(null);
  const [trackPopup, setTrackPopup] = useState<{ changeId: string; pos: { x: number; y: number } } | null>(null);

  // Re-apply mode when editor becomes ready (restores suggesting mode after reload)
  useEffect(() => {
    if (!editorReady) return;
    const api = ctx.editorApi.current;
    if (editingMode === "suggesting" && !trackChangesState?.enabled) {
      api?.toggleTrackChanges?.();
    } else if (editingMode === "viewing") {
      api?.setViewOnly?.(true);
    }
  }, [editorReady]);

  useEffect(() => {
    if (!trackPopup) return;
    const els = window.document.querySelectorAll<HTMLElement>(`[data-change-id="${trackPopup.changeId}"]`);
    els.forEach(el => el.classList.add("tc-focused"));
    return () => { els.forEach(el => el.classList.remove("tc-focused")); };
  }, [trackPopup]);

  const editorMountRef = useRef<HTMLDivElement | null>(null);
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
        ctx.editorApi.current?.addLink?.(url);
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

  return (
    <AppShell
      navLeft={<DocNavLeft />}
      navActions={<DocNavActions />}
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
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", opacity: editorReady ? 1 : 0, transition: "opacity var(--ease-out)", position: "relative" }}>
        {/* Suggesting mode banner */}
        {editingMode === "suggesting" && (
          <div style={{
            padding: "0.3rem 1rem",
            background: "color-mix(in srgb, var(--color-success) 10%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--color-success) 25%, transparent)",
            fontSize: "var(--text-sm)",
            color: "var(--color-success)",
            fontFamily: "var(--font-ui)",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            flexShrink: 0,
          }}>
            <CommentIcon width={15} height={15} style={{ flexShrink: 0 }} />
            <span><strong>You&apos;re suggesting.</strong> Your edits will be tracked and can be accepted or rejected.</span>
          </div>
        )}

        {historyPreview && (
          USE_PM && historyPreview.yjsState ? (
            <PMHistoryPreviewPane
              yjsState={historyPreview.yjsState}
              label={historyPreview.label}
              onDismiss={() => ctx.setHistoryPreview(null)}
              onRestore={historyPreview.versionId ? () => ctx.restoreVersion(historyPreview.versionId!) : undefined}
            />
          ) : (
            <HistoryPreviewPane
              content={historyPreview.content}
              title={historyPreview.title}
              label={historyPreview.label}
              currentContent={historyPreview.currentContent}
              onDismiss={() => ctx.setHistoryPreview(null)}
              onRestore={historyPreview.versionId ? () => ctx.restoreVersion(historyPreview.versionId!) : undefined}
            />
          )
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
                  try { localStorage.setItem(`loica.editingMode.${document.id}`, mode); } catch {}
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
            : null
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
          <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <ProseMirrorEditor
              key={editorKey}
              docId={document.id}
              wsUrl={wsUrl}
              userInfo={{ name: user.name, color: userColor(user.id) }}
              currentUserId={user.id}
              readOnly={!canEdit}
              autoFocus={canEdit}
              mountRefOut={editorMountRef}
              onReady={(api) => registerEditorApi(api)}
              onEditLink={openEditLinkModal}
              onPresenceChange={setPeers}
              onConnectionStatus={setConnectionStatus}
              onChange={handleContentChange}
              onFrontmatter={setFrontmatter}
              onTitle={(headingText, fullText) => maybeAdoptTitle(headingText, fullText)}
              onStateChange={setPmActiveState}
              onTrackChangesStateChange={setTrackChangesState}
              onTrackChangeClick={(changeId, pos) => setTrackPopup({ changeId, pos })}
              focusedCommentId={focusedCommentId}
              onThreadsChange={setComments}
              onThreadClick={(thread, pos) => {
                focusComment(thread.id);
                setFocusedSuggestionId(null);
                setCommentPopup({ threadId: thread.id, pos });
              }}
              onSelectionChange={(sel) => {
                if (!sel) {
                  setSelectionBubble(null);
                  focusComment(null);
                  return;
                }
                if (sel.to > sel.from) {
                  setSelectionBubble({ top: sel.top, left: sel.left });
                  const hit = comments.find(
                    t => !t.resolved && t.from > 0 && t.to > t.from
                      && sel.from < t.to && sel.to > t.from
                  );
                  focusComment(hit?.id ?? null);
                } else {
                  setSelectionBubble(null);
                  focusComment(null);
                  // Do NOT close commentPopup here — Y.js awareness transactions
                  // fire cursor-position selection changes after every click, which
                  // would close the popup before the user can interact with it.
                }
              }}
            />
            {USE_PM && commentPopup && (() => {
              const thread = comments.find(t => t.id === commentPopup.threadId);
              return thread ? (
                <CommentPopup
                  thread={thread}
                  pos={commentPopup.pos}
                  currentUserId={user.id}
                  editorApiRef={ctx.editorApi}
                  editorRef={editorMountRef}
                  onDismiss={() => { setCommentPopup(null); focusComment(null); }}
                  onMention={ctx.sendMention}
                />
              ) : null;
            })()}
            {USE_PM && trackPopup && (() => {
              const change = trackChangesState?.changes.find(c => c.ids.includes(trackPopup.changeId));
              return change ? (
                <TrackChangePopup
                  change={change}
                  pos={trackPopup.pos}
                  editorRef={editorMountRef}
                  onAccept={(id) => { ctx.editorApi.current?.acceptChangeById?.(id, change.ids, change.type); setTrackPopup(null); }}
                  onReject={(id) => { ctx.editorApi.current?.rejectChangeById?.(id, change.ids, change.type); setTrackPopup(null); }}
                  onDismiss={() => setTrackPopup(null)}
                />
              ) : null;
            })()}
          </div>
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

        <SelectionBubble onLink={openLinkModal} onCommentAdded={(id, pos) => setCommentPopup({ threadId: id, pos })} />


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

function PMHistoryPreviewPane({
  yjsState,
  label,
  onDismiss,
  onRestore,
}: {
  yjsState: string;
  label: string;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let view: any = null;

    async function init() {
      const [
        { EditorState },
        { EditorView },
        Y,
        { ySyncPlugin, ySyncPluginKey },
        { schema },
        { buildPlugins },
      ] = await Promise.all([
        import("prosemirror-state"),
        import("prosemirror-view"),
        import("yjs"),
        import("y-prosemirror"),
        import("~/components/editor/schema"),
        import("~/components/editor/plugins"),
      ]);

      if (destroyed || !containerRef.current) return;

      const ydoc = new Y.Doc();
      const stateBytes = Uint8Array.from(atob(yjsState), (c) => c.charCodeAt(0));
      Y.applyUpdate(ydoc, stateBytes);

      const yXmlFragment = ydoc.getXmlFragment("prosemirror");

      const plugins = [
        ...buildPlugins(schema, true), // readOnly=true
        ySyncPlugin(yXmlFragment),
      ];

      const state = EditorState.create({ schema, plugins });
      view = new EditorView(containerRef.current, {
        state,
        editable: () => false,
      });
    }

    init();
    return () => {
      destroyed = true;
      view?.destroy();
    };
  }, [yjsState]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--z-preview)",
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
          fontSize: "var(--text-sm)",
          color: "var(--fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>Viewing version:</span>
          <span style={{ opacity: 0.7 }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          {onRestore && (
            <button
              onClick={() => {
                if (confirm("Restore this version? Current content will be overwritten.")) {
                  onRestore();
                }
              }}
              title="Restore this version"
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                cursor: "pointer",
                padding: "0.3rem 0.6rem",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                fontFamily: "var(--font-ui)",
                transition: "opacity var(--ease-fast)",
                opacity: 0.9,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.9"; }}
            >
              Restore
            </button>
          )}
          <button
            onClick={onDismiss}
            title="Close preview"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              color: "var(--fg)",
              opacity: 0.6,
              fontSize: "var(--text-xl)",
              lineHeight: 1,
              transition: "opacity var(--ease-fast)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}
          >
            ×
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="pm-editor"
        style={{ flex: 1, overflow: "auto", padding: "1rem 2rem" }}
      />
    </div>
  );
}

function HistoryPreviewPane({
  content,
  title,
  label,
  currentContent,
  onDismiss,
  onRestore,
}: {
  content: string;
  title: string;
  label: string;
  currentContent: string;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  // diffWords(content, currentContent):
  // - part.removed = in content but not currentContent = added in this snapshot → green
  // - part.added   = in currentContent but not content = removed in this snapshot → red strikethrough
  const parts = useMemo(() => diffWords(content, currentContent), [content, currentContent]);
  const hasChanges = parts.some(p => p.added || p.removed);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--z-preview)",
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
          fontSize: "var(--text-sm)",
          color: "var(--fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}>Viewing version:</span>
          <span style={{ opacity: 0.8 }}>{label}</span>
          {hasChanges && (
            <span style={{ opacity: 0.5, fontSize: "var(--text-xs)", flexShrink: 0 }}>
              <span style={{ background: "color-mix(in srgb, var(--color-success) 30%, transparent)", borderRadius: "var(--radius-sm)", padding: "0 3px" }}>added</span>
              {" "}
              <span style={{ background: "color-mix(in srgb, var(--color-danger) 25%, transparent)", borderRadius: "var(--radius-sm)", padding: "0 3px", textDecoration: "line-through" }}>removed</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          {onRestore && (
            <button
              onClick={() => { if (confirm("Restore this version? Current content will be overwritten.")) onRestore(); }}
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                cursor: "pointer",
                padding: "0.25rem 0.6rem",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                fontFamily: "var(--font-ui)",
              }}
            >
              Restore
            </button>
          )}
          <button
            onClick={onDismiss}
            title="Close preview"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              color: "var(--fg)",
              opacity: 0.6,
              fontSize: "var(--text-xl)",
              lineHeight: 1,
              transition: "opacity var(--ease-fast)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}
          >
            ×
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 1rem" }}>
        <div
          className="markdown-preview"
          style={{
            maxWidth: "70ch",
            margin: "0 auto",
            fontFamily: "var(--font-editor)",
            fontSize: "var(--text-lg)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {title && hasChanges && (
            <h1 style={{ marginTop: 0, fontSize: "var(--text-3xl)" }}>
              {title}
            </h1>
          )}
          {!content && (
            <p style={{ opacity: 0.4, fontStyle: "italic", fontSize: "var(--text-md)" }}>
              Content unavailable — this version predates rich history storage.
            </p>
          )}
          {!hasChanges && content && (
            <p style={{ opacity: 0.4, fontStyle: "italic", fontSize: "var(--text-md)" }}>
              No changes compared to previous snapshot.
            </p>
          )}
          {hasChanges && parts.map((p, i) => {
            if (p.removed) {
              return (
                <span
                  key={i}
                  style={{
                    background: "color-mix(in srgb, var(--color-success) 18%, transparent)",
                    borderRadius: "var(--radius-sm)",
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
                    background: "color-mix(in srgb, var(--color-danger) 18%, transparent)",
                    textDecoration: "line-through",
                    borderRadius: "var(--radius-sm)",
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

function SelectionBubble({ onLink, onCommentAdded }: { onLink: () => void; onCommentAdded?: (id: string, pos: { x: number; y: number }) => void }) {
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
          if (id && onCommentAdded) {
            onCommentAdded(id, { x: selectionBubble.left, y: selectionBubble.top });
          }
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
          fontSize: "var(--text-sm)",
          padding: "0.15rem 0.3rem",
          borderRadius: "var(--radius-xs)",
          flexShrink: 0,
          transition: "background var(--ease-fast), color var(--ease-fast)",
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
            fontSize: "var(--text-md)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            background: "none",
            border: "none",
            color: "var(--fg)",
            outline: "none",
            padding: "0.1rem 0.25rem",
            borderRadius: "var(--radius-xs)",
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
            fontSize: "var(--text-md)",
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


function DocNavActions() {
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
  const download = async (kind: "md" | "pdf" | "docx") => {
    const slug = (title || "document").replace(/[^a-zA-Z0-9_\-. ]/g, "_");
    if (USE_PM && kind === "docx") {
      editorApi.current?.exportDocx?.(`${slug}.docx`);
      return;
    }
    if (USE_PM && (kind === "md" || kind === "pdf")) {
      const md = editorApi.current?.getMarkdown?.() ?? "";
      if (kind === "md") {
        const blob = new Blob([md], { type: "text/markdown; charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement("a");
        a.href = url; a.download = `${slug}.md`; a.click();
        URL.revokeObjectURL(url);
        return;
      }
      // PDF: POST markdown to server, receive PDF blob
      try {
        const resp = await fetch(`/api/doc-pdf/${document.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: md }),
        });
        if (!resp.ok) throw new Error("PDF failed");
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement("a");
        a.href = url; a.download = `${slug}.pdf`; a.click();
        URL.revokeObjectURL(url);
      } catch {
        window.open(`/api/doc-pdf/${document.id}`, "_blank");
      }
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
        transition: "background var(--ease-fast), color var(--ease-fast)",
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
        borderRadius: "var(--radius-pill)",
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
