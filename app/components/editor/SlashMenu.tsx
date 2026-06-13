import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { filterSlashItems, type SlashItem } from "./slash-menu";

const W = 248;
const MAX_H = 320;
const GAP = 6;

interface Props {
  query: string;
  // caret coords (viewport): the "/" is at (x, top..bottom)
  x: number;
  top: number;
  bottom: number;
  // The editor's handleKeyDown calls these while the menu is open, so the nav
  // keys never reach ProseMirror (no stray caret movement).
  navRef: React.MutableRefObject<{ move: (d: number) => void; execute: () => void; close: () => void } | null>;
  onExecute: (item: SlashItem) => void;
  onClose: () => void;
}

// Popup list driven by the slash plugin's { query }. Navigation is handled by the
// editor (via navRef) so it can consume the keys before PM; typing letters falls
// through to keep refining the query.
export function SlashMenu({ query, x, top, bottom, navRef, onExecute, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = filterSlashItems(query);
  const [sel, setSel] = useState(0);

  // Reset / clamp the highlighted row whenever the filtered set changes.
  useLayoutEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);

  // Register nav handlers for the editor's handleKeyDown. Re-runs each render so
  // the closures see the current items/sel; cleared on unmount.
  useLayoutEffect(() => {
    // No visible menu → don't capture keys; let them reach the editor.
    if (!items.length) { navRef.current = null; return; }
    navRef.current = {
      move: (d) => setSel((s) => (s + d + items.length) % items.length),
      execute: () => { if (items[sel]) onExecute(items[sel]); },
      close: onClose,
    };
    return () => { navRef.current = null; };
  });

  // Keep the active row in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // Dismiss on click outside the popup (clicks on items run their own handler).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  if (!items.length) return null;

  // Prefer below the caret; flip above if it would overflow the viewport.
  const left = Math.min(x, window.innerWidth - W - GAP);
  const below = bottom + GAP;
  const openUp = below + MAX_H > window.innerHeight && top - GAP - MAX_H > 0;
  const style: React.CSSProperties = openUp
    ? { bottom: window.innerHeight - top + GAP, left }
    : { top: below, left };

  return (
    <div
      ref={ref}
      role="listbox"
      style={{
        position: "fixed", ...style, width: W, zIndex: 500,
        display: "flex", flexDirection: "column",
        maxHeight: MAX_H,
        background: "var(--bg)",
        border: "1.5px solid var(--fg)",
        boxShadow: "4px 4px 0 color-mix(in srgb, var(--fg) 18%, transparent)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {items.map((it, i) => {
          const newGroup = i === 0 || items[i - 1].group !== it.group;
          const selected = i === sel;
          return (
            <div key={it.title}>
              {newGroup && (
                <div style={{
                  padding: "6px 10px 3px", fontSize: "0.58rem", fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                  color: "color-mix(in srgb, var(--fg) 40%, transparent)",
                }}>
                  {it.group}
                </div>
              )}
              <button
                data-i={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => { e.preventDefault(); onExecute(it); }}
                style={{
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  width: "100%", textAlign: "left",
                  padding: "0.32rem 0.5rem 0.32rem 0.45rem",
                  border: "none", cursor: "pointer",
                  borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
                  background: selected ? "color-mix(in srgb, var(--accent) 9%, transparent)" : "transparent",
                  color: "var(--fg)",
                }}
              >
                <span style={{
                  flexShrink: 0,
                  width: 26, height: 26,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: it.icon.length > 1 ? "0.62rem" : "0.85rem",
                  fontWeight: 600,
                  color: it.iconColor ?? "var(--fg)",
                  border: `1px solid ${it.iconColor
                    ? `color-mix(in srgb, ${it.iconColor} 55%, transparent)`
                    : "color-mix(in srgb, var(--fg) 22%, transparent)"}`,
                  background: selected ? "var(--bg)" : "transparent",
                }}>
                  {it.icon}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, lineHeight: 1.25 }}>{it.title}</span>
                  <span style={{ fontSize: "0.66rem", opacity: 0.5, lineHeight: 1.2 }}>{it.hint}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{
        flexShrink: 0,
        borderTop: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
        padding: "4px 8px",
        display: "flex", gap: "0.7rem",
        fontFamily: "var(--font-mono)", fontSize: "0.58rem",
        color: "color-mix(in srgb, var(--fg) 45%, transparent)",
      }}>
        <span>↑↓ move</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </div>
  );
}
