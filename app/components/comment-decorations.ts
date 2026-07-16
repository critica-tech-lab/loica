import {
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

// ─── Types ────────────────────────────────────────────────

export interface ResolvedThread {
  id: string;
  from: number;
  to: number;
  anchorText: string | null;
  resolved: boolean;
  userId: string;
  userName: string;
  body: string;
  createdAt: number;
  replies: Array<{
    id: string;
    userId: string;
    userName: string;
    body: string;
    createdAt: number;
    updatedAt: number;
  }>;
  /** Pixel y-position relative to editor top (for sidebar alignment) */
  top: number;
  /** Whether the anchor text has been deleted from the document */
  anchorDeleted: boolean;
}

// ─── State ────────────────────────────────────────────────

const setThreadsEffect = StateEffect.define<ResolvedThread[]>();

export const threadsField = StateField.define<ResolvedThread[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setThreadsEffect)) return e.value;
    }
    return value;
  },
});

export function dispatchThreads(view: EditorView, threads: ResolvedThread[]) {
  try {
    view.dispatch({ effects: setThreadsEffect.of(threads) });
  } catch (e) {
    // Swallow HeightMap/viewport errors during Yjs sync to prevent editor crash
    console.warn("[comment-decorations] dispatch failed:", e);
  }
}

export function getThreads(view: EditorView): ResolvedThread[] {
  return view.state.field(threadsField, false) ?? [];
}

// ─── Helpers ──────────────────────────────────────────────

export function authorColorFromName(name: string | null): string {
  if (!name) return "#facc15"; // default yellow for legacy comments // allow-hex: legacy comment default
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 65%)`; // allow-hex: per-user comment hue
}

// ─── Decorations ──────────────────────────────────────────

const decoCache = new Map<string, Decoration>();

function getDecoForThread(userName: string): Decoration {
  const color = authorColorFromName(userName);
  let deco = decoCache.get(color);
  if (!deco) {
    deco = Decoration.mark({
      class: "cm-thread-highlight",
      attributes: {
        style: `background: color-mix(in srgb, ${color} 22%, transparent); --comment-color: ${color}`,
      },
    });
    decoCache.set(color, deco);
  }
  return deco;
}

function buildDecorations(threads: ResolvedThread[]): DecorationSet {
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];

  for (const thread of threads) {
    if (thread.resolved || thread.anchorDeleted || thread.from >= thread.to) continue;
    ranges.push({
      from: thread.from,
      to: thread.to,
      deco: getDecoForThread(thread.userName),
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
}

// ─── Click handler ────────────────────────────────────────

function threadClickHandler(onClick?: (thread: ResolvedThread) => void) {
  return EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      if (!onClick) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const threads = view.state.field(threadsField, false) ?? [];
      for (const thread of threads) {
        if (!thread.resolved && !thread.anchorDeleted && pos >= thread.from && pos <= thread.to) {
          onClick(thread);
          return false;
        }
      }
      return false;
    },
  });
}

// ─── Extension ────────────────────────────────────────────

const threadDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setThreadsEffect)) {
        return buildDecorations(e.value);
      }
    }
    if (tr.docChanged) {
      return decos.map(tr.changes);
    }
    return decos;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export function commentDecoExtension(
  onThreadClick?: (thread: ResolvedThread) => void,
): Extension {
  return [threadsField, threadDecoField, threadClickHandler(onThreadClick)];
}
