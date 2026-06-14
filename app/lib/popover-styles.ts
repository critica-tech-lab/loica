import type { CSSProperties } from "react";

// The Loica doc-surface popover idiom: cream fill, hard plumage border, and a
// flat offset shadow with sharp corners. Shared by every editor-anchored popup
// (comment, link, table, track-change, slash menu) so the look can't drift.
// Spread it first, then layer position / size / typography on top.
export const popoverSurface: CSSProperties = {
  background: "var(--bg)",
  border: "1.5px solid var(--fg)",
  boxShadow: "4px 4px 0 color-mix(in srgb, var(--fg) 18%, transparent)",
};

// Highlighted row in a keyboard-navigable menu/list (slash menu, version
// history, @mention + user pickers): a scarlet left-bar plus a faint accent
// tint. Pair with `paddingLeft: "calc(<pad> - 2px)"` so the bar doesn't shift
// the row text. Keeps every navigable list's selection cue identical.
export function menuItemHighlight(active: boolean): CSSProperties {
  return {
    background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
  };
}
