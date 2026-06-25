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
  onExecute: (item: SlashItem) => void;
  onClose: () => void;
}

// Popup list driven by the slash plugin's { query }. Navigation keys are caught
// in the capture phase so they don't also reach ProseMirror; letter keys fall
// through so typing keeps refining the query.
export function SlashMenu({ query, x, top, bottom, onExecute, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = filterSlashItems(query);
  const [sel, setSel] = useState(0);

  // Reset / clamp the highlighted row whenever the filtered set changes.
  useLayoutEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!items.length) return;
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); e.stopPropagation(); setSel((s) => (s + 1) % items.length); break;
        case "ArrowUp":   e.preventDefault(); e.stopPropagation(); setSel((s) => (s - 1 + items.length) % items.length); break;
        case "Enter":     e.preventDefault(); e.stopPropagation(); onExecute(items[sel]); break;
        case "Tab":       e.preventDefault(); e.stopPropagation(); onExecute(items[sel]); break;
        case "Escape":    e.preventDefault(); e.stopPropagation(); onClose(); break;
      }
    };
    // capture so we win over the editor's keymap
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items, sel, onExecute, onClose]);

  // Keep the active row in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

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
        position: "fixed", ...style, width: W, maxHeight: MAX_H, overflowY: "auto", zIndex: 500,
        background: "var(--bg)",
        border: "1.5px solid var(--fg)",
        boxShadow: "4px 4px 0 color-mix(in srgb, var(--fg) 18%, transparent)",
        fontFamily: "var(--font-ui)",
        padding: "4px 0",
      }}
    >
      {items.map((it, i) => (
        <button
          key={it.title}
          data-i={i}
          role="option"
          aria-selected={i === sel}
          onMouseEnter={() => setSel(i)}
          onMouseDown={(e) => { e.preventDefault(); onExecute(it); }}
          style={{
            display: "flex", flexDirection: "column", gap: 1,
            width: "100%", textAlign: "left",
            padding: "0.4rem 0.7rem",
            border: "none", cursor: "pointer",
            background: i === sel ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
            color: "var(--fg)",
          }}
        >
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{it.title}</span>
          <span style={{ fontSize: "0.68rem", opacity: 0.5 }}>{it.hint}</span>
        </button>
      ))}
    </div>
  );
}
