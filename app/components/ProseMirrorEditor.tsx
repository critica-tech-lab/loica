import { useEffect, useRef } from "react";
import type { EditorApi } from "~/lib/DocumentContext";
import type { Peer } from "~/components/Editor";
import type { PMActiveState } from "./editor/types";
import type { ResolvedThread } from "~/components/comment-decorations";
import { nanoid } from "nanoid";

interface Props {
  docId: string;
  wsUrl: string;
  wsParams?: Record<string, string>;
  userInfo: { name: string; color: string };
  currentUserId?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  onReady?: (api: EditorApi) => void;
  onPresenceChange?: (peers: Peer[]) => void;
  onConnectionStatus?: (
    status: "connected" | "connecting" | "disconnected"
  ) => void;
  onChange?: (content: string) => void;
  onStateChange?: (state: PMActiveState) => void;
  onThreadsChange?: (threads: ResolvedThread[]) => void;
  onThreadClick?: (thread: ResolvedThread) => void;
  onSelectionChange?: (sel: { from: number; to: number; top: number; left: number } | null) => void;
  focusedCommentId?: string | null;
}

// Module-level lazy promises so deps load once per page lifetime.
let pmDeps: Promise<any[]> | null = null;
let yjsDeps: Promise<any[]> | null = null;

function loadDeps() {
  if (!pmDeps) {
    pmDeps = Promise.all([
      import("prosemirror-state"),
      import("prosemirror-view"),
      import("prosemirror-commands"),
      import("prosemirror-tables"),
      import("./editor/schema"),
      import("./editor/plugins"),
    ]) as any;
  }
  if (!yjsDeps) {
    yjsDeps = Promise.all([
      import("yjs"),
      import("y-websocket"),
      import("y-prosemirror"),
    ]) as any;
  }
  return Promise.all([pmDeps, yjsDeps]);
}

