import { useEffect, useRef } from "react";
import type { EditorView as EditorViewType } from "@codemirror/view";
import type { ResolvedThread } from "./comment-decorations";
import {
  createImageDecorations,
  createListMarkerDecorations,
  createLinkDecorations,
  createTableDecorations,
  createHorizontalRuleDecorations,
  createHeadingSpacingDecorations,
  createHighlightDecorations,
  createMarkupHidingDecorations,
  createBlockquoteDecorations,
  createFootnoteDecorations,
  createFrontmatterDecorations,
} from "./editor-decorations";

// ─── Types ────────────────────────────────────────────────

interface UserInfo {
  name: string;
  color: string;
}

export interface Peer {
  name: string;
  color: string;
}

interface EditorProps {
  initialValue: string;
  /** When this prop changes (external update e.g. polling), sync to editor */
  syncedContent?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Enables Yjs real-time collaboration */
  docId?: string;
  /** WS server base URL, e.g. "ws://mini-m4:4001" */
  wsUrl?: string;
  /** Extra query params for the WS connection (e.g. { token: "..." }) */
  wsParams?: Record<string, string>;
  /** Awareness identity for this user */
  userInfo?: UserInfo;
  /** Auto-focus the editor after mount */
  autoFocus?: boolean;
  /** Current user ID for comment ownership */
  currentUserId?: string;
  /** Called when threaded comments change */
  onThreadsChange?: (threads: ResolvedThread[]) => void;
  /** Called when user clicks a comment highlight in the editor */
  onThreadClick?: (thread: ResolvedThread) => void;
  /** Called once the editor is mounted */
  onReady?: (api: {
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
  }) => void;
  /** Called when the text selection changes (for floating comment button) */
  onSelectionChange?: (sel: { from: number; to: number; top: number; left: number } | null) => void;
  /** Called when remote peers join/leave/update */
  onPresenceChange?: (peers: Peer[]) => void;
  /** When true, user edits are auto-wrapped in CriticMarkup */
  suggestionMode?: boolean;
  /** Author name for suggestion markup (defaults to userInfo.name or "Guest") */
  userName?: string;
  /** Spellcheck language: "en" or "es" */
  spellLang?: "en" | "es";
  /** Called when WebSocket connection status changes */
  onConnectionStatus?: (status: "connected" | "connecting" | "disconnected") => void;
  /**
   * Called when the user picks "Edit" from the link action menu.
   * Receives the current URL and an `apply` callback that, when invoked
   * with a new URL, rewrites the link in place. If omitted, "Edit" falls
   * back to moving the caret into the markdown syntax.
   */
  onEditLink?: (currentUrl: string, apply: (newUrl: string) => void) => void;
}

// ─── Eager module-scope imports (start downloading on route load) ─────

const cmDepsPromise =
  typeof window !== "undefined"
    ? Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@lezer/highlight"),
        import("./comment-decorations"),
        import("nanoid"),
        import("turndown"),
      ])
    : null;

const yjsDepsPromise =
  typeof window !== "undefined"
    ? Promise.all([
        import("yjs"),
        import("y-websocket"),
        import("y-codemirror.next"),
      ])
    : null;

// ─── Component ────────────────────────────────────────────

