import { useEffect, useRef } from "react";
import type { EditorApi } from "~/lib/DocumentContext";
import type { Peer } from "~/components/Editor";
import type { PMActiveState, TrackChangesActiveState, TrackedChangeEntry } from "./editor/types";
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
  mountRefOut?: React.RefObject<HTMLDivElement | null>;
  onReady?: (api: EditorApi) => void;
  onPresenceChange?: (peers: Peer[]) => void;
  onConnectionStatus?: (
    status: "connected" | "connecting" | "disconnected"
  ) => void;
  onChange?: (content: string) => void;
  onStateChange?: (state: PMActiveState) => void;
  onTrackChangesStateChange?: (state: TrackChangesActiveState) => void;
  onTrackChangeClick?: (changeId: string, pos: { x: number; y: number }) => void;
  onThreadsChange?: (threads: ResolvedThread[]) => void;
  onThreadClick?: (thread: ResolvedThread, pos: { x: number; y: number }) => void;
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
  mountRefOut,
  onReady,
  onPresenceChange,
  onConnectionStatus,
  onChange,
  onStateChange,
  onTrackChangesStateChange,
  onTrackChangeClick,
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
  const userInfoRef = useRef(userInfo);
  userInfoRef.current = userInfo;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  // Stable ref to current threads — lets addComment() append without going through the plugin
  const threadsRef = useRef<ResolvedThread[]>([]);
  const onThreadsChangeRef = useRef(onThreadsChange);
  onThreadsChangeRef.current = onThreadsChange;
  const onThreadClickRef = useRef(_onThreadClick);
  onThreadClickRef.current = _onThreadClick;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onTrackChangesStateChangeRef = useRef(onTrackChangesStateChange);
  onTrackChangesStateChangeRef.current = onTrackChangesStateChange;
  const onTrackChangeClickRef = useRef(onTrackChangeClick);
  onTrackChangeClickRef.current = onTrackChangeClick;

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
      const {
        trackChangesPlugin,
        trackChangesPluginKey,
        trackCommands,
        TrackChangesStatus,
        CHANGE_STATUS,
      } = await import("@manuscripts/track-changes-plugin");

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
      const metaMap = ydoc.getMap("meta");

      const provider = new WebsocketProvider(wsUrl, docId, ydoc, {
        connect: true,
        params: wsParams ?? {},
      });
      providerRef.current = provider;

      provider.awareness.setLocalStateField("user", {
        name: userInfo.name,
        color: userInfo.color,
        userId: currentUserId,
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
        ...(readOnlyRef.current ? [] : [
          trackChangesPlugin({
            userID: currentUserId ?? "anonymous",
            // Restore per-user TC preference from localStorage
            initialStatus: (() => {
              try { return localStorage.getItem(`loica.tc.${docId}`) === "1" ? TrackChangesStatus.enabled : TrackChangesStatus.disabled; } catch { return TrackChangesStatus.disabled; }
            })(),
            skipTrsWithMetas: [ySyncPluginKey],
          }),
        ]),
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

      // Cache the last doc used for the disabled-TC scan so we skip re-scanning
      // when only cursor/selection changed (doc identity is stable in that case).
      let lastScannedDoc: any = null;
      let lastScannedPending: any[] = [];

      function emitTCState(pmState: any) {
        if (!onTrackChangesStateChangeRef.current) return;
        const tcState = trackChangesPluginKey.getState(pmState);
        if (!tcState) return;
        // When TC is disabled the plugin resets changeSet to empty on every transaction.
        // Fall back to scanning the doc directly for pending tracked marks/nodes.
        const isEnabled = tcState.status === TrackChangesStatus.enabled;
        let pending = tcState.changeSet.pending;
        if (!isEnabled && pending.length === 0) {
          if (pmState.doc === lastScannedDoc) {
            pending = lastScannedPending;
          } else {
            const docPending: any[] = [];
            pmState.doc.descendants((node: any, pos: number) => {
            // Inline text: tracked_insert / tracked_delete marks
            if (node.isText) {
              node.marks.forEach((mark: any) => {
                if (
                  (mark.type === pmState.schema.marks.tracked_insert ||
                   mark.type === pmState.schema.marks.tracked_delete) &&
                  mark.attrs.dataTracked?.status === "pending"
                ) {
                  const dt = mark.attrs.dataTracked;
                  docPending.push({
                    id: dt.id,
                    type: mark.type === pmState.schema.marks.tracked_insert ? "insert" : "delete",
                    from: pos,
                    to: pos + node.nodeSize,
                    text: node.text ?? "",
                    dataTracked: dt,
                  });
                }
              });
            } else {
              // Block nodes with dataTracked
              const dt = node.attrs?.dataTracked;
              if (dt?.id && dt?.status === "pending") {
                docPending.push({
                  id: dt.id,
                  type: "node-change",
                  from: pos,
                  to: pos + node.nodeSize,
                  text: node.textContent ?? "",
                  dataTracked: dt,
                  node,
                });
              }
            }
            });
            lastScannedDoc = pmState.doc;
            lastScannedPending = docPending;
            pending = docPending;
          }
        }
        // Build userId → displayName map from awareness + current user
        const userIdToName = new Map<string, string>();
        const uid = currentUserIdRef.current;
        if (uid) userIdToName.set(uid, userInfoRef.current.name);
        providerRef.current?.awareness?.getStates().forEach((state: any) => {
          if (state.user?.userId && state.user?.name) {
            userIdToName.set(state.user.userId, state.user.name);
          }
        });

        const raw: TrackedChangeEntry[] = pending.map((c: any) => {
          const op = c.dataTracked?.operation ?? "";
          const type: TrackedChangeEntry["type"] =
            op === "insert" ? "insert" : op === "delete" ? "delete" : "other";
          const text = c.text ?? c.node?.textContent ?? c.mark?.attrs?.dataTracked?.text ?? "";
          const authorId = c.dataTracked?.authorID ?? "";
          return {
            id: c.id, ids: [c.id], type, text,
            authorId,
            authorName: userIdToName.get(authorId) ?? authorId,
            createdAt: c.dataTracked?.createdAt ?? 0,
            from: c.from ?? 0,
            to: c.to ?? 0,
          };
        });
        const changes: TrackedChangeEntry[] = [];
        for (const c of raw) {
          const last = changes[changes.length - 1];
          if (
            last &&
            last.type === c.type &&
            last.type !== "other" &&
            last.authorId === c.authorId &&
            c.from <= last.to + 2
          ) {
            last.to = c.to;
            last.text = (last.text + c.text).trimStart();
            last.ids.push(c.id);
          } else {
            changes.push({ ...c });
          }
        }
        onTrackChangesStateChangeRef.current({
          enabled: tcState.status === TrackChangesStatus.enabled,
          pendingCount: changes.length,
          changes,
        });
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
            // Comment indicator icon (highest priority — always a comment action)
            const indicatorEl = target.closest(".pm-comment-indicator") as HTMLElement | null;
            if (indicatorEl) {
              const commentId = indicatorEl.getAttribute("data-comment-id");
              if (commentId) {
                const thread = threadsRef.current.find(t => t.id === commentId);
                if (thread) {
                  const rect = indicatorEl.getBoundingClientRect();
                  pendingClickId = commentId;
                  Promise.resolve().then(() => { pendingClickId = null; });
                  onThreadClickRef.current?.(thread, { x: rect.right + 8, y: rect.top });
                }
              }
              return false;
            }
            // Comment highlight (wins over tracked change when both overlap)
            const commentEl = target.closest("[data-comment-id]") as HTMLElement | null;
            if (commentEl) {
              const commentId = commentEl.getAttribute("data-comment-id");
              if (commentId) {
                const thread = threadsRef.current.find(t => t.id === commentId);
                if (thread) {
                  const rect = commentEl.getBoundingClientRect();
                  pendingClickId = commentId;
                  Promise.resolve().then(() => { pendingClickId = null; });
                  onThreadClickRef.current?.(thread, { x: rect.right, y: rect.top });
                }
              }
              return false;
            }
            // Tracked change click → open changes panel
            const trackEl = target.closest("[data-change-id]") as HTMLElement | null;
            if (trackEl) {
              const changeId = trackEl.getAttribute("data-change-id");
              if (changeId && onTrackChangeClickRef.current) {
                const rect = trackEl.getBoundingClientRect();
                onTrackChangeClickRef.current(changeId, { x: rect.left + rect.width / 2, y: rect.top });
                return false;
              }
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
          // Emit track-changes state
          emitTCState(view.state);
          // Emit selection for bubble menu
          const { from, to } = view.state.selection;
          if (onSelectionChangeRef.current) {
            if (to > from) {
              let top = 0, left = 0;
              try { const c = view.coordsAtPos(from); top = c.top; left = c.left; } catch {}
              onSelectionChangeRef.current({ from, to, top, left });
            } else if (!pendingClickId) {
              // Emit cursor position (from === to) so parent can distinguish
              // "cursor moved inside editor" from "editor blurred" (which stays null)
              onSelectionChangeRef.current({ from, to: from, top: 0, left: 0 });
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
          view.dispatch(view.state.tr); // rebuild decorations so indicator appears immediately

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
            body,
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
          view.dispatch(view.state.tr); // rebuild decorations
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
          view.dispatch(view.state.tr); // rebuild decorations
          const updated = threadsRef.current.map(t => t.id === threadId ? { ...t, resolved: true } : t);
          threadsRef.current = updated;
          onThreadsChangeRef.current?.(updated);
        },

        unresolveThread: (threadId: string) => {
          const entry = commentsMap.get(threadId);
          if (entry) commentsMap.set(threadId, { ...entry, resolved: 0, updatedAt: Math.floor(Date.now() / 1000) });
          view.dispatch(view.state.tr); // rebuild decorations
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

        getThreadPositions: () =>
          threadsRef.current
            .filter(t => !t.resolved && t.from > 0)
            .map(t => {
              let top = 0;
              try { top = view.coordsAtPos(t.from).top; } catch {}
              return { id: t.id, top };
            }),

        setViewOnly: (on: boolean) => {
          view.setProps({ editable: () => !on && !readOnlyRef.current });
        },

        // Toggle markup visibility — CSS class hides ins/del styling without accepting/rejecting
        setShowMarkup: (show: boolean) => {
          mountRef.current?.classList.toggle("hide-markup", !show);
        },

        toggleTrackChanges: () => {
          const tcState = trackChangesPluginKey.getState(view.state);
          if (!tcState) return;
          const next = tcState.status === TrackChangesStatus.enabled
            ? TrackChangesStatus.disabled
            : TrackChangesStatus.enabled;
          trackCommands.setTrackingStatus(next)(view.state, view.dispatch);
          // Persist per-user preference (per-doc) — TC state is per-user, not document-level
          try { localStorage.setItem(`loica.tc.${docId}`, next === TrackChangesStatus.enabled ? "1" : "0"); } catch {}
          view.focus();
        },

        acceptAllChanges: () => {
          const tcState = trackChangesPluginKey.getState(view.state);
          if (!tcState || !tcState.changeSet.pending.length) return;
          const ids = tcState.changeSet.pending.map((c: any) => c.id);
          trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(view.state, view.dispatch);
          view.focus();
        },

        rejectAllChanges: () => {
          const tcState = trackChangesPluginKey.getState(view.state);
          if (!tcState || !tcState.changeSet.pending.length) return;
          const ids = tcState.changeSet.pending.map((c: any) => c.id);
          trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)(view.state, view.dispatch);
          view.focus();
        },

        acceptChangeById: (id: string, allIds?: string[], changeType?: string) => {
          const ids = allIds ?? [id];
          // "Accept = keep text": for deletions this means REJECTING the deletion (restoring text)
          const status = changeType === "delete" ? CHANGE_STATUS.rejected : CHANGE_STATUS.accepted;
          const tcState = trackChangesPluginKey.getState(view.state);
          const wasDisabled = tcState?.status === TrackChangesStatus.disabled;
          if (wasDisabled) trackCommands.setTrackingStatus(TrackChangesStatus.enabled)(view.state, view.dispatch);
          trackCommands.setChangeStatuses(status, ids)(view.state, view.dispatch);
          if (wasDisabled) Promise.resolve().then(() => {
            trackCommands.setTrackingStatus(TrackChangesStatus.disabled)(view.state, view.dispatch);
          });
          view.focus();
        },

        rejectChangeById: (id: string, allIds?: string[], changeType?: string) => {
          const ids = allIds ?? [id];
          // "Reject = remove text": for deletions this means ACCEPTING the deletion (removing text)
          const status = changeType === "delete" ? CHANGE_STATUS.accepted : CHANGE_STATUS.rejected;
          const tcState = trackChangesPluginKey.getState(view.state);
          const wasDisabled = tcState?.status === TrackChangesStatus.disabled;
          if (wasDisabled) trackCommands.setTrackingStatus(TrackChangesStatus.enabled)(view.state, view.dispatch);
          trackCommands.setChangeStatuses(status, ids)(view.state, view.dispatch);
          if (wasDisabled) Promise.resolve().then(() => {
            trackCommands.setTrackingStatus(TrackChangesStatus.disabled)(view.state, view.dispatch);
          });
          view.focus();
        },

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
          emitTCState(view.state);
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

  // Forward mount ref to parent if requested
  useEffect(() => {
    if (mountRefOut) (mountRefOut as React.MutableRefObject<HTMLDivElement | null>).current = mountRef.current;
  });

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
