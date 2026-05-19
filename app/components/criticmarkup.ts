import {
  StateField,
  StateEffect,
  type Extension,
  type EditorState,
} from "@codemirror/state";
import {
  ViewPlugin,
  Decoration,
  WidgetType,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// ─── Types ────────────────────────────────────────────────

export interface SuggestionEntry {
  id: string;
  kind: "addition" | "deletion" | "substitution";
  fullFrom: number;
  fullTo: number;
  author: string | null;
  top: number;
  addedText?: string;
  deletedText?: string;
  oldText?: string;
  newText?: string;
}

// ─── Parser ───────────────────────────────────────────────

// Combined: {==highlighted text==}{>>comment text<<}
const HIGHLIGHT_COMMENT_RE = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;
// Standalone comment (no highlight wrapper): {>>comment text<<}
const STANDALONE_COMMENT_RE = /\{>>([\s\S]*?)<<\}/g;
// Standalone highlight (decorations only, no sidebar entry): {==text==}
const STANDALONE_HIGHLIGHT_RE = /\{==([\s\S]*?)==\}/g;
// Substitution: {~~old~>new~~}
const SUBSTITUTION_RE = /\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g;
// Addition: {++text++}
const ADDITION_RE = /\{\+\+([\s\S]*?)\+\+\}/g;
// Deletion: {--text--}
const DELETION_RE = /\{--([\s\S]*?)--\}/g;

interface ParsedHighlightComment {
  kind: "highlight-comment";
  fullFrom: number;
  fullTo: number;
  hlFrom: number;
  hlTo: number;
  hlText: string;
  cmFrom: number;
  cmTo: number;
  cmText: string;
}

interface ParsedStandaloneComment {
  kind: "standalone-comment";
  fullFrom: number;
  fullTo: number;
  cmFrom: number;
  cmTo: number;
  cmText: string;
}

interface ParsedStandaloneHighlight {
  kind: "standalone-highlight";
  fullFrom: number;
  fullTo: number;
  hlFrom: number;
  hlTo: number;
  hlText: string;
}

interface ParsedAddition {
  kind: "addition";
  fullFrom: number;
  fullTo: number;
  textFrom: number;
  textTo: number;
  text: string;
  author: string | null;
  prefixLength: number;
}

interface ParsedDeletion {
  kind: "deletion";
  fullFrom: number;
  fullTo: number;
  textFrom: number;
  textTo: number;
  text: string;
  author: string | null;
  prefixLength: number;
}

interface ParsedSubstitution {
  kind: "substitution";
  fullFrom: number;
  fullTo: number;
  oldFrom: number;
  oldTo: number;
  oldText: string;
  newFrom: number;
  newTo: number;
  newText: string;
  author: string | null;
  prefixLength: number;
}

type ParsedItem =
  | ParsedHighlightComment
  | ParsedStandaloneComment
  | ParsedStandaloneHighlight
  | ParsedAddition
  | ParsedDeletion
  | ParsedSubstitution;

const AUTHOR_PREFIX_RE = /^@([^:]+):/;

/** Parse @author: prefix from comment text, returning author and adjusted text/offset */
function parseAuthorPrefix(cmText: string): { author: string | null; textWithoutPrefix: string; prefixLength: number } {
  const m = AUTHOR_PREFIX_RE.exec(cmText);
  if (m) {
    return { author: m[1], textWithoutPrefix: cmText.slice(m[0].length), prefixLength: m[0].length };
  }
  return { author: null, textWithoutPrefix: cmText, prefixLength: 0 };
}

/** Stable HSL hue from a name string (deterministic hash → 0-360) */
export function authorColorFromName(name: string | null): string {
  if (!name) return "#facc15"; // default yellow for legacy comments
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

function parseAll(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const used = new Set<string>();

  // 1) Combined highlight+comment
  HIGHLIGHT_COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HIGHLIGHT_COMMENT_RE.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    // {== = 3 chars, ==}{>> = 5 chars, <<} = 3 chars
    const hlFrom = fullFrom + 3;
    const hlTo = hlFrom + m[1].length;
    const cmFrom = hlTo + 6; // ==}{>> is 6 chars: = = } { > >
    const cmTo = cmFrom + m[2].length;
    items.push({
      kind: "highlight-comment",
      fullFrom,
      fullTo,
      hlFrom,
      hlTo,
      hlText: m[1],
      cmFrom,
      cmTo,
      cmText: m[2],
    });
    // Mark this range as used so standalone patterns skip it
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  // 2) Standalone comments
  STANDALONE_COMMENT_RE.lastIndex = 0;
  while ((m = STANDALONE_COMMENT_RE.exec(text)) !== null) {
    if (used.has(`${m.index}`)) continue;
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    const cmFrom = fullFrom + 3; // {>> = 3 chars
    const cmTo = cmFrom + m[1].length;
    items.push({
      kind: "standalone-comment",
      fullFrom,
      fullTo,
      cmFrom,
      cmTo,
      cmText: m[1],
    });
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  // 3) Standalone highlights (decorations only)
  STANDALONE_HIGHLIGHT_RE.lastIndex = 0;
  while ((m = STANDALONE_HIGHLIGHT_RE.exec(text)) !== null) {
    if (used.has(`${m.index}`)) continue;
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    const hlFrom = fullFrom + 3; // {== = 3 chars
    const hlTo = hlFrom + m[1].length;
    items.push({
      kind: "standalone-highlight",
      fullFrom,
      fullTo,
      hlFrom,
      hlTo,
      hlText: m[1],
    });
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  // 4) Substitutions (parse before additions/deletions since they contain ~>)
  SUBSTITUTION_RE.lastIndex = 0;
  while ((m = SUBSTITUTION_RE.exec(text)) !== null) {
    if (used.has(`${m.index}`)) continue;
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    const rawOld = m[1];
    const rawNew = m[2];
    const { author, prefixLength } = parseAuthorPrefix(rawOld);
    // {~~ = 3 chars
    const oldFrom = fullFrom + 3 + prefixLength;
    const oldTo = fullFrom + 3 + rawOld.length;
    // ~> = 2 chars
    const newFrom = oldTo + 2;
    const newTo = newFrom + rawNew.length;
    items.push({
      kind: "substitution",
      fullFrom,
      fullTo,
      oldFrom,
      oldTo,
      oldText: rawOld.slice(prefixLength),
      newFrom,
      newTo,
      newText: rawNew,
      author,
      prefixLength,
    });
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  // 5) Additions
  ADDITION_RE.lastIndex = 0;
  while ((m = ADDITION_RE.exec(text)) !== null) {
    if (used.has(`${m.index}`)) continue;
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    const raw = m[1];
    const { author, textWithoutPrefix, prefixLength } = parseAuthorPrefix(raw);
    // {++ = 3 chars
    const textFrom = fullFrom + 3 + prefixLength;
    const textTo = fullFrom + 3 + raw.length;
    items.push({
      kind: "addition",
      fullFrom,
      fullTo,
      textFrom,
      textTo,
      text: textWithoutPrefix,
      author,
      prefixLength,
    });
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  // 6) Deletions
  DELETION_RE.lastIndex = 0;
  while ((m = DELETION_RE.exec(text)) !== null) {
    if (used.has(`${m.index}`)) continue;
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    const raw = m[1];
    const { author, textWithoutPrefix, prefixLength } = parseAuthorPrefix(raw);
    // {-- = 3 chars
    const textFrom = fullFrom + 3 + prefixLength;
    const textTo = fullFrom + 3 + raw.length;
    items.push({
      kind: "deletion",
      fullFrom,
      fullTo,
      textFrom,
      textTo,
      text: textWithoutPrefix,
      author,
      prefixLength,
    });
    for (let i = fullFrom; i < fullTo; i++) used.add(`${i}`);
  }

  items.sort((a, b) => a.fullFrom - b.fullFrom);
  return items;
}

// ─── State ────────────────────────────────────────────────

const setSuggestionsEffect = StateEffect.define<SuggestionEntry[]>();

export const suggestionsField = StateField.define<SuggestionEntry[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestionsEffect)) return e.value;
    }
    return value;
  },
});

// ─── Widget for standalone comments ───────────────────────

class CommentIndicatorWidget extends WidgetType {
  constructor(private color: string) { super(); }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-comment-indicator";
    span.textContent = "\u{1F4AC}"; // speech balloon
    span.style.filter = this.color !== "#facc15"
      ? `drop-shadow(0 0 2px ${this.color})`
      : "";
    return span;
  }
  eq(other: CommentIndicatorWidget) { return this.color === other.color; }
  ignoreEvent() {
    return false;
  }
}

