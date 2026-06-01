import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { BreadcrumbSegment } from "~/lib/folder.server";
import type { Peer } from "~/components/Editor";
import type { ConnectionStatus } from "~/components/DocActionBar";
import type { PanelId } from "~/components/ActivityBar";
import type { ResolvedThread } from "~/components/comment-decorations";
import { detectLanguage } from "~/components/DocActionBar";
import { getDocumentType } from "~/lib/templates";
import { useDocTypeExtension } from "~/extensions/hooks";
import { marked } from "marked";
import { useToast } from "~/components/Toast";

// ─── Types ────────────────────────────────────────────────────

export interface DocumentProps {
  document: {
    id: string;
    title: string;
    content: string;
    pdf_file?: string;
    public_token: string | null;
    edit_token: string | null;
    created_at?: string;
    updated_at?: string;
    share_expires_at?: number | null;
    share_password_hash?: string | null;
  };
  workspace: { id: string; type: string };
  user: { id: string; name: string; is_admin?: boolean | number };
  role?: "owner" | "admin" | "editor" | "viewer";
  canEdit: boolean;
  folderPath: BreadcrumbSegment[];
  wsUrl: string;
  starred: boolean;
  creatorName?: string | null;
  modifierName?: string | null;
  isShared?: boolean;
  baseUrl?: string;
  sessionUser?: { name: string; is_admin: boolean };
  sidebar?: React.ReactNode;
}

export interface HistoryPreviewState {
  content: string;
  title: string;
  label: string; // e.g. "3 min ago · auto-save" — shown in the banner
  currentContent: string; // live content, used to compute the diff view
}

export interface EditorApi {
  getContent: () => string;
  getSelectedText: () => string;
  format: (before: string, after: string) => void;
  formatLine: (prefix: string) => void;
  addComment: (body?: string) => string | undefined;
  addReply: (threadId: string, body: string) => void;
  updateComment: (commentId: string, body: string) => void;
  deleteComment: (commentId: string) => void;
  resolveThread: (threadId: string) => void;
  unresolveThread: (threadId: string) => void;
  scrollToPos: (pos: number) => void;
  focus: () => void;
  uploadImage: (file: File) => void;
  insertAt: (pos: number, text: string) => void;
  replaceContent: (newContent: string, cursorPos?: number) => void;
  // ProseMirror-only (optional — undefined in CodeMirror editor)
  exportDocx?: (filename?: string) => Promise<void>;
  setHeading?: (level: number) => void;
  clearFormatting?: () => void;
  toggleBlockquote?: () => void;
  toggleBulletList?: () => void;
  toggleOrderedList?: () => void;
  insertTable?: () => void;
  insertHr?: () => void;
}

export interface DocumentContextValue {
  // Props passed through
  document: DocumentProps["document"];
  workspace: DocumentProps["workspace"];
  user: DocumentProps["user"];
  role?: DocumentProps["role"];
  canEdit: boolean;
  folderPath: BreadcrumbSegment[];
  wsUrl: string;
  creatorName?: string | null;
  modifierName?: string | null;
  isShared?: boolean;
  baseUrl?: string;
  sessionUser?: { name: string; is_admin: boolean };
  sidebar?: React.ReactNode;

  // Editor state
  title: string;
  setTitle: (title: string) => void;
  content: string;
  peers: Peer[];
  setPeers: (peers: Peer[]) => void;
  editorKey: number;
  editorReady: boolean;
  setEditorReady: (ready: boolean) => void;
  mounted: boolean;

  // Comments
  comments: ResolvedThread[];
  setComments: (threads: ResolvedThread[]) => void;
  activePanel: PanelId | null;
  setActivePanel: (panel: PanelId | null) => void;
  focusedCommentId: string | null;
  setFocusedCommentId: (id: string | null) => void;
  focusedSuggestionId: string | null;
  setFocusedSuggestionId: (id: string | null) => void;

  // History preview (scrubbing through versions)
  historyPreview: HistoryPreviewState | null;
  setHistoryPreview: (state: HistoryPreviewState | null) => void;

  // Selection
  selectionBubble: { top: number; left: number } | null;
  setSelectionBubble: (bubble: { top: number; left: number } | null) => void;

  // Connection
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // Computed
  /** Frontmatter `type:` value, or null for plain markdown. Used by the
   *  registry to dispatch to extension editors / exporters / row icons. */
  docType: string | null;
  /** True when an extension owns the editor surface for this docType (has
   *  its own `EditorView`). Used by core to hide the markdown toolbar/footer
   *  without naming any specific extension. */
  hasCustomEditor: boolean;
  spellLang: "en" | "es";
  docStats: { chars: number; words: number };
  saving: boolean;
  isStarred: boolean;