export function Editor({
  initialValue,
  syncedContent,
  onChange,
  readOnly = false,
  docId,
  wsUrl,
  wsParams,
  userInfo,
  autoFocus = false,
  currentUserId,
  onThreadsChange,
  onThreadClick,
  onSelectionChange,
  onReady,
  onPresenceChange,
  userName,
  spellLang = "en",
  onConnectionStatus,
  onEditLink,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorViewType | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onThreadsRef = useRef(onThreadsChange);
  onThreadsRef.current = onThreadsChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onThreadClickRef = useRef(onThreadClick);
  onThreadClickRef.current = onThreadClick;
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const onPresenceRef = useRef(onPresenceChange);
  onPresenceRef.current = onPresenceChange;
  const onEditLinkRef = useRef(onEditLink);
  onEditLinkRef.current = onEditLink;
  const userInfoRef = useRef(userInfo);
  userInfoRef.current = userInfo;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const spellLangRef = useRef(spellLang);
  spellLangRef.current = spellLang;
  const onConnectionStatusRef = useRef(onConnectionStatus);
  onConnectionStatusRef.current = onConnectionStatus;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    async function init() {
      // ── Load all CodeMirror modules (already downloading from module scope) ──
      const [
        { EditorView, keymap, ViewPlugin, Decoration, WidgetType, drawSelection },
        { EditorState, EditorSelection, Annotation },
        { markdown, markdownLanguage },
        { defaultKeymap, history, historyKeymap, indentWithTab },
        { syntaxHighlighting, HighlightStyle, syntaxTree },
        { tags },
        { commentDecoExtension, dispatchThreads },
        { nanoid },
      ] = await cmDepsPromise!;

      // Annotation to mark our own rewritten transactions so the filter skips them
      const suggestionAnnotation = Annotation.define<boolean>();

      // ── Image preview decorations ─────────────────────────
      const imageDecorations = createImageDecorations({ EditorView, Decoration, WidgetType });

      // ── List marker decorations (bullet replacement + hanging indent) ──
      const listMarkerDecorations = createListMarkerDecorations({
        EditorView,
        Decoration,
        syntaxTree,
      });

      // ── Markdown link decorations [text](url) ──────────────────
      const linkDecorations = createLinkDecorations({ EditorView, Decoration });

      // ── GFM table decorations ──────────────────────────────
      const tableDecorations = createTableDecorations({
        EditorView,
        Decoration,
        WidgetType,
        syntaxTree,
      });

      // ── Horizontal rule decoration ────────────────────────
      const hrDecorations = createHorizontalRuleDecorations({
        EditorView,
        Decoration,
        WidgetType,
        syntaxTree,
      });

      // ── Heading spacing (margin-bottom on H2–H4 lines) ──
      const headingSpacingDecorations = createHeadingSpacingDecorations({
        EditorView,
        Decoration,
        syntaxTree,
      });

      // ── ==highlight== decorations (not CriticMarkup {==...==}) ──
      const highlightDecorations = createHighlightDecorations({
        EditorView,
        Decoration,
      });

      // ── Blockquote line decorations (left border + bg) ──
      const blockquoteDecorations = createBlockquoteDecorations({
        EditorView,
        Decoration,
        syntaxTree,
      });

      // ── Footnote reference decorations [^1] → superscript ──
      const footnoteDecorations = createFootnoteDecorations({ EditorView, Decoration, WidgetType });

      // ── YAML frontmatter (metadata block) line decorations ──
      const frontmatterDecorations = createFrontmatterDecorations({ EditorView, Decoration });

      // ── Hide bold/italic/heading markup when cursor is elsewhere ──
      const markupHidingDecorations = createMarkupHidingDecorations({
        EditorView,
        Decoration,
        syntaxTree,
      });

      if (destroyed || !containerRef.current) return;

      // ── Highlight style ──────────────────────────────────
      // Only use tags that actually exist in @lezer/highlight v1
      const tagSpecs = [
        { tag: tags.heading1, fontWeight: "700", fontSize: "1.2em" },
        { tag: tags.heading2, fontWeight: "700", fontSize: "1.1em" },
        { tag: tags.heading3, fontWeight: "700" },
        { tag: tags.heading4, fontWeight: "700", fontSize: "0.95em" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.monospace, background: "color-mix(in srgb, var(--fg) 6%, transparent)", borderRadius: "3px", padding: "1px 3px", fontSize: "0.92em" },
        // tags.url intentionally omitted — links are styled via mark decorations
        // in editor-decorations.ts; including tags.url here causes false positives
        // on footnote definitions (Lezer parses `[^fn]: word` as a link ref)
        { tag: tags.link, fontWeight: "500" },
        { tag: tags.processingInstruction, color: "color-mix(in srgb, var(--fg) 40%, transparent)" },
        { tag: tags.punctuation, color: "color-mix(in srgb, var(--fg) 40%, transparent)" },
        { tag: tags.meta, color: "color-mix(in srgb, var(--fg) 40%, transparent)" },
        { tag: tags.quote, color: "color-mix(in srgb, var(--fg) 70%, transparent)" },

        { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.5" },
      ].filter((s) => s.tag != null); // guard against future API changes

      const loicaHighlight = HighlightStyle.define(tagSpecs);

      // ── Theme ────────────────────────────────────────────
      const loicaTheme = EditorView.theme({
        "&": {
          fontFamily: "var(--font-editor)",
          fontSize: "1.0625rem",
          background: "var(--bg)",
          color: "var(--fg)",
          height: "100%",
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--font-editor)",
          fontSize: "1.0625rem",
          lineHeight: "1.6",
        },
        ".cm-content": {
          maxWidth: "65ch",
          margin: "0 auto",
          padding: "2rem 2rem",
          caretColor: "transparent",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          letterSpacing: "0.01em",
          wordSpacing: "0.05em",
        },
        ".cm-cursor": {
          borderLeftColor: "var(--color-scarlet)",
          borderLeftWidth: "3px",
        },
        ".cm-selectionBackground": {
          background: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
        },
        "::selection": {
          background: "color-mix(in srgb, var(--accent) 25%, transparent)",
        },
        ".cm-activeLine": {
          background: "color-mix(in srgb, var(--fg) 3%, transparent)",
        },
        ".cm-gutters": { display: "none" },
        ".cm-line": { padding: "0" },
        ".cm-ySelection": {
          background: "color-mix(in srgb, var(--accent) 20%, transparent)",
        },
        ".cm-ySelectionInfo": { display: "none" },
        ".cm-highlight": {
          background: "color-mix(in srgb, var(--color-highlight) 25%, transparent)",
          borderRadius: "2px",
          padding: "1px 0",
        },
        ".cm-highlight-marker": {
          opacity: "0.3",
        },
        ".cm-link-text": {
          cursor: "pointer",
        },
        ".cm-list-marker, .cm-list-marker span": {
          color: "#E8392A !important",
        },
        ".cm-list-bullet": {
          fontSize: "0",
        },
        ".cm-list-bullet::after": {
          content: "'–'",
          fontSize: "var(--editor-font-size, 1rem)",
          color: "#E8392A",
        },
        ".cm-critic-highlight": {
          background: "color-mix(in srgb, var(--color-highlight) 18%, transparent)",
          borderRadius: "2px",
          cursor: "pointer",
        },
        ".cm-comment-indicator": {
          cursor: "pointer",
          fontSize: "0.75em",
          opacity: "0.5",
          padding: "0 1px",
        },
        ".cm-critic-addition": {
          background: "color-mix(in srgb, var(--color-success) 18%, transparent)",
          borderRadius: "2px",
        },
        ".cm-critic-deletion": {
          background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
          textDecoration: "line-through",
          opacity: "0.7",
          borderRadius: "2px",
        },
        ".cm-critic-sub-old": {
          background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
          textDecoration: "line-through",
          opacity: "0.7",
        },
        ".cm-critic-sub-new": {
          background: "color-mix(in srgb, var(--color-success) 18%, transparent)",
        },
        ".cm-thread-highlight": {
          borderRadius: "2px",
          cursor: "pointer",
        },
      });

      // ── Highlight remove floating button ──────────────────
      let activeHighlightBtn: HTMLElement | null = null;
      function dismissHighlightBtn() {
        if (activeHighlightBtn) {
          activeHighlightBtn.remove();
          activeHighlightBtn = null;
        }
        document.removeEventListener("mousedown", onDismissHighlightBtn, true);
      }
      function onDismissHighlightBtn(e: MouseEvent) {
        if (activeHighlightBtn && !activeHighlightBtn.contains(e.target as Node)) {
          dismissHighlightBtn();
        }
      }
      function showHighlightRemoveBtn(view: typeof EditorView.prototype, fullFrom: number, fullTo: number, x: number, y: number) {
        dismissHighlightBtn();
        const btn = document.createElement("button");
        btn.textContent = "Remove highlight";
        btn.className = "cm-highlight-remove-btn";
        Object.assign(btn.style, {
          position: "fixed",
          top: `${y - 36}px`,
          left: `${x}px`,
          zIndex: "60",
          fontSize: "0.7rem",
          padding: "0.3rem 0.6rem",
          border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          color: "var(--fg)",
          cursor: "pointer",
          boxShadow: "var(--shadow-sm)",
          whiteSpace: "nowrap",
          opacity: "0.85",
        });
        btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
        btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.85"; });
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const doc = view.state.doc.toString();
          const content = doc.slice(fullFrom + 3, fullTo - 3);
          view.dispatch({ changes: { from: fullFrom, to: fullTo, insert: content }, userEvent: "input" });
          dismissHighlightBtn();
        });
        document.body.appendChild(btn);
        activeHighlightBtn = btn;
        // Dismiss on any other click
        requestAnimationFrame(() => {
          document.addEventListener("mousedown", onDismissHighlightBtn, true);
        });
      }

      // ── Link action floating menu ──────────────────────────
      let activeLinkMenu: HTMLElement | null = null;
      function dismissLinkMenu() {
        if (activeLinkMenu) {
          activeLinkMenu.remove();
          activeLinkMenu = null;
        }
        document.removeEventListener("mousedown", onDismissLinkMenu, true);
        document.removeEventListener("keydown", onDismissLinkMenuKey, true);
      }
      function onDismissLinkMenu(e: MouseEvent) {
        if (activeLinkMenu && !activeLinkMenu.contains(e.target as Node)) {
          dismissLinkMenu();
        }
      }
      function onDismissLinkMenuKey(e: KeyboardEvent) {
        if (e.key === "Escape") dismissLinkMenu();
      }
      function showLinkActionMenu(
        view: typeof EditorView.prototype,
        url: string,
        cursorPos: number,
        x: number,
        y: number,
        linkRange: { from: number; to: number; kind: "markdown" | "bare" },
      ) {
        dismissLinkMenu();
        const menu = document.createElement("div");
        menu.className = "fixed z-[60] flex items-center gap-0.5 rounded-md border border-fg/20 bg-fg p-0.5 shadow-sm";

        // Clamp to viewport so the menu doesn't overflow off-screen.
        // 180px accounts for the widest case: Open · Edit · Remove.
        const menuW = 180;
        const clampedX = Math.min(x, window.innerWidth - menuW - 8);
        const clampedY = Math.max(8, y - 38);
        menu.style.top = `${clampedY}px`;
        menu.style.left = `${clampedX}px`;

        const mkBtn = (label: string, onClick: () => void, extraClass = "") => {
          const b = document.createElement("button");
          b.textContent = label;
          b.className = `cursor-pointer rounded px-2 py-1 text-xs text-bg/80 transition-colors hover:bg-bg/15 hover:text-bg ${extraClass}`;
          b.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onClick();
            dismissLinkMenu();
          });
          return b;
        };

        menu.appendChild(
          mkBtn("Open", () => {
            window.open(url, "_blank", "noopener");
          })
        );
        menu.appendChild(
          mkBtn("Edit", () => {
            const apply = (newUrl: string) => {
              const slice = view.state.doc.sliceString(linkRange.from, linkRange.to);
              let replacement: string;
              if (linkRange.kind === "markdown") {
                const m = slice.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
                replacement = m ? `[${m[1]}](${newUrl})` : slice;
              } else {
                // Bare URL: replace the whole match with the new URL.
                replacement = newUrl;
              }
              view.dispatch({
                changes: { from: linkRange.from, to: linkRange.to, insert: replacement },
                selection: { anchor: linkRange.from + replacement.length },
                userEvent: "input",
              });
              view.focus();
            };
            if (onEditLinkRef.current) {
              onEditLinkRef.current(url, apply);
            } else {
              // No external editor wired — fall back to raw markdown editing.
              view.dispatch({ selection: { anchor: cursorPos } });
              view.focus();
            }
          })
        );
        // "Remove" keeps the visible label text and strips the `[...](url)` syntax.
        // Skipped for bare URLs — there's no separate label to preserve, so removal
        // would be a plain delete. Users can just select the URL and delete manually.
        if (linkRange.kind === "markdown") {
          menu.appendChild(
            mkBtn(
              "Remove",
              () => {
                const slice = view.state.doc.sliceString(linkRange.from, linkRange.to);
                const m = slice.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
                if (!m) return;
                const label = m[1];
                view.dispatch({
                  changes: { from: linkRange.from, to: linkRange.to, insert: label },
                  selection: { anchor: linkRange.from + label.length },
                  userEvent: "input",
                });
                view.focus();
              },
              "text-[color:var(--color-scarlet)]/80 hover:text-[color:var(--color-scarlet)]",
            )
          );
        }

        document.body.appendChild(menu);
        activeLinkMenu = menu;
        requestAnimationFrame(() => {
          document.addEventListener("mousedown", onDismissLinkMenu, true);
          document.addEventListener("keydown", onDismissLinkMenuKey, true);
        });
      }

      // ── Markdown formatting helper ───────────────────────
      function wrapWith(before: string, after: string) {
        return (view: typeof EditorView.prototype): boolean => {
          const changes = view.state.changeByRange((range) => {
            if (range.empty) {
              return {
                changes: { from: range.from, insert: before + after },
                range: EditorSelection.cursor(range.from + before.length),
              };
            }
            // Check if selection is already wrapped — if so, unwrap (toggle)
            const doc = view.state.doc;
            const beforeStart = range.from - before.length;
            const afterEnd = range.to + after.length;
            // Case 1: markers are outside the selection (normal text selected)
            if (
              after.length > 0 &&
              beforeStart >= 0 &&
              afterEnd <= doc.length &&
              doc.sliceString(beforeStart, range.from) === before &&
              doc.sliceString(range.to, afterEnd) === after
            ) {
              return {
                changes: [
                  { from: beforeStart, to: range.from, insert: "" },
                  { from: range.to, to: afterEnd, insert: "" },
                ],
                range: EditorSelection.range(
                  beforeStart,
                  range.to - before.length
                ),
              };
            }
            // Case 2: markers are inside the selection (e.g. hidden by decorations,
            // so selecting the visible text grabs the markers too)
            const sel = doc.sliceString(range.from, range.to);
            if (
              after.length > 0 &&
              sel.startsWith(before) &&
              sel.endsWith(after) &&
              sel.length > before.length + after.length
            ) {
              return {
                changes: [
                  { from: range.from, to: range.from + before.length, insert: "" },
                  { from: range.to - after.length, to: range.to, insert: "" },
                ],
                range: EditorSelection.range(
                  range.from,
                  range.to - before.length - after.length
                ),
              };
            }
            return {
              changes: [
                { from: range.from, insert: before },
                { from: range.to, insert: after },
              ],
              range: EditorSelection.range(
                range.from + before.length,
                range.to + before.length
              ),
            };
          });
          view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
          return true;
        };
      }

      // addCommentCommand is a stub — the actual comment creation happens
      // via the Yjs comments map in the onReady API (addComment method).
      // This command just triggers the API through a ref.
      let addCommentHandler: (() => void) | null = null;
      function addCommentCommand(_view: typeof EditorView.prototype): boolean {
        addCommentHandler?.();
        return true;
      }

      function addAdditionCommand(view: typeof EditorView.prototype): boolean {
        const authorName = userInfoRef.current?.name || "Guest";
        const prefix = `@${authorName}:`;
        const changes = view.state.changeByRange((range) => {
          if (range.empty) {
            const insert = `{++${prefix}++}`;
            // Place cursor between prefix and ++}
            return {
              changes: { from: range.from, insert },
              range: EditorSelection.cursor(range.from + 3 + prefix.length),
            };
          }
          const sel = view.state.sliceDoc(range.from, range.to);
          const before = `{++${prefix}`;
          const after = `++}`;
          return {
            changes: [
              { from: range.from, insert: before },
              { from: range.to, insert: after },
            ],
            range: EditorSelection.cursor(range.to + before.length + after.length),
          };
        });
        view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input", annotations: suggestionAnnotation.of(true) }));
        return true;
      }

      function addDeletionCommand(view: typeof EditorView.prototype): boolean {
        const authorName = userInfoRef.current?.name || "Guest";
        const prefix = `@${authorName}:`;
        const sel = view.state.selection.main;
        if (sel.empty) return false; // deletion requires selection
        const changes = view.state.changeByRange((range) => {
          if (range.empty) return { changes: [], range };
          const before = `{--${prefix}`;
          const after = `--}`;
          return {
            changes: [
              { from: range.from, insert: before },
              { from: range.to, insert: after },
            ],
            range: EditorSelection.cursor(range.to + before.length + after.length),
          };
        });
        view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input", annotations: suggestionAnnotation.of(true) }));
        return true;
      }

      function addSubstitutionCommand(view: typeof EditorView.prototype): boolean {
        const authorName = userInfoRef.current?.name || "Guest";
        const prefix = `@${authorName}:`;
        const sel = view.state.selection.main;
        if (sel.empty) return false; // substitution requires selection
        const changes = view.state.changeByRange((range) => {
          if (range.empty) return { changes: [], range };
          const before = `{~~${prefix}`;
          const after = `~>~~}`;
          return {
            changes: [
              { from: range.from, insert: before },
              { from: range.to, insert: after },
            ],
            // Place cursor before ~~} so user can type the replacement
            range: EditorSelection.cursor(range.to + before.length + 2), // after ~>
          };
        });
        view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input", annotations: suggestionAnnotation.of(true) }));
        return true;
      }

      const formattingKeymap = keymap.of([
        { key: "Mod-b", run: wrapWith("**", "**") },
        { key: "Mod-i", run: wrapWith("*", "*") },
        { key: "Mod-`", run: wrapWith("`", "`") },
        { key: "Mod-k", run: wrapWith("[", "](https://)") },
        { key: "Mod-Shift-c", run: addCommentCommand },
        { key: "Mod-Shift-a", run: addAdditionCommand },
        { key: "Mod-Shift-d", run: addDeletionCommand },
        { key: "Mod-Shift-s", run: addSubstitutionCommand },
        { key: "Mod-Shift-h", run: wrapWith("{==", "==}") },
      ]);

      // ── Image resize helper ─────────────────────────────────
      const MAX_IMAGE_DIM = 1200;
      const IMAGE_QUALITY = 0.72;

      function resizeImage(file: File): Promise<File> {
        // Skip SVGs (vector) and GIFs (animated)
        if (file.type === "image/svg+xml" || file.type === "image/gif") {
          return Promise.resolve(file);
        }
        return new Promise((resolve) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(url);
            const { width, height } = img;
            const scale = Math.min(MAX_IMAGE_DIM / width, MAX_IMAGE_DIM / height, 1);
            const w = Math.round(width * scale);
            const h = Math.round(height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  resolve(new File([blob], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" }));
                } else {
                  resolve(file);
                }
              },
              "image/webp",
              IMAGE_QUALITY,
            );
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file);
          };
          img.src = url;
        });
      }

      // ── HTML-to-Markdown paste handler ────────────────────────────────
      async function handleHtmlPaste(
        html: string,
      ): Promise<string | null> {
        try {
          // Skip conversion if it looks like plain code (no meaningful HTML tags)
          const hasSemanticTags = /<(h[1-6]|p|ul|ol|li|blockquote|table|tr|th|td|strong|em|a|code|pre|img|br|hr)\b/i.test(html);
          if (!hasSemanticTags) {
            return null; // Let default paste handle it
          }

          const { default: TurndownService } = await import("turndown");
          const turndownService = new TurndownService({
            headingStyle: "atx",
            bulletListMarker: "-",
            codeBlockStyle: "fenced",
          });

          // Add plugin for strikethrough support.
          // Function filter avoids the strict HTMLElementTagNameMap type check
          // (legacy <strike> isn't in that map but still shows up in pasted HTML).
          turndownService.addRule("strikethrough", {
            filter: (node) => {
              const name = node.nodeName.toLowerCase();
              return name === "s" || name === "strike" || name === "del";
            },
            replacement: (content) => `~~${content}~~`,
          });

          // Add plugin for GFM tables
          turndownService.addRule("table", {
            filter: "table",
            replacement: (content) => {
              const rows = content.trim().split("\n");
              if (rows.length === 0) return content;

              let markdown = "";
              rows.forEach((row, idx) => {
                const cells = row.split("|").filter((cell) => cell.trim());
                if (cells.length > 0) {
                  markdown += "| " + cells.join(" | ") + " |\n";
                  if (idx === 0) {
                    markdown += "|" + cells.map(() => " --- |").join("");
                  }
                }
              });
              return "\n\n" + markdown + "\n\n";
            },
          });

          const markdown = turndownService.turndown(html);
          return markdown.trim();
        } catch (err) {
          console.error("[Editor] HTML paste conversion failed:", err);
          return null; // Fall back to default paste
        }
      }

      // ── Image upload helper ────────────────────────────────
      async function uploadImage(
        view: typeof EditorView.prototype,
        file: File,
      ) {
        const pos = view.state.selection.main.head;
        const placeholder = `![uploading…]()`;
        view.dispatch({
          changes: { from: pos, insert: placeholder },
          annotations: suggestionAnnotation.of(true),
        });

        try {
          const resized = await resizeImage(file);
          const formData = new FormData();
          formData.append("file", resized);
          const res = await fetch("/api/upload", { method: "POST", body: formData });
          if (!res.ok) throw new Error(await res.text());
          const { url } = await res.json();

          const currentDoc = view.state.doc.toString();
          const placeholderIdx = currentDoc.indexOf(placeholder);
          if (placeholderIdx >= 0) {
            const markdown = `![image](${url})`;
            view.dispatch({
              changes: { from: placeholderIdx, to: placeholderIdx + placeholder.length, insert: markdown },
              annotations: suggestionAnnotation.of(true),
            });
          }
        } catch (err) {
          console.error("[Editor] Image upload failed:", err);
          const currentDoc = view.state.doc.toString();
          const placeholderIdx = currentDoc.indexOf(placeholder);
          if (placeholderIdx >= 0) {
            view.dispatch({
              changes: { from: placeholderIdx, to: placeholderIdx + placeholder.length, insert: "" },
              annotations: suggestionAnnotation.of(true),
            });
          }
        }
      }

      const baseExtensions = [
        drawSelection({ cursorBlinkRate: 900 }),
        formattingKeymap,
        keymap.of([...defaultKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, extensions: { remove: ["SetextHeading"] } }),
        syntaxHighlighting(loicaHighlight),
        imageDecorations,
        linkDecorations,
        listMarkerDecorations,
        highlightDecorations,
        tableDecorations,
        hrDecorations,
        headingSpacingDecorations,
        blockquoteDecorations,
        markupHidingDecorations,
        footnoteDecorations,
        frontmatterDecorations,
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        // In readOnly mode, prevent clicks from placing cursor (keeps decorations rendered)
        ...(readOnly ? [EditorView.domEventHandlers({
          mousedown: () => true,
          touchstart: () => true,
        })] : []),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            // Detect click on highlighted text → show "Remove highlight" floating button
            const target = event.target as HTMLElement;
            if (!event.metaKey && !event.ctrlKey && target.closest(".cm-critic-highlight")) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos != null) {
                const doc = view.state.doc.toString();
                const STANDALONE_HL = /\{==([\s\S]*?)==\}/g;
                let m;
                while ((m = STANDALONE_HL.exec(doc)) !== null) {
                  const fullFrom = m.index;
                  const fullTo = m.index + m[0].length;
                  const hlFrom = fullFrom + 3;
                  const hlTo = fullTo - 3;
                  if (pos >= hlFrom && pos <= hlTo) {
                    // Show floating remove button
                    setTimeout(() => {
                      showHighlightRemoveBtn(view, fullFrom, fullTo, event.clientX, event.clientY);
                    }, 0);
                    break;
                  }
                }
              }
              // Don't prevent default — let the cursor land normally
            }

            // Resolve any link at click position
            const linkPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (linkPos == null) return false;
            const docStr = view.state.doc.toString();
            let hitUrl: string | null = null;
            let hitInnerPos = linkPos;
            let hitFrom = -1;
            let hitTo = -1;
            let hitKind: "markdown" | "bare" = "bare";
            // Check markdown links [text](url) first
            const ML = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
            let lm;
            while ((lm = ML.exec(docStr)) !== null) {
              if (linkPos >= lm.index && linkPos < lm.index + lm[0].length) {
                hitUrl = lm[2];
                hitInnerPos = lm.index + 1; // inside the [text] portion
                hitFrom = lm.index;
                hitTo = lm.index + lm[0].length;
                hitKind = "markdown";
                break;
              }
            }
            // Fall back to bare URLs
            if (!hitUrl) {
              const UL = /(?<!\(|]\()https?:\/\/[^\s<>)]+/g;
              while ((lm = UL.exec(docStr)) !== null) {
                if (linkPos >= lm.index && linkPos < lm.index + lm[0].length) {
                  hitUrl = lm[0];
                  hitInnerPos = linkPos;
                  hitFrom = lm.index;
                  hitTo = lm.index + lm[0].length;
                  hitKind = "bare";
                  break;
                }
              }
            }

            if (hitUrl) {
              // If the cursor is already inside this link range, the user is
              // actively editing it (raw markup is showing). Let the click land
              // normally so they can position the caret or select text.
              const currentCursor = view.state.selection.main.head;
              const alreadyEditing =
                !event.metaKey &&
                !event.ctrlKey &&
                currentCursor >= hitFrom &&
                currentCursor <= hitTo;
              if (alreadyEditing) return false;

              // Cmd/Ctrl-click → always open directly, in any mode
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                event.stopPropagation();
                window.open(hitUrl, "_blank", "noopener");
                return true;
              }
              // Read-only mode → plain click opens in new tab
              if (readOnlyRef.current) {
                event.preventDefault();
                event.stopPropagation();
                window.open(hitUrl, "_blank", "noopener");
                return true;
              }
              // Editable mode → show Open/Edit/Remove floating menu
              event.preventDefault();
              event.stopPropagation();
              const url = hitUrl;
              const innerPos = hitInnerPos;
              const range = { from: hitFrom, to: hitTo, kind: hitKind };
              setTimeout(() => {
                showLinkActionMenu(view, url, innerPos, event.clientX, event.clientY, range);
              }, 0);
              return true;
            }
            return false;
          },
          paste(event, view) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            // Check for images first (they take priority)
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) uploadImage(view, file);
                return true;
              }
            }

            // Check for HTML content and convert to Markdown
            for (const item of items) {
              if (item.type === "text/html") {
                event.preventDefault();
                // Capture selection range and plain text BEFORE async callback
                // (clipboardData is nullified after the event handler returns)
                const { from: selFrom, to: selTo } = view.state.selection.main;
                const plainFallback = event.clipboardData?.getData("text/plain") ?? null;
                item.getAsString(async (html) => {
                  const markdown = await handleHtmlPaste(html);
                  const text = markdown ?? plainFallback;
                  if (text) {
                    view.dispatch({
                      changes: { from: selFrom, to: selTo, insert: text },
                      annotations: suggestionAnnotation.of(true),
                    });
                  }
                });
                return true;
              }
            }

            return false;
          },
          drop(event, view) {
            const files = event.dataTransfer?.files;
            if (!files) return false;
            for (const file of files) {
              if (file.type.startsWith("image/")) {
                event.preventDefault();
                uploadImage(view, file);
                return true;
              }
            }
            return false;
          },
        }),
        loicaTheme,
        commentDecoExtension(
          (thread) => onThreadClickRef.current?.(thread),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
          // Emit selection changes for floating comment button
          if (onSelectionRef.current && (update.selectionSet || update.docChanged)) {
            const sel = update.state.selection.main;
            if (sel.empty) {
              onSelectionRef.current(null);
            } else {
              try {
                const coords = update.view.coordsAtPos(sel.to);
                if (coords) {
                  onSelectionRef.current({
                    from: sel.from,
                    to: sel.to,
                    top: coords.top,
                    left: coords.right,
                  });
                }
              } catch {
                onSelectionRef.current(null);
              }
            }
          }
        }),
      ];

      // ── Try Yjs collab ───────────────────────────────────
      let collabExtensions: unknown[] = [];
      let collabCleanup: (() => void) | null = null;
      let hasCollab = false;
      let collabY: any = null;
      let collabYdoc: any = null;
      let collabYtext: any = null;
      let collabYcomments: any = null;

      if (docId && wsUrl) {
        try {
          const [Y, { WebsocketProvider }, { yCollab, yUndoManagerKeymap }] = await yjsDepsPromise!;

          if (!destroyed && containerRef.current) {
            collabY = Y;
            const ydoc = new Y.Doc();
            const ytext = ydoc.getText("content");
            const ycomments = ydoc.getMap("comments");

            // Don't pre-seed ytext — the server provides content via
            // the Yjs sync protocol. Pre-seeding causes CRDT merge to
            // duplicate text when multiple clients connect.
            const provider = new WebsocketProvider(wsUrl, docId, ydoc, {
              params: wsParams ?? {},
            });
            const PRESENCE_COLORS = [
              "#AF3029", "#205EA6", "#66800B", "#D0A215", "#5E409D", "#A02F6F",
              "#24837B", "#879A39", "#DA702C", "#4385BE", "#3AA99F", "#D14D41",
            ];

            const userName = userInfo?.name ?? "Guest";
            provider.awareness.setLocalStateField("user", {
              name: userName,
              color: userInfo?.color ?? PRESENCE_COLORS[0],
            });

            const undoManager = new Y.UndoManager(ytext);
            collabExtensions = [
              yCollab(ytext, provider.awareness, { undoManager }),
              keymap.of(yUndoManagerKeymap),
            ];

            // Clear undo history after initial sync so Ctrl+Z doesn't empty the doc
            provider.once("sync", () => {
              undoManager.clear();
            });

            // ── Pick a unique color after seeing other peers ──
            const pickUniqueColor = () => {
              const states = provider.awareness.getStates();
              const localId = provider.awareness.clientID;
              const usedColors = new Set<string>();
              states.forEach((state, clientId) => {
                if (state.user && clientId !== localId) {
                  usedColors.add(state.user.color);
                }
              });
              const available = PRESENCE_COLORS.find(c => !usedColors.has(c));
              if (available) {
                provider.awareness.setLocalStateField("user", {
                  name: userName,
                  color: available,
                });
              }
            };
            provider.once("sync", pickUniqueColor);

            // ── Connection status tracking ─────────────────
            const emitStatus = (evt: { status: string }) => {
              const s = evt.status === "connected" ? "connected"
                : evt.status === "connecting" ? "connecting"
                : "disconnected";
              onConnectionStatusRef.current?.(s);
            };
            provider.on("status", emitStatus);
            // Emit initial status
            onConnectionStatusRef.current?.(provider.wsconnected ? "connected" : "connecting");

            // ── Presence tracking ──────────────────────────
            const emitPresence = () => {
              const states = provider.awareness.getStates();
              const localId = provider.awareness.clientID;
              const peers: Peer[] = [];
              states.forEach((state, clientId) => {
                if (state.user && clientId !== localId) {
                  peers.push({ name: state.user.name, color: state.user.color });
                }
              });
              onPresenceRef.current?.(peers);
            };
            provider.awareness.on("change", emitPresence);
            provider.on("sync", emitPresence);

            // ── Comments: resolve Yjs map → ResolvedThread[] ──
            function resolveThreadsFromYjs() {
              if (!viewRef.current) return;
              const view = viewRef.current;
              const threads: import("./comment-decorations").ResolvedThread[] = [];
              const replyMap = new Map<string, Array<{
                id: string; userId: string; userName: string;
                body: string; createdAt: number; updatedAt: number;
              }>>();

              // First pass: collect replies
              ycomments.forEach((val, key) => {
                const entry = val as Record<string, unknown>;
                if (entry.threadId) {
                  const tid = entry.threadId as string;
                  if (!replyMap.has(tid)) replyMap.set(tid, []);
                  replyMap.get(tid)!.push({
                    id: key,
                    userId: entry.userId as string,
                    userName: (entry.userName as string) ?? "Unknown",
                    body: (entry.body as string) ?? "",
                    createdAt: (entry.createdAt as number) ?? 0,
                    updatedAt: (entry.updatedAt as number) ?? 0,
                  });
                }
              });

              // Second pass: build threads from root comments
              ycomments.forEach((val, key) => {
                const entry = val as Record<string, unknown>;
                if (entry.threadId) return; // skip replies

                let from = 0, to = 0;
                let anchorDeleted = false;
                const anchorFrom = entry.anchorFrom;
                const anchorTo = entry.anchorTo;

                if (anchorFrom && anchorTo) {
                  try {
                    const absFrom = collabY.createAbsolutePositionFromRelativePosition(
                      anchorFrom as any, ydoc
                    );
                    const absTo = collabY.createAbsolutePositionFromRelativePosition(
                      anchorTo as any, ydoc
                    );
                    if (absFrom && absTo) {
                      from = absFrom.index;
                      to = absTo.index;
                    } else {
                      anchorDeleted = true;
                    }
                  } catch {
                    anchorDeleted = true;
                  }
                } else {
                  anchorDeleted = true;
                }

                // Compute top position
                let top = 0;
                if (!anchorDeleted && from < to) {
                  try {
                    const coords = view.coordsAtPos(Math.min(from, view.state.doc.length));
                    if (coords) {
                      const editorRect = view.dom.getBoundingClientRect();
                      top = coords.top - editorRect.top + view.dom.scrollTop;
                    }
                  } catch {}
                }

                const replies = replyMap.get(key) ?? [];
                replies.sort((a, b) => a.createdAt - b.createdAt);

                threads.push({
                  id: key,
                  from,
                  to,
                  anchorText: (entry.anchorText as string) ?? null,
                  resolved: !!(entry.resolved as number),
                  userId: (entry.userId as string) ?? "",
                  userName: (entry.userName as string) ?? "Unknown",
                  body: (entry.body as string) ?? "",
                  createdAt: (entry.createdAt as number) ?? 0,
                  replies,
                  top,
                  anchorDeleted,
                });
              });

              threads.sort((a, b) => a.from - b.from || a.createdAt - b.createdAt);
              return threads;
            }

            function emitThreads() {
              const threads = resolveThreadsFromYjs();
              if (!threads || !viewRef.current) return;
              dispatchThreads(viewRef.current, threads);
              onThreadsRef.current?.(threads);
            }

            // Observe Yjs comments map for changes
            const onCommentsMapChange = () => {
              requestAnimationFrame(emitThreads);
            };
            ycomments.observeDeep(onCommentsMapChange);

            // Also re-resolve after sync and on doc changes (positions may shift)
            provider.on("sync", () => requestAnimationFrame(emitThreads));
            ydoc.on("update", () => requestAnimationFrame(emitThreads));

            // Store ydoc/ycomments refs for the onReady API
            collabYdoc = ydoc;
            collabYtext = ytext;
            collabYcomments = ycomments;

            collabCleanup = () => {
              ycomments.unobserveDeep(onCommentsMapChange);
              provider.off("status", emitStatus);
              provider.awareness.off("change", emitPresence);
              provider.off("sync", emitPresence);
              onPresenceRef.current?.([]);
              provider.destroy();
              ydoc.destroy();
            };
            hasCollab = true;
          }
        } catch (err) {
          console.error("[Editor] Yjs init failed, using offline mode:", err);
        }
      }

      // ── Mount CodeMirror editor ──────────────────────────
      if (destroyed || !containerRef.current) return;

      // When Yjs collab is active, start with an empty doc — yCollab
      // will populate the editor once the WebSocket sync completes.
      // Using initialValue here would cause CRDT merge to duplicate text.
      const view = new EditorView({
        state: EditorState.create({
          doc: hasCollab ? "" : initialValue,
          extensions: [
            ...baseExtensions,
            ...(hasCollab ? [] : [history(), keymap.of(historyKeymap)]),
            ...(collabExtensions as any[]),
          ],
        }),
        parent: containerRef.current,
      });

      // ── Spellcheck: set directly on DOM to bypass CM defaults ──
      view.contentDOM.setAttribute("spellcheck", "true");
      view.contentDOM.setAttribute("lang", spellLangRef.current);
      document.documentElement.lang = spellLangRef.current;

      viewRef.current = view;
      cleanupRef.current = () => {
        dismissLinkMenu();
        dismissHighlightBtn();
        collabCleanup?.();
        view.destroy();
        viewRef.current = null;
      };
      function createComment(body?: string): string | undefined {
        const v = viewRef.current;
        if (!v || !collabY || !collabYdoc || !collabYtext || !collabYcomments) return;
        const sel = v.state.selection.main;
        if (sel.empty) return; // require text selection
        const userId = currentUserIdRef.current ?? "";
        const authorName = userInfoRef.current?.name ?? "Guest";
        const id = nanoid(16);
        const now = Math.floor(Date.now() / 1000);

        const anchorFrom = collabY.createRelativePositionFromTypeIndex(collabYtext, sel.from);
        const anchorTo = collabY.createRelativePositionFromTypeIndex(collabYtext, sel.to);
        const anchorText = v.state.sliceDoc(sel.from, sel.to);

        collabYcomments.set(id, {
          threadId: null,
          userId,
          userName: authorName,
          body: body ?? "",
          anchorFrom,
          anchorTo,
          anchorText,
          resolved: 0,
          createdAt: now,
          updatedAt: now,
        });
        return id;
      }

      addCommentHandler = () => createComment();

      onReadyRef.current?.({
        getContent: () => viewRef.current?.state.doc.toString() ?? "",
        getSelectedText: () => {
          const v = viewRef.current;
          if (!v) return "";
          const sel = v.state.selection.main;
          return sel.empty ? "" : v.state.sliceDoc(sel.from, sel.to);
        },
        addComment: createComment,
        addReply: (threadId: string, body: string) => {
          if (!collabYcomments) return;
          const userId = currentUserIdRef.current ?? "";
          const authorName = userInfoRef.current?.name ?? "Guest";
          const id = nanoid(16);
          const now = Math.floor(Date.now() / 1000);

          collabYcomments.set(id, {
            threadId,
            userId,
            userName: authorName,
            body,
            anchorFrom: null,
            anchorTo: null,
            anchorText: null,
            resolved: 0,
            createdAt: now,
            updatedAt: now,
          });
        },
        updateComment: (commentId: string, body: string) => {
          if (!collabYcomments) return;
          const entry = collabYcomments.get(commentId) as Record<string, unknown> | undefined;
          if (!entry) return;
          collabYcomments.set(commentId, {
            ...entry,
            body,
            updatedAt: Math.floor(Date.now() / 1000),
          });
        },
        deleteComment: (commentId: string) => {
          if (!collabYcomments) return;
          collabYcomments.delete(commentId);
        },
        resolveThread: (threadId: string) => {
          if (!collabYcomments) return;
          const entry = collabYcomments.get(threadId) as Record<string, unknown> | undefined;
          if (!entry) return;
          collabYcomments.set(threadId, { ...entry, resolved: 1, updatedAt: Math.floor(Date.now() / 1000) });
        },
        unresolveThread: (threadId: string) => {
          if (!collabYcomments) return;
          const entry = collabYcomments.get(threadId) as Record<string, unknown> | undefined;
          if (!entry) return;
          collabYcomments.set(threadId, { ...entry, resolved: 0, updatedAt: Math.floor(Date.now() / 1000) });
        },
        scrollToPos: (pos: number) => {
          const v = viewRef.current;
          if (!v) return;
          v.dispatch({
            selection: EditorSelection.cursor(Math.min(pos, v.state.doc.length)),
            scrollIntoView: true,
          });
          v.focus();
        },
        format: (before, after) => {
          const v = viewRef.current;
          if (!v) return;
          const changes = v.state.changeByRange((range) => {
            if (range.empty) {
              return {
                changes: { from: range.from, insert: before + after },
                range: EditorSelection.cursor(range.from + before.length),
              };
            }
            // Toggle: unwrap if already wrapped
            const doc = v.state.doc;
            const beforeStart = range.from - before.length;
            const afterEnd = range.to + after.length;
            // Case 1: markers are outside the selection
            if (
              after.length > 0 &&
              beforeStart >= 0 &&
              afterEnd <= doc.length &&
              doc.sliceString(beforeStart, range.from) === before &&
              doc.sliceString(range.to, afterEnd) === after
            ) {
              return {
                changes: [
                  { from: beforeStart, to: range.from, insert: "" },
                  { from: range.to, to: afterEnd, insert: "" },
                ],
                range: EditorSelection.range(beforeStart, range.to - before.length),
              };
            }
            // Case 2: markers are inside the selection (hidden by decorations)
            const sel = doc.sliceString(range.from, range.to);
            if (
              after.length > 0 &&
              sel.startsWith(before) &&
              sel.endsWith(after) &&
              sel.length > before.length + after.length
            ) {
              return {
                changes: [
                  { from: range.from, to: range.from + before.length, insert: "" },
                  { from: range.to - after.length, to: range.to, insert: "" },
                ],
                range: EditorSelection.range(
                  range.from,
                  range.to - before.length - after.length
                ),
              };
            }
            return {
              changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
              range: EditorSelection.range(range.from + before.length, range.to + before.length),
            };
          });
          v.dispatch(v.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
          v.focus();
        },
        formatLine: (prefix) => {
          const v = viewRef.current;
          if (!v) return;
          // Block prefix pattern: #+ , > , - , 1. etc.
          const BLOCK_RE = /^(#{1,6} |> |- |\d+\. )/;
          const changes = v.state.changeByRange((range) => {
            const fromLine = v.state.doc.lineAt(range.from);
            const toLine   = v.state.doc.lineAt(range.to === range.from ? range.from : range.to - 1);
            const lineChanges: { from: number; to: number; insert: string }[] = [];
            let delta = 0;
            for (let n = fromLine.number; n <= toLine.number; n++) {
              const line = v.state.doc.line(n);
              const existing = BLOCK_RE.exec(line.text)?.[0] ?? "";
              if (existing === prefix) {
                // toggle off
                lineChanges.push({ from: line.from, to: line.from + existing.length, insert: "" });
                delta -= existing.length;
              } else {
                // replace or prepend
                lineChanges.push({ from: line.from, to: line.from + existing.length, insert: prefix });
                delta += prefix.length - existing.length;
              }
            }
            return {
              changes: lineChanges,
              range: EditorSelection.range(range.from + delta, range.to + delta),
            };
          });
          v.dispatch(v.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
          v.focus();
        },
        focus: () => {
          viewRef.current?.focus();
        },
        uploadImage: (file: File) => {
          const v = viewRef.current;
          if (v) uploadImage(v, file);
        },
        insertAt: (pos: number, text: string) => {
          const v = viewRef.current;
          if (!v) return;
          const clampedPos = Math.min(pos, v.state.doc.length);
          v.dispatch({
            changes: { from: clampedPos, insert: text },
            selection: { anchor: clampedPos + text.length },
            scrollIntoView: true,
            userEvent: "input",
          });
          v.focus();
        },
        replaceContent: (newContent: string, cursorPos?: number) => {
          const v = viewRef.current;
          if (!v) return;
          const pos = cursorPos ?? newContent.length;
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: newContent },
            selection: { anchor: Math.min(pos, newContent.length) },
            scrollIntoView: true,
            userEvent: "input",
          });
          v.focus();
        },
      });
      if (autoFocus) view.focus();
    }

    init().catch((err) => {
      console.error("[Editor] Fatal init error:", err);
    });

    return () => {
      destroyed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content into the editor (polling fallback)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || syncedContent === undefined) return;
    const current = view.state.doc.toString();
    if (current !== syncedContent) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: syncedContent },
      });
    }
  }, [syncedContent]);

  // Update lang on both <html> and the contenteditable when language changes
  useEffect(() => {
    document.documentElement.lang = spellLang;
    viewRef.current?.contentDOM.setAttribute("lang", spellLang);
  }, [spellLang]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
    />
  );
}