// ─── Decorations ──────────────────────────────────────────

// inclusiveStart/End control which side of the replace deco "absorbs" the cursor.
// This prevents the cursor from landing at a boundary and breaking the decoration.
// hiddenBefore: hides {== (cursor can't enter from the left)
const hiddenBefore = Decoration.replace({ inclusiveStart: true, inclusiveEnd: false });
// hiddenAfter: hides ==}{>>...<<} (cursor can't enter from the right)
const hiddenAfter = Decoration.replace({ inclusiveStart: false, inclusiveEnd: true });

/** Cache per-author highlight decorations to avoid recreating on every parse */
const highlightDecoCache = new Map<string, Decoration>();
function highlightDecoForColor(color: string, hasComment: boolean): Decoration {
  const key = `${color}:${hasComment ? "c" : "p"}`;
  let deco = highlightDecoCache.get(key);
  if (!deco) {
    const cls = hasComment ? "cm-critic-highlight cm-critic-commented" : "cm-critic-highlight";
    deco = Decoration.mark({
      class: cls,
      attributes: { style: `background: color-mix(in srgb, ${color} 22%, transparent); --comment-color: ${color}` },
    });
    highlightDecoCache.set(key, deco);
  }
  return deco;
}

const additionMark = Decoration.mark({ class: "cm-critic-addition" });
const deletionMark = Decoration.mark({ class: "cm-critic-deletion" });
const subOldMark = Decoration.mark({ class: "cm-critic-sub-old" });
const subNewMark = Decoration.mark({ class: "cm-critic-sub-new" });

