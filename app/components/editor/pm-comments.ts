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
  ydoc: Y.Doc,
  yXmlFragment: Y.XmlFragment,
  commentsMap: Y.Map<any>,
  onThreadsChange: (threads: ResolvedThread[]) => void,
  helpers: {
    ySyncPluginKey: { getState: (state: any) => any };
    relativePositionToAbsolutePosition: (
      y: Y.Doc,
      documentType: Y.XmlFragment,
      relPos: Y.RelativePosition,
      mapping: any,
    ) => number | null;
  },
) {
  const { ySyncPluginKey, relativePositionToAbsolutePosition } = helpers;

  // Resolve a stored anchor to a current PM offset. New comments store a Yjs
  // relative position (JSON); legacy comments stored a raw integer offset —
  // honour both. Returns null when the anchor can't be located (e.g. its text
  // was deleted), so the caller skips the highlight instead of pointing at the
  // wrong spot.
  function resolveAnchor(anchor: any, state: any): number | null {
    if (anchor == null) return null;
    if (typeof anchor === "number") return anchor; // legacy absolute offset
    try {
      const relPos = Y.createRelativePositionFromJSON(anchor);
      const mapping = ySyncPluginKey.getState(state)?.binding?.mapping;
      if (!mapping) return null;
      const abs = relativePositionToAbsolutePosition(ydoc, yXmlFragment, relPos, mapping);
      return typeof abs === "number" ? abs : null;
    } catch {
      return null;
    }
  }

  function buildDecorations(state: any): DecorationSet {
    const doc = state.doc;
    const decos: Decoration[] = [];
    const docSize: number = doc.content.size;
    if (docSize === 0) return DecorationSet.empty;

    const indicatorPositions = new Set<number>();

    commentsMap.forEach((entry: any, id: string) => {
      if (entry.threadId != null) return;
      if (entry.resolved) return;
      const from = resolveAnchor(entry.anchorFrom, state) ?? 0;
      const to   = resolveAnchor(entry.anchorTo, state) ?? 0;
      if (from > 0 && to > from && to <= docSize) {
        try {
          // Legacy anchors are raw offsets that don't track edits, so guard them
          // against pointing at the wrong text (a stale offset would otherwise
          // highlight whatever now sits there). Relative anchors track the text
          // by construction, so they need no such check.
          if (typeof entry.anchorFrom === "number" && entry.anchorText) {
            if (doc.textBetween(from, to, " ") !== entry.anchorText) return;
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
      const from = resolveAnchor(entry.anchorFrom, editorView.state) ?? 0;
      const to   = resolveAnchor(entry.anchorTo, editorView.state) ?? 0;
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
      init(_, state) { return buildDecorations(state); },
      apply(tr, old, _prevState, newState) {
        // Rebuild from Yjs relative positions ONLY when the comment set changed
        // (add/remove/resolve/remote), flagged via plugin meta. On a plain text
        // edit we must NOT re-resolve here: y-prosemirror writes the local edit
        // into Yjs in its view.update() — AFTER this apply runs — so mid-edit the
        // Yjs mapping is one step stale and relative→absolute would resolve to
        // the pre-edit offset, painting the highlight a character off. Instead we
        // map the existing decorations through the transaction (PM-native, exact,
        // and with non-inclusive edges so a char typed at a boundary isn't
        // swallowed into the highlight).
        if (tr.getMeta(pmCommentPluginKey)?.rebuild) return buildDecorations(newState);
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },

    props: {
      decorations(state) { return this.getState(state); },
    },

    view(editorView) {
      // Defer the rebuild: the comments-map observer can fire synchronously from
      // inside a Yjs/PM transaction (local addComment, remote sync), and
      // dispatching there would throw. A microtask lands it after the current
      // dispatch settles; until then the mapped decorations are already correct.
      let scheduled = false;
      function scheduleRebuild() {
        if (scheduled) return;
        scheduled = true;
        Promise.resolve().then(() => {
          scheduled = false;
          try {
            editorView.dispatch(editorView.state.tr.setMeta(pmCommentPluginKey, { rebuild: true }));
          } catch { /* view torn down mid-flush */ }
        });
      }
      function onMapChange() {
        scheduleRebuild();
        onThreadsChange(buildThreads(editorView));
      }
      commentsMap.observe(onMapChange);
      // First paint: the binding mapping may not be ready at init(), so resolve
      // once it settles (and surface any comments already present on mount).
      scheduleRebuild();
      onThreadsChange(buildThreads(editorView));
      return { destroy() { commentsMap.unobserve(onMapChange); } };
    },
  });
}
