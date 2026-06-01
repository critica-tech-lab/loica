import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { ResolvedThread } from "~/components/comment-decorations";
import * as Y from "yjs";

export const pmCommentPluginKey = new PluginKey<DecorationSet>("pm-comments");

export function pmCommentPlugin(
  _ydoc: Y.Doc,
  _yXmlFragment: Y.XmlFragment,
  commentsMap: Y.Map<any>,
  onThreadsChange: (threads: ResolvedThread[]) => void,
  _helpers: unknown,
) {
  function buildDecorations(doc: any): DecorationSet {
    const decos: Decoration[] = [];
    const docSize: number = doc.content.size;
    if (docSize === 0) return DecorationSet.empty;

    commentsMap.forEach((entry: any, id: string) => {
      if (entry.threadId != null) return;
      if (entry.resolved) return;
      const from: number = typeof entry.anchorFrom === "number" ? entry.anchorFrom : 0;
      const to: number   = typeof entry.anchorTo   === "number" ? entry.anchorTo   : 0;
      if (from > 0 && to > from && to <= docSize) {
          try {
          decos.push(Decoration.inline(from, to, {
            class: "pm-comment-highlight",
            "data-comment-id": id,
          }));
        } catch {}
      }
    });

    try {
      return DecorationSet.create(doc, decos);
    } catch {
      return DecorationSet.empty;
    }
  }

  function buildThreads(editorView: any): ResolvedThread[] {
    const repliesMap: Record<string, ResolvedThread["replies"]> = {};
    commentsMap.forEach((entry: any, id: string) => {
      if (entry.threadId) {
        if (!repliesMap[entry.threadId]) repliesMap[entry.threadId] = [];
        repliesMap[entry.threadId].push({
          id,
          userId: entry.userId ?? "",
          userName: entry.userName ?? "Unknown",
          body: entry.body ?? "",
          createdAt: entry.createdAt ?? 0,
          updatedAt: entry.updatedAt ?? 0,
        });
      }
    });

    const threads: ResolvedThread[] = [];
    commentsMap.forEach((entry: any, id: string) => {
      if (entry.threadId != null) return;
      const from: number = typeof entry.anchorFrom === "number" ? entry.anchorFrom : 0;
      const to: number   = typeof entry.anchorTo   === "number" ? entry.anchorTo   : 0;
      const anchorDeleted = !(from > 0 && to > from);
      let top = 0;
      if (!anchorDeleted) {
        try { top = editorView.coordsAtPos(from).top; } catch {}
      }
      threads.push({
        id, from, to,
        anchorText: entry.anchorText ?? null,
        resolved: !!entry.resolved,
        userId: entry.userId ?? "",
        userName: entry.userName ?? "Unknown",
        body: entry.body ?? "",
        createdAt: entry.createdAt ?? 0,
        replies: repliesMap[id] ?? [],
        top,
        anchorDeleted,
      });
    });
    return threads.sort((a, b) => a.from - b.from);
  }

  return new Plugin<DecorationSet>({
    key: pmCommentPluginKey,

    state: {
      init(_, state) {
        return buildDecorations(state.doc);
      },
      // Recompute on every transaction — synchronous, no timing issues.
      apply(_tr, _old, _prevState, newState) {
        return buildDecorations(newState.doc);
      },
    },

    props: {
      decorations(state) { return this.getState(state); },
    },

    view(editorView) {
      // Notify React when Y.Map changes (collab updates from other users).
      function onMapChange() {
        onThreadsChange(buildThreads(editorView));
      }
      commentsMap.observe(onMapChange);

      return {
        destroy() {
          commentsMap.unobserve(onMapChange);
        },
      };
    },
  });
}