function buildDecorations(items: ParsedItem[]): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  for (const item of items) {
    if (item.kind === "highlight-comment") {
      const { author } = parseAuthorPrefix(item.cmText);
      const color = authorColorFromName(author);
      // {== → hidden (inclusive on the left so cursor can't slip in from before)
      ranges.push({ from: item.fullFrom, to: item.fullFrom + 3, deco: hiddenBefore });
      // highlighted text → per-author colored highlight with dashed underline
      if (item.hlFrom < item.hlTo) {
        ranges.push({ from: item.hlFrom, to: item.hlTo, deco: highlightDecoForColor(color, true) });
      }
      // ==}{>>comment<<} → hidden (inclusive on the right so cursor can't slip in from after)
      ranges.push({ from: item.hlTo, to: item.fullTo, deco: hiddenAfter });
    } else if (item.kind === "standalone-comment") {
      const { author } = parseAuthorPrefix(item.cmText);
      const color = authorColorFromName(author);
      // Entire {>>comment<<} → replaced with tinted comment indicator widget
      const indicatorDeco = Decoration.replace({
        widget: new CommentIndicatorWidget(color),
        inclusive: true,
      });
      ranges.push({ from: item.fullFrom, to: item.fullTo, deco: indicatorDeco });
    } else if (item.kind === "standalone-highlight") {
      // standalone-highlight (no comment, no author — use default yellow)
      // {== → hidden (inclusive left)
      ranges.push({ from: item.fullFrom, to: item.fullFrom + 3, deco: hiddenBefore });
      // highlighted text
      if (item.hlFrom < item.hlTo) {
        ranges.push({ from: item.hlFrom, to: item.hlTo, deco: highlightDecoForColor("#facc15", false) });
      }
      // ==} → hidden (inclusive right)
      ranges.push({ from: item.fullTo - 3, to: item.fullTo, deco: hiddenAfter });
    } else if (item.kind === "addition") {
      // Hide {++ and author prefix
      const hideStart = item.fullFrom;
      const hideEnd = item.fullFrom + 3 + item.prefixLength; // {++ + @author:
      if (hideStart < hideEnd) {
        ranges.push({ from: hideStart, to: hideEnd, deco: hiddenBefore });
      }
      // Mark the added text green
      if (item.textFrom < item.textTo) {
        ranges.push({ from: item.textFrom, to: item.textTo, deco: additionMark });
      }
      // Hide ++}
      ranges.push({ from: item.fullTo - 3, to: item.fullTo, deco: hiddenAfter });
    } else if (item.kind === "deletion") {
      // Hide {-- and author prefix
      const hideStart = item.fullFrom;
      const hideEnd = item.fullFrom + 3 + item.prefixLength;
      if (hideStart < hideEnd) {
        ranges.push({ from: hideStart, to: hideEnd, deco: hiddenBefore });
      }
      // Mark the deleted text red strikethrough
      if (item.textFrom < item.textTo) {
        ranges.push({ from: item.textFrom, to: item.textTo, deco: deletionMark });
      }
      // Hide --}
      ranges.push({ from: item.fullTo - 3, to: item.fullTo, deco: hiddenAfter });
    } else if (item.kind === "substitution") {
      // Hide {~~ and author prefix
      const hideStart = item.fullFrom;
      const hideEnd = item.fullFrom + 3 + item.prefixLength;
      if (hideStart < hideEnd) {
        ranges.push({ from: hideStart, to: hideEnd, deco: hiddenBefore });
      }
      // Mark old text red strikethrough
      if (item.oldFrom < item.oldTo) {
        ranges.push({ from: item.oldFrom, to: item.oldTo, deco: subOldMark });
      }
      // Hide ~>
      ranges.push({ from: item.oldTo, to: item.oldTo + 2, deco: Decoration.replace({}) });
      // Mark new text green
      if (item.newFrom < item.newTo) {
        ranges.push({ from: item.newFrom, to: item.newTo, deco: subNewMark });
      }
      // Hide ~~}
      ranges.push({ from: item.fullTo - 3, to: item.fullTo, deco: hiddenAfter });
    }
  }

  // Sort by from position (required by RangeSet)
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
}

