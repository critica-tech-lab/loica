import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { ResolvedThread } from "~/components/comment-decorations";
import * as Y from "yjs";

export const pmCommentPluginKey = new PluginKey<DecorationSet>("pm-comments");

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

function makeIndicator(commentId: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "pm-comment-indicator";
  el.setAttribute("data-comment-id", commentId);
  el.title = "View comment";
  el.innerHTML = ICON_SVG;
  return el;
}

// Find the widget insertion position for a comment anchor.
// - Inside a table cell → end of the table row's first cell paragraph (so icon
//   appears at the right of the row, consistently)
// - Otherwise → end of the direct parent block (paragraph, heading, etc.)
// Returns { indicatorPos, nodeFrom, nodeTo } for the node decoration too.
function findBlockInfo(doc: any, from: number): { indicatorPos: number; nodeFrom: number; nodeTo: number } | null {
  try {
    const $pos = doc.resolve(from);
    // Walk up looking for a table node first
    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      if (node.type.name === "table") {
        // Put indicator at the end of the first row
        const tableStart = $pos.before(d);
        const tableEnd = tableStart + node.nodeSize;
        // Find first row end to place widget — use $pos.end(d) which is end of table content
        const rowEnd = $pos.end(d + 1 > $pos.depth ? d : d + 1);
        return { indicatorPos: $pos.end(d), nodeFrom: tableStart, nodeTo: tableEnd };
      }
    }
    // Regular block — find innermost block that is a direct child of doc or blockquote
    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      if (node.isBlock && (node.type.name === "paragraph" || node.type.name === "heading" || node.type.name === "list_item" || node.type.name === "blockquote")) {
        const nodeFrom = $pos.before(d);
        const nodeTo = nodeFrom + node.nodeSize;
        const indicatorPos = $pos.end(d);
        return { indicatorPos, nodeFrom, nodeTo };
      }
    }
    // Fallback: use depth 1
    const nodeFrom = $pos.before(1);
    const nodeTo = nodeFrom + $pos.node(1).nodeSize;
    return { indicatorPos: $pos.end(1), nodeFrom, nodeTo };
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
