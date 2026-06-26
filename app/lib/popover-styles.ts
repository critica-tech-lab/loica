import type { CSSProperties } from "react";

// The Loica doc-surface popover idiom: cream fill, hard plumage border, and a
// flat offset shadow with sharp corners — the "minimal Lisa" surface, modelled
// on the footnote tooltip. Shared by every editor-anchored popup (comment, link,
// table, track-change, slash menu) so the look can't drift. Spread it first,
// then layer position / size / typography on top.
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

// Minimal-Lisa control: square corners, solid border, monochrome fill. The
// primary variant inverts (plumage fill, cream text); the default is outlined.
// One definition for every popover button (comment Reply/Resolve, track-change
// Accept/Reject, …) so button language matches the surface they sit on.
export function lisaButton(primary = false): CSSProperties {
  return {
    padding: "3px 10px",
    border: primary ? "1px solid var(--fg)" : "1px solid color-mix(in srgb, var(--fg) 30%, transparent)",
    borderRadius: 0,
    fontSize: "var(--fs-xs)",
    fontWeight: 600,
    cursor: "pointer",
    background: primary ? "var(--fg)" : "transparent",
    color: primary ? "var(--bg)" : "var(--fg)",
    fontFamily: "var(--font-ui)",
    letterSpacing: "0.02em",
  };
}

// Minimal-Lisa text field: borderless except a solid plumage underline, square,
// transparent fill. Matches the popover surface's monochrome, no-radius idiom.
export const lisaInput: CSSProperties = {
  width: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  borderBottom: "1.5px solid var(--fg)",
  padding: "2px 0",
  fontSize: "var(--fs-base)",
  fontFamily: "var(--font-ui)",
  background: "transparent",
  color: "var(--fg)",
  lineHeight: 1.5,
  boxSizing: "border-box",
};