// ─── ViewPlugin ───────────────────────────────────────────
// NOTE: Replace/widget decorations CANNOT use the `decorations` accessor
// on ViewPlugin — CodeMirror silently ignores them. They must be provided
// via the `EditorView.decorations` facet using the `provide` option.

const criticPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      const items = parseAll(view.state.doc.toString());
      this.decorations = buildDecorations(items);
      this.dispatchEntries(view, items);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        const items = parseAll(update.state.doc.toString());
        this.decorations = buildDecorations(items);
        if (update.docChanged) {
          this.dispatchEntries(update.view, items);
        }
      }
    }

    private dispatchEntries(view: EditorView, items: ParsedItem[]) {
      const raw: SuggestionEntry[] = [];

      for (const item of items) {
        if (item.kind === "standalone-highlight" || item.kind === "highlight-comment" || item.kind === "standalone-comment") continue;

        let top = 0;
        try {
          let pos: number;
          if (item.kind === "addition") pos = item.textFrom;
          else if (item.kind === "deletion") pos = item.textFrom;
          else pos = item.oldFrom; // substitution
          const coords = view.coordsAtPos(Math.min(pos, view.state.doc.length));
          if (coords) {
            const editorRect = view.dom.getBoundingClientRect();
            top = coords.top - editorRect.top + view.dom.scrollTop;
          }
        } catch {
          // coordsAtPos can throw for positions not in viewport
        }

        if (item.kind === "addition") {
          raw.push({
            id: `sg-${item.fullFrom}`,
            kind: "addition",
            fullFrom: item.fullFrom,
            fullTo: item.fullTo,
            author: item.author,
            top,
            addedText: item.text,
          });
        } else if (item.kind === "deletion") {
          raw.push({
            id: `sg-${item.fullFrom}`,
            kind: "deletion",
            fullFrom: item.fullFrom,
            fullTo: item.fullTo,
            author: item.author,
            top,
            deletedText: item.text,
          });
        } else if (item.kind === "substitution") {
          raw.push({
            id: `sg-${item.fullFrom}`,
            kind: "substitution",
            fullFrom: item.fullFrom,
            fullTo: item.fullTo,
            author: item.author,
            top,
            oldText: item.oldText,
            newText: item.newText,
          });
        }
      }

      const suggestions = mergeSuggestions(raw);

      // Use requestAnimationFrame to avoid dispatching during an update
      requestAnimationFrame(() => {
        if (view.dom.isConnected) {
          view.dispatch({
            effects: [
              setSuggestionsEffect.of(suggestions),
            ],
          });
        }
      });
    }
  },
  {
    // Use `provide` to expose decorations via EditorView.decorations facet.
    // This is required for Decoration.replace() and widget decorations to work.
    provide(plugin) {
      return EditorView.decorations.of((view) => {
        return view.plugin(plugin)?.decorations ?? Decoration.none;
      });
    },
  }
);