export function ProseMirrorEditor({
  docId,
  wsUrl,
  wsParams,
  userInfo,
  readOnly = false,
  autoFocus = false,
  onReady,
  onPresenceChange,
  onConnectionStatus,
  onChange,
  onStateChange,
  onThreadsChange,
  onThreadClick: _onThreadClick,
  onSelectionChange,
  focusedCommentId,
  currentUserId,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const providerRef = useRef<any>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Stable ref to current threads — lets addComment() append without going through the plugin
  const threadsRef = useRef<ResolvedThread[]>([]);
  const onThreadsChangeRef = useRef(onThreadsChange);
  onThreadsChangeRef.current = onThreadsChange;
  const onThreadClickRef = useRef(_onThreadClick);
  onThreadClickRef.current = _onThreadClick;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Sync focused-comment CSS class imperatively — no plugin change needed
  useEffect(() => {
    const root = mountRef.current;
    if (!root) return;
    root.querySelectorAll(".pm-comment-highlight.pm-comment-focused").forEach(
      (el) => el.classList.remove("pm-comment-focused")
    );
    if (focusedCommentId) {
      root.querySelectorAll(`[data-comment-id="${focusedCommentId}"]`).forEach(
        (el) => el.classList.add("pm-comment-focused")
      );
    }
  }, [focusedCommentId]);

  useEffect(() => {
    if (!mountRef.current) return;

    let destroyed = false;

    async function init() {
      const [pmMods, yjsMods] = await loadDeps();
      if (destroyed || !mountRef.current) return;

      const [
        { EditorState },
        { EditorView },
        { toggleMark, setBlockType, wrapIn, lift },
        { goToNextCell },
        { schema },
        { buildPlugins },
      ] = pmMods as any[];

      const { wrapInList, liftListItem } = await import("prosemirror-schema-list");
      const { addColumnAfter } = await import("prosemirror-tables");
      const { makeImageNodeView } = await import("./editor/image-view");
      const { pmCommentPlugin } = await import("./editor/pm-comments");

      const [Y, { WebsocketProvider }, {
        ySyncPlugin, yCursorPlugin, yUndoPlugin,
        ySyncPluginKey,
        absolutePositionToRelativePosition,
        relativePositionToAbsolutePosition,
      }] = yjsMods as any[];

      // Import ProseMirror CSS once
      await Promise.all([
        import("prosemirror-view/style/prosemirror.css" as string),
        import("prosemirror-tables/style/tables.css" as string),
      ]).catch(() => {
        // CSS imports may fail in SSR/test environments — safe to ignore
      });

      if (destroyed) return;

      const ydoc = new Y.Doc();
      const yXmlFragment = ydoc.getXmlFragment("prosemirror");
      const commentsMap = ydoc.getMap("comments");

      const provider = new WebsocketProvider(wsUrl, docId, ydoc, {
        connect: true,
        params: wsParams ?? {},
      });
      providerRef.current = provider;

      provider.awareness.setLocalStateField("user", {
        name: userInfo.name,
        color: userInfo.color,
      });

      provider.on("status", ({ status }: { status: string }) => {
        onConnectionStatus?.(
          status === "connected"
            ? "connected"
            : status === "connecting"
            ? "connecting"
            : "disconnected"
        );
      });

      provider.awareness.on("change", () => {
        const peers: Peer[] = [];
        provider.awareness.getStates().forEach((state: any, clientId: number) => {
          if (clientId !== ydoc.clientID && state.user) {
            peers.push({
              name: state.user.name,
              color: state.user.color,
            });
          }
        });
        onPresenceChange?.(peers);
      });

      const wrappedOnThreadsChange = (threads: ResolvedThread[]) => {
        threadsRef.current = threads;
        onThreadsChangeRef.current?.(threads);
      };

      const plugins = [
        ...buildPlugins(schema, readOnlyRef.current),
        ySyncPlugin(yXmlFragment),
        yCursorPlugin(provider.awareness),
        ...(readOnlyRef.current ? [] : [yUndoPlugin()]),
        pmCommentPlugin(ydoc, yXmlFragment, commentsMap, wrappedOnThreadsChange, {
          ySyncPluginKey,
          relativePositionToAbsolutePosition,
        }),
      ];

      const state = EditorState.create({ schema, plugins });

      // `let` + null guard: y-prosemirror's ySyncPlugin calls dispatchTransaction
      // during the EditorView constructor (to force initial render), before `view`
      // is assigned. Guard with null check so that early call is a no-op.
      function computeActiveState(s: any): PMActiveState {
        const { from, $from, to, empty } = s.selection;
        function markActive(markType: any): boolean {
          if (empty) return !!markType.isInSet(s.storedMarks || $from.marks());
          return s.doc.rangeHasMark(from, to, markType);
        }
        let heading: 0 | 1 | 2 | 3 | 4 = 0;
        let inBlockquote = false;
        let inBulletList = false;
        let inOrderedList = false;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type === schema.nodes.heading) heading = node.attrs.level;
          if (node.type === schema.nodes.blockquote) inBlockquote = true;
          if (node.type === schema.nodes.bullet_list) inBulletList = true;
          if (node.type === schema.nodes.ordered_list) inOrderedList = true;
        }
        return {
          strong: markActive(schema.marks.strong),
          em: markActive(schema.marks.em),
          underline: markActive(schema.marks.underline),
          strikethrough: markActive(schema.marks.strikethrough),
          code: markActive(schema.marks.code),
          heading,
          inBlockquote,
          inBulletList,
          inOrderedList,
        };
      }

      // Set to a commentId during the synchronous click→dispatchTransaction window
      // so we can suppress the null-selection emission for that same click.
      let pendingClickId: string | null = null;

      let view: any = null;
      view = new EditorView(mountRef.current, {
        state,
        editable: () => !readOnlyRef.current,
        nodeViews: {
          image: (node: any, view: any, getPos: any) => makeImageNodeView(node, view, getPos),
        },
        handleDOMEvents: {
          click: (_view: any, event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const el = target.closest("[data-comment-id]") as HTMLElement | null;
            if (!el) return false;
            const commentId = el.getAttribute("data-comment-id");
            if (!commentId) return false;
            const thread = threadsRef.current.find(t => t.id === commentId);
            if (thread) {
              pendingClickId = commentId;
              Promise.resolve().then(() => { pendingClickId = null; });
              onThreadClickRef.current?.(thread);
            }
            return false;
          },
        },
        dispatchTransaction(tr: any) {
          if (!view) return;
          const newState = view.state.apply(tr);
          view.updateState(newState);
          if (tr.docChanged) {
            onChange?.(view.state.doc.textContent);
          }
          onStateChange?.(computeActiveState(view.state));
          // Emit selection for bubble menu
          const { from, to } = view.state.selection;
          if (onSelectionChangeRef.current) {
            if (to > from) {
              let top = 0, left = 0;
              try { const c = view.coordsAtPos(from); top = c.top; left = c.left; } catch {}
              onSelectionChangeRef.current({ from, to, top, left });
            } else if (!pendingClickId) {
              // Skip null emission for the same click that just focused a comment
              onSelectionChangeRef.current(null);
            }
          }
        },
      });
      viewRef.current = view;

      if (autoFocus && !readOnlyRef.current) view.focus();

      // Build the EditorApi surface that DocEditorView / SelectionBubble / Toolbar use.
      const api: EditorApi = {
        getContent: () => view.state.doc.textContent,

        getSelectedText: () => {
          const { from, to } = view.state.selection;
          return view.state.doc.textBetween(from, to, " ");
        },

        // Map the markdown-style format("**","**") calls that the existing
        // SelectionBubble and Toolbar emit to proper ProseMirror mark commands.
        format: (before: string, after: string) => {
          if (!view) return;
          const markMap: Record<string, any> = {
            "**": schema.marks.strong,
            "*": schema.marks.em,
            "_": schema.marks.em,
            "__": schema.marks.underline,
            "~~": schema.marks.strikethrough,
            "`": schema.marks.code,
          };
          const mark = markMap[before];
          if (mark) {
            toggleMark(mark)(view.state, view.dispatch);
            view.focus();
            return;
          }
          // Fallback: surround selection with literal text
          const { from, to } = view.state.selection;
          const selected = view.state.doc.textBetween(from, to);
          view.dispatch(
            view.state.tr.insertText(before + selected + after, from, to)
          );
          view.focus();
        },

        formatLine: (_prefix: string) => {},

        // ProseMirror block commands
        setHeading: (level: number) => {
          setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
          view.focus();
        },
        clearFormatting: () => {
          setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
          view.focus();
        },
        toggleBlockquote: () => {
          const { $from } = view.state.selection;
          let inBlockquote = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === schema.nodes.blockquote) { inBlockquote = true; break; }
          }
          if (inBlockquote) lift(view.state, view.dispatch);
          else wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
          view.focus();
        },
        toggleBulletList: () => {
          const { $from } = view.state.selection;
          let inList = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === schema.nodes.bullet_list) { inList = true; break; }
          }
          if (inList) liftListItem(schema.nodes.list_item)(view.state, view.dispatch);
          else wrapInList(schema.nodes.bullet_list)(view.state, view.dispatch);
          view.focus();
        },
        toggleOrderedList: () => {
          const { $from } = view.state.selection;
          let inList = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === schema.nodes.ordered_list) { inList = true; break; }
          }
          if (inList) liftListItem(schema.nodes.list_item)(view.state, view.dispatch);
          else wrapInList(schema.nodes.ordered_list)(view.state, view.dispatch);
          view.focus();
        },
        insertTable: () => {
          const cols = 3;
          const headerCells = Array.from({ length: cols }, () =>
            schema.nodes.table_header.createAndFill()
          );
          const bodyRow = schema.nodes.table_row.create(
            null,
            Array.from({ length: cols }, () => schema.nodes.table_cell.createAndFill())
          );
          const table = schema.nodes.table.create(null, [
            schema.nodes.table_row.create(null, headerCells),
            bodyRow,
            schema.nodes.table_row.create(null, Array.from({ length: cols }, () => schema.nodes.table_cell.createAndFill())),
          ]);
          const { $from } = view.state.selection;
          const insertPos = $from.after(1);
          view.dispatch(
            view.state.tr.insert(insertPos, table).scrollIntoView()
          );
          view.focus();
        },
        insertHr: () => {
          const hr = schema.nodes.horizontal_rule.create();
          const { $from } = view.state.selection;
          const insertPos = $from.after(1);
          view.dispatch(view.state.tr.insert(insertPos, hr).scrollIntoView());
          view.focus();
        },

        // Comments — store plain PM integer positions (no y-prosemirror mapping needed)
        addComment: (body = "") => {
          const { from, to } = view.state.selection;
          const anchorText = from < to ? view.state.doc.textBetween(from, to, " ") : "";
          const id = nanoid();
          const now = Math.floor(Date.now() / 1000);
          commentsMap.set(id, {
            threadId: null,
            userId: currentUserId ?? "",
            userName: userInfo.name,
            body,
            anchorFrom: from < to ? from : null,
            anchorTo:   from < to ? to   : null,
            anchorText,
            resolved: 0,
            createdAt: now,
            updatedAt: now,
          });

          // Immediately surface the new comment to React without waiting for
          // the plugin observer chain (which may be async or miss first render).
          let top = 0;
          try { if (from < to) top = view.coordsAtPos(from).top; } catch {}
          const newThread: ResolvedThread = {
            id, from, to,
            anchorText,
            resolved: false,
            userId: currentUserId ?? "",
            userName: userInfo.name,
            body: "",
            createdAt: now,
            replies: [],
            top,
            anchorDeleted: !(from < to),
          };
          const updated = [...threadsRef.current.filter(t => t.id !== id), newThread];
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);

          return id;
        },

        addReply: (threadId: string, body: string) => {
          const id = nanoid();
          const now = Math.floor(Date.now() / 1000);
          // Yjs fires observers synchronously on local changes, so the plugin
          // observer handles the React state update — no optimistic update needed.
          commentsMap.set(id, {
            threadId,
            userId: currentUserId ?? "",
            userName: userInfo.name,
            body,
            anchorFrom: null, anchorTo: null, anchorText: null,
            resolved: 0,
            createdAt: now, updatedAt: now,
          });
        },

        updateComment: (commentId: string, body: string) => {
          const entry = commentsMap.get(commentId);
          if (!entry) return;
          commentsMap.set(commentId, { ...entry, body, updatedAt: Math.floor(Date.now() / 1000) });
          // Root comment update
          const updated = threadsRef.current.map(t =>
            t.id === commentId ? { ...t, body } :
            { ...t, replies: t.replies.map(r => r.id === commentId ? { ...r, body } : r) }
          );
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);
        },

        deleteComment: (commentId: string) => {
          commentsMap.delete(commentId);
          // Remove root thread or reply
          const withoutThread = threadsRef.current.filter(t => t.id !== commentId);
          const updated = withoutThread.map(t => ({
            ...t, replies: t.replies.filter(r => r.id !== commentId),
          }));
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);
        },

        resolveThread: (threadId: string) => {
          const entry = commentsMap.get(threadId);
          if (entry) commentsMap.set(threadId, { ...entry, resolved: 1, updatedAt: Math.floor(Date.now() / 1000) });
          const updated = threadsRef.current.map(t => t.id === threadId ? { ...t, resolved: true } : t);
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);
        },

        unresolveThread: (threadId: string) => {
          const entry = commentsMap.get(threadId);
          if (entry) commentsMap.set(threadId, { ...entry, resolved: 0, updatedAt: Math.floor(Date.now() / 1000) });
          const updated = threadsRef.current.map(t => t.id === threadId ? { ...t, resolved: false } : t);
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);
        },

        scrollToPos: (pos: number) => {
          try {
            const coords = view.coordsAtPos(pos);
            const el = document.elementFromPoint(coords.left, coords.top);
            el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch {}
        },

        focus: () => view.focus(),

        // Suggestions — phase 3
        addSuggestion: () => {},
        acceptSuggestion: () => {},
        rejectSuggestion: () => {},
        getSuggestions: () => [],

        uploadImage: async (file: File) => {
          const { schema: s } = view.state;
          // Insert placeholder
          const placeholderNode = s.nodes.image.create({ src: "", alt: "Uploading…" });
          const { from } = view.state.selection;
          view.dispatch(view.state.tr.insert(from, placeholderNode));
          const placeholderPos = from;

          try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: formData });
            if (!res.ok) throw new Error(await res.text());
            const { url } = await res.json();
            // Replace placeholder with real image
            const doc = view.state.doc;
            doc.nodesBetween(placeholderPos, placeholderPos + 1, (node: any, pos: number) => {
              if (node.type === s.nodes.image && node.attrs.alt === "Uploading…") {
                view.dispatch(
                  view.state.tr.setNodeMarkup(pos, undefined, { src: url, alt: "" })
                );
                return false;
              }
            });
          } catch {
            // Remove placeholder on error
            view.dispatch(view.state.tr.delete(placeholderPos, placeholderPos + 1));
          }
        },

        insertAt: (pos: number, text: string) => {
          view.dispatch(view.state.tr.insertText(text, pos));
        },

        replaceContent: () => {},

        exportDocx: async (filename = "document.docx") => {
          const { defaultDocxSerializer, writeDocx } = await import("prosemirror-docx");
          const doc = defaultDocxSerializer.serialize(view.state.doc, {
            getImageBuffer: (src: string) => new Uint8Array(0),
          });
          const buffer = await writeDocx(doc);
          const blob = new Blob([new Uint8Array(buffer as any)], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        },
      };

      // Signal ready after the Yjs provider has completed its first sync.
      // For brand-new docs (no server state) the sync fires quickly; for
      // existing docs it fires once the server state is applied to the view.
      provider.once("sync", (_isSynced: boolean) => {
        if (!destroyed) {
          onReady?.(api);
          onStateChange?.(computeActiveState(view.state));
        }
      });

      // Safety fallback: if the websocket never connects (offline, bad URL),
      // still surface the editor so the user can type locally.
      setTimeout(() => {
        if (!destroyed && viewRef.current) onReady?.(api);
      }, 3000);
    }

    init();

    return () => {
      destroyed = true;
      viewRef.current?.destroy();
      providerRef.current?.disconnect();
      providerRef.current?.destroy();
      viewRef.current = null;
      providerRef.current = null;
    };
    // docId / wsUrl change → full remount handled by `key` prop from parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, wsUrl]);

  return (
    <div
      ref={mountRef}
      className="pm-editor-mount"
      style={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
      onBlur={(e) => {
        if (!mountRef.current?.contains(e.relatedTarget as Node)) {
          onSelectionChangeRef.current?.(null);
        }
      }}
    />
  );
}
