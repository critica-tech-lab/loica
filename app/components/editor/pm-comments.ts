import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { ResolvedThread } from "~/components/comment-decorations";
import { COMMENT_INDICATOR_SVG } from "~/components/icons";
import * as Y from "yjs";

export const pmCommentPluginKey = new PluginKey<DecorationSet>("pm-comments");

function makeIndicator(commentId: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "pm-comment-indicator";
  el.setAttribute("data-comment-id", commentId);
  el.title = "View comment";
  el.innerHTML = COMMENT_INDICATOR_SVG;
  return el;
}

// Find the widget insertion position and node bounds for the indicator.
// - Inside a table cell → last cell in the row (so icon sits at table's right edge)
// - Otherwise → end of the direct parent block (paragraph, heading, etc.)
function findBlockInfo(doc: any, from: number): { indicatorPos: number; nodeFrom: number; nodeTo: number } | null {
  try {
    const $pos = doc.resolve(from);

    // Check all ancestors first — paragraph inside table_cell would be found before table_cell otherwise
    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      if (node.type.name === "table_cell" || node.type.name === "table_header") {
        return null;
      }
    }

    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      if (node.isBlock && !node.isInline &&
          ["paragraph", "heading", "list_item", "blockquote", "code_block"].includes(node.type.name)) {
        const nodeFrom = $pos.before(d);
        const nodeTo = nodeFrom + node.nodeSize;
        return { indicatorPos: $pos.end(d), nodeFrom, nodeTo };
      }
    }

    // Fallback
    const nodeFrom = $pos.before(1);
    return { indicatorPos: $pos.end(1), nodeFrom, nodeTo: nodeFrom + $pos.node(1).nodeSize };
  } catch {
    return null;
  }
}

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

    const indicatorPositions = new Set<number>();

    commentsMap.forEach((entry: any, id: string) => {
      if (entry.threadId != null) return;
      if (entry.resolved) return;
      const from: number = typeof entry.anchorFrom === "number" ? entry.anchorFrom : 0;
      const to: number   = typeof entry.anchorTo   === "number" ? entry.anchorTo   : 0;
      if (from > 0 && to > from && to <= docSize) {
        try {
          // Validate anchor text — if content was replaced the positions point to wrong text
          if (entry.anchorText) {
            const currentText = doc.textBetween(from, to, " ");
            if (currentText !== entry.anchorText) return;
          }

          // Inline highlight
          decos.push(Decoration.inline(from, to, {
            class: "pm-comment-highlight",
            "data-comment-id": id,
          }));

          // Clickable indicator icon at block/table boundary
          const info = findBlockInfo(doc, from);
          if (info && !indicatorPositions.has(info.indicatorPos)) {
            indicatorPositions.add(info.indicatorPos);
            // Node decoration to enable position:relative
            decos.push(Decoration.node(info.nodeFrom, info.nodeTo, {
              class: "has-comment-indicator",
            }));
            // Widget decoration: clickable icon
            decos.push(Decoration.widget(info.indicatorPos, () => makeIndicator(id), {
              side: 1,
              key: `indicator-${info.indicatorPos}`,
            }));
          }
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
      init(_, state) { return buildDecorations(state.doc); },
      apply(_tr, _old, _prevState, newState) { return buildDecorations(newState.doc); },
    },

    props: {
      decorations(state) { return this.getState(state); },
    },

    view(editorView) {
      function onMapChange() {
        onThreadsChange(buildThreads(editorView));
      }
      commentsMap.observe(onMapChange);
      return { destroy() { commentsMap.unobserve(onMapChange); } };
    },
  });
}