// ─── Click handler ────────────────────────────────────────

function clickHandler(
  _onCommentClick?: unknown,
  onSuggestionClick?: (entry: SuggestionEntry) => void,
) {
  return EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      if (!onSuggestionClick) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const suggestions = parseSuggestionsFromDoc(view.state.doc.toString(), view);
      for (const entry of suggestions) {
        if (pos >= entry.fullFrom && pos <= entry.fullTo) {
          onSuggestionClick(entry);
          return false;
        }
      }

      return false;
    },
  });
}

// ─── Public API ───────────────────────────────────────────

export function criticMarkupExtension(
  _onCommentClick?: unknown,
  onSuggestionClick?: (entry: SuggestionEntry) => void,
): Extension {
  return [suggestionsField, criticPlugin, clickHandler(undefined, onSuggestionClick)];
}

export function getSuggestions(state: EditorState): SuggestionEntry[] {
  return state.field(suggestionsField);
}

/**
 * Merge consecutive addition blocks by the same author into single
 * suggestions.  Per-keystroke wrapping can produce
 * {++@A:h++}{++@A:e++}{++@A:l++}...  which should be treated as one
 * "hel..." suggestion for display, accept, and reject.
 */
export function mergeSuggestions(entries: SuggestionEntry[]): SuggestionEntry[] {
  const merged: SuggestionEntry[] = [];
  for (const entry of entries) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (
      prev &&
      prev.kind === "addition" &&
      entry.kind === "addition" &&
      prev.author === entry.author &&
      prev.fullTo === entry.fullFrom
    ) {
      prev.fullTo = entry.fullTo;
      prev.addedText = (prev.addedText ?? "") + (entry.addedText ?? "");
    } else {
      // Clone to avoid mutating the original when merging later entries
      merged.push({ ...entry });
    }
  }
  return merged;
}

/**
 * Parse suggestions directly from document text.
 * Returns un-merged entries (each {++...++} block is separate).
 */
export function parseSuggestionsFromDoc(
  doc: string,
  view?: EditorView
): SuggestionEntry[] {
  const items = parseAll(doc);
  const suggestions: SuggestionEntry[] = [];
  for (const item of items) {
    if (item.kind !== "addition" && item.kind !== "deletion" && item.kind !== "substitution") continue;

    let top = 0;
    if (view) {
      try {
        let pos: number;
        if (item.kind === "addition") pos = item.textFrom;
        else if (item.kind === "deletion") pos = item.textFrom;
        else pos = item.oldFrom;
        const coords = view.coordsAtPos(Math.min(pos, view.state.doc.length));
        if (coords) {
          const editorRect = view.dom.getBoundingClientRect();
          top = coords.top - editorRect.top + view.dom.scrollTop;
        }
      } catch {}
    }

    if (item.kind === "addition") {
      suggestions.push({
        id: `sg-${item.fullFrom}`,
        kind: "addition",
        fullFrom: item.fullFrom,
        fullTo: item.fullTo,
        author: item.author,
        top,
        addedText: item.text,
      });
    } else if (item.kind === "deletion") {
      suggestions.push({
        id: `sg-${item.fullFrom}`,
        kind: "deletion",
        fullFrom: item.fullFrom,
        fullTo: item.fullTo,
        author: item.author,
        top,
        deletedText: item.text,
      });
    } else {
      suggestions.push({
        id: `sg-${item.fullFrom}`,
        kind: "substitution",
        fullFrom: item.fullFrom,
        fullTo: item.fullTo,
        author: item.author,
        top,
        oldText: item.oldText,
        newText: item.newText,
      });
    }
  }
  return suggestions;
}