  // Editor API ref
  editorApi: React.MutableRefObject<EditorApi | null>;

  // Actions
  scheduleSave: (title: string, content: string) => void;
  setContent: (content: string) => void;
  insertFootnote: () => void;
  copyFormatted: () => void;
  togglePanel: (panel: PanelId) => void;
  toggleStar: () => void;
  handleContentChange: (val: string) => void;
  registerEditorApi: (api: EditorApi) => void;
  sendMention: (body: string) => void;
  restoreVersion: (versionId: string) => void;
  saveVersion: () => void;

  // Fetchers (for components that need direct access)
  historyFetcher: ReturnType<typeof useFetcher>;

  // Title tracking
  titleSetByUser: React.MutableRefObject<boolean>;
}

// ─── Context ──────────────────────────────────────────────────

const DocumentContext = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a DocumentProvider");
  }
  return ctx;
}

export function useOptionalDocument(): DocumentContextValue | null {
  return useContext(DocumentContext);
}

// ─── Helpers ──────────────────────────────────────────────────

function extractFirstH1(md: string): string | null {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function randomFnId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "fn-";
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function cleanupOrphanFootnotes(doc: string): string {
  const refs = new Set<string>();
  for (const m of doc.matchAll(/\[\^([\w-]+)\](?!:)/g)) refs.add(m[1]);

  const defs = new Set<string>();
  for (const m of doc.matchAll(/^\[\^([\w-]+)\]:/gm)) defs.add(m[1]);

  let result = doc;
  for (const ref of refs) {
    if (!defs.has(ref)) {
      result = result.replace(new RegExp(`\\[\\^${ref.replace(/-/g, "\\-")}\\](?!:)`, "g"), "");
    }
  }

  for (const def of defs) {
    if (!refs.has(def)) {
      const escaped = def.replace(/-/g, "\\-");
      result = result.replace(new RegExp(`^\\[\\^${escaped}\\]:[ \\t]*[^\\n]*\\n?`, "gm"), "");
    }
  }

  const hasRemainingDefs = /^\[\^[\w-]+\]:/m.test(result);
  if (!hasRemainingDefs) {
    result = result.replace(/\n\n---\n\s*$/, "\n");
  }

  return result;
}

export function userColor(id: string): string {
  const palette = [
    "#AF3029", "#4a9ee8", "#2cb67d", "#f59e0b", "#8b5cf6", "#e84ab5",
    "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#dc2626",
  ];
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

// ─── Provider ─────────────────────────────────────────────────

export function DocumentProvider({ children, ...props }: DocumentProps & { children: React.ReactNode }) {
  const {
    document,
    workspace,
    user,
    role,
    canEdit,
    folderPath,
    wsUrl,
    starred,
    creatorName,
    modifierName,
    isShared,
    baseUrl,
    sessionUser,
    sidebar,
  } = props;

  const saveFetcher = useFetcher();
  const mentionFetcher = useFetcher();
  const historyFetcher = useFetcher();
  const { toast } = useToast();

  // ─── State ────────────────────────────────────────────────
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [editorReady, setEditorReady] = useState(false);
  const [comments, setComments] = useState<ResolvedThread[]>([]);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [focusedSuggestionId, setFocusedSuggestionId] = useState<string | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewState | null>(null);
  const [selectionBubble, setSelectionBubble] = useState<{ top: number; left: number } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ─── Computed ─────────────────────────────────────────────
  const docType = useMemo(() => getDocumentType(content), [content]);
  // Gate on enabled set so a disabled extension stops claiming the
  // editor surface — the doc falls back to the plain markdown editor.
  const docTypeExtension = useDocTypeExtension(docType);
  const hasCustomEditor = docTypeExtension?.EditorView != null;
  const spellLang = useMemo(() => detectLanguage(content), [content]);
  const docStats = useMemo(() => {
    const chars = content.length;
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    return { chars, words };
  }, [content]);

  // ─── Refs ─────────────────────────────────────────────────
  const editorApi = useRef<EditorApi | null>(null);
  const titleSetByUser = useRef(false);
  const titleAutoAdopted = useRef(false);
  const originalTitle = useRef(document.title);
  const isSaving = useRef(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContent = useRef(document.content);
  const lastSavedTitle = useRef(document.title);
  const fnCleanupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningFn = useRef(false);

  // ─── Star (optimistic) ────────────────────────────────────
  const [localStarred, setLocalStarred] = useState(starred);
  const isStarred = localStarred;

  const toggleStar = useCallback(() => {
    setLocalStarred((prev) => !prev);
    const body = new FormData();
    body.set("intent", "toggle-star");
    fetch(window.location.pathname, { method: "POST", body });
  }, []);

  // ─── Save ─────────────────────────────────────────────────
  const saving = saveFetcher.state !== "idle";

  const save = useCallback(
    (t: string, c: string) => {
      if (!canEdit) return;
      isSaving.current = true;
      lastSavedContent.current = c;
      saveFetcher.submit({ intent: "save", title: t, content: c }, { method: "post" });
    },
    [canEdit, saveFetcher]
  );

  useEffect(() => {
    if (saveFetcher.state === "idle") isSaving.current = false;
  }, [saveFetcher.state]);

  const scheduleSave = useCallback(
    (t: string, c: string) => {
      if (c === lastSavedContent.current && t === lastSavedTitle.current) return;
      isSaving.current = true;
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        lastSavedTitle.current = t;
        save(t, c);
      }, 600);
    },
    [save]
  );

  useEffect(() => () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); }, []);

  // ─── Auto-show/hide comments panel ────────────────────────
  useEffect(() => {
    const hasItems = comments.some((c) => !c.resolved);
    if (hasItems && activePanel !== "comments") setActivePanel("comments");
    if (!hasItems && activePanel === "comments") {
      setActivePanel(null);
      setFocusedCommentId(null);
      setFocusedSuggestionId(null);
    }
  }, [comments.length]);

  // ─── Restore: update state + remount Editor + undo toast ─
  // We only want to react to each restore once, so we track the backup id
  // we've already shown a toast for.
  const toastedBackupId = useRef<string | null>(null);
  useEffect(() => {
    const d = historyFetcher.data as Record<string, unknown> | undefined;
    if (!d?.restored) return;
    setTitle(d.title as string);
    setContent(d.content as string);
    setEditorKey((k) => k + 1);
    setEditorReady(false);
    setActivePanel(null);

    const backupVersionId = d.backupVersionId as string | undefined;
    if (backupVersionId && toastedBackupId.current !== backupVersionId) {
      toastedBackupId.current = backupVersionId;
      toast("Version restored", {
        type: "success",
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            historyFetcher.submit(
              { intent: "restore-version", versionId: backupVersionId },
              { method: "post" },
            );
          },
        },
      });
    }
  }, [historyFetcher.data, historyFetcher, toast]);

  // ─── Footnote orphan cleanup ──────────────────────────────
  useEffect(() => {
    if (!canEdit || isCleaningFn.current) return;
    if (!/\[\^[\w-]+\]/.test(content)) return;
    if (fnCleanupTimeout.current) clearTimeout(fnCleanupTimeout.current);
    fnCleanupTimeout.current = setTimeout(() => {
      const cleaned = cleanupOrphanFootnotes(content);
      if (cleaned !== content && editorApi.current) {
        isCleaningFn.current = true;
        editorApi.current.replaceContent(cleaned);
        isCleaningFn.current = false;
      }
    }, 800);
    return () => { if (fnCleanupTimeout.current) clearTimeout(fnCleanupTimeout.current); };
  }, [content, canEdit]);

  // ─── Content change handler (with auto-title) ─────────────
  const handleContentChange = useCallback(
    (val: string) => {
      setContent(val);
      // Auto-adopt the body's first H1 as the document title, but only for
      // freshly-created docs the user is actively editing. Guards:
      //   · recency — only kicks in within 1 hour of creation, so opening an
      //     old doc that still happens to carry a placeholder title doesn't
      //     trigger surprise renames.
      //   · placeholder — starts only while the title is a system default
      //     (empty / "Untitled" / the `xxx-xxx-xxx` slug from randomDocName()).
      //   · sticky — once we've adopted once (`titleAutoAdopted`), we keep
      //     syncing keystroke-by-keystroke until the user manually edits the
      //     title (which flips `titleSetByUser` and locks it in).
      //
      // `handleContentChange` is only wired to the Editor's onChange, so this
      // never fires outside an active edit session.
      const createdRaw = document.created_at ? Number(document.created_at) : 0;
      const createdMs =
        createdRaw && createdRaw < 1e12 ? createdRaw * 1000 : createdRaw;
      const isRecentDoc =
        createdMs > 0 && Date.now() - createdMs < 60 * 60 * 1000;
      const isPlaceholderTitle =
        title === "" ||
        title === "Untitled" ||
        /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/.test(title);
      const canAutoAdopt =
        !titleSetByUser.current &&
        isRecentDoc &&
        (titleAutoAdopted.current || isPlaceholderTitle);
      if (canAutoAdopt) {
        const h1 = extractFirstH1(val);
        if (h1) {
          titleAutoAdopted.current = true;
          setTitle(h1);
          originalTitle.current = h1;
          scheduleSave(h1, val);
          return;
        }
      }
      scheduleSave(title, val);
    },
    [document.created_at, title, scheduleSave]
  );

  // ─── Insert footnote ─────────────────────────────────────
  const insertFootnote = useCallback(() => {
    const api = editorApi.current;
    if (!api) return;
    const doc = api.getContent();
    const id = randomFnId();
    const ref = `[^${id}]`;

    api.format(ref, "");

    const updated = api.getContent();
    const hasExistingDefs = /^\[\^[\w-]+\]:/m.test(doc);
    let suffix = "";
    if (!hasExistingDefs) {
      suffix += "\n\n---\n";
    } else {
      suffix += "\n";
    }
    suffix += `${ref}: `;
    api.insertAt(updated.length, suffix);
  }, []);

  // ─── Copy with formatting ────────────────────────────────
  const copyFormatted = useCallback(() => {
    const selected = editorApi.current?.getSelectedText() ?? "";
    const md = selected || editorApi.current?.getContent() || "";
    if (!md.trim()) {
      toast("Nothing to copy", "info");
      return;
    }
    const html = String(marked.parse(md));
    const tmp = window.document.createElement("div");
    tmp.setAttribute("contenteditable", "true");
    tmp.innerHTML = html;
    Object.assign(tmp.style, { position: "fixed", left: "-9999px", top: "0", opacity: "0" });
    window.document.body.appendChild(tmp);
    const range = window.document.createRange();
    range.selectNodeContents(tmp);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    try {
      window.document.execCommand("copy");
      toast(selected ? "Copied! Paste anywhere with formatting." : "Entire document copied! Paste anywhere with formatting.", "success");
    } catch {
      toast("Copy failed", "error");
    }
    sel?.removeAllRanges();
    window.document.body.removeChild(tmp);
  }, [toast]);

  // ─── Panel toggle ─────────────────────────────────────────
  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel((cur) => (cur === panel ? null : panel));
    if (panel !== "comments") {
      setFocusedCommentId(null);
      setFocusedSuggestionId(null);
    }
    if (panel !== "history") {
      setHistoryPreview(null);
    }
  }, []);

  // ─── Register editor API ──────────────────────────────────
  const registerEditorApi = useCallback((api: EditorApi) => {
    editorApi.current = api;
    setEditorReady(true);
  }, []);

  // ─── Mention sender ───────────────────────────────────────
  const sendMention = useCallback(
    (body: string) => {
      mentionFetcher.submit({ intent: "send-mentions", body }, { method: "post" });
    },
    [mentionFetcher]
  );

  // ─── History actions ──────────────────────────────────────
  const restoreVersion = useCallback(
    (versionId: string) => {
      historyFetcher.submit({ intent: "restore-version", versionId }, { method: "post" });
    },
    [historyFetcher]
  );

  const saveVersion = useCallback(() => {
    historyFetcher.submit({ intent: "save-version" }, { method: "post" });
  }, [historyFetcher]);

  // ─── Context value ────────────────────────────────────────
  const value: DocumentContextValue = {
    document,
    workspace,
    user,
    role,
    canEdit,
    folderPath,
    wsUrl,
    creatorName,
    modifierName,
    isShared,
    baseUrl,
    sessionUser,
    sidebar,

    title,
    setTitle,
    content,
    setContent,
    peers,
    setPeers,
    editorKey,
    editorReady,
    setEditorReady,
    mounted,

    comments,
    setComments,
    activePanel,
    setActivePanel,
    focusedCommentId,
    setFocusedCommentId,
    focusedSuggestionId,
    setFocusedSuggestionId,

    historyPreview,
    setHistoryPreview,

    selectionBubble,
    setSelectionBubble,

    connectionStatus,
    setConnectionStatus,

    docType,
    hasCustomEditor,
    spellLang,
    docStats,
    saving,
    isStarred,

    editorApi,

    scheduleSave,
    insertFootnote,
    copyFormatted,
    togglePanel,
    toggleStar,
    handleContentChange,
    registerEditorApi,
    sendMention,
    restoreVersion,
    saveVersion,

    historyFetcher,

    titleSetByUser,
  };

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  );
}
