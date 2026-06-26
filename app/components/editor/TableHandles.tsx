import { useEffect, useRef, useState } from "react";
import { TextSelection } from "prosemirror-state";
import {
  addColumnBefore, addColumnAfter, deleteColumn,
  addRowBefore, addRowAfter, deleteRow,
  deleteTable, toggleHeaderRow, toggleHeaderColumn,
} from "prosemirror-tables";
import { popoverSurface } from "~/lib/popover-styles";

// Notion/Docs-style table editing affordances. When the caret sits inside a
// table we overlay clickable grips along its top (one per column) and left
// (one per row). Clicking a grip opens a small action popover — insert
// before/after, toggle header, delete — so the full table command set is
// discoverable without right-clicking.
//
// All actions run by parking a TextSelection in a representative cell of the
// target row/column, then invoking the prosemirror-tables command (which acts
// on the cell under the cursor). No CellSelection bookkeeping required.
//
// Scope is deliberately export-safe: insert/delete + header toggles all survive
// the GFM-pipe markdown serializer. Merge/split + per-cell styling are omitted
// because GFM can't represent them.

type Cmd = (state: any, dispatch: any) => boolean;

type Rects = {
  table: { left: number; top: number; width: number; height: number };
  cols: { x: number; w: number }[];
  rows: { y: number; h: number }[];
};

const T = 16; // grip thickness (px)

function measure(tableEl: HTMLTableElement): Rects | null {
  const headerRow = tableEl.rows[0];
  if (!headerRow) return null;
  const t = tableEl.getBoundingClientRect();
  const cols = Array.from(headerRow.cells).map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, w: r.width };
  });
  const rows = Array.from(tableEl.rows).map((tr) => {
    const r = (tr as HTMLElement).getBoundingClientRect();
    return { y: r.top, h: r.height };
  });
  return { table: { left: t.left, top: t.top, width: t.width, height: t.height }, cols, rows };
}

interface Props {
  tableEl: HTMLTableElement | null;
  view: any;
  readOnly?: boolean;
}

export function TableHandles({ tableEl, view, readOnly }: Props) {
  const [rects, setRects] = useState<Rects | null>(null);
  const [menu, setMenu] = useState<{ kind: "col" | "row"; index: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!tableEl) { setRects(null); setMenu(null); return; }
    const update = () => setRects(measure(tableEl));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(tableEl);
    const mo = new MutationObserver(update);
    mo.observe(tableEl, { childList: true, subtree: true, attributes: true });
    // capture-phase scroll catches the editor's inner scroll container too
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [tableEl]);

  if (readOnly || !tableEl || !rects) return null;

  const runAtCell = (r: number, c: number, cmd: Cmd) => {
    const cellEl = tableEl.rows[r]?.cells[c];
    if (cellEl && view) {
      try {
        const pos = view.posAtDOM(cellEl, 0);
        const sel = TextSelection.near(view.state.doc.resolve(pos));
        view.dispatch(view.state.tr.setSelection(sel));
        cmd(view.state, view.dispatch);
        view.focus();
      } catch { /* stale DOM; ignore */ }
    }
    setMenu(null);
  };

  const { table, cols, rows } = rects;
  const active = menu;

  return (
    <>
      {/* Column grips along the top edge */}
      {cols.map((col, i) => (
        <button
          key={`c${i}`}
          title="Column actions"
          onMouseDown={(e) => {
            e.preventDefault();
            setMenu({ kind: "col", index: i, x: col.x + col.w / 2, y: table.top });
          }}
          style={{
            position: "fixed",
            left: col.x + 1,
            top: table.top - T - 2,
            width: col.w - 2,
            height: T,
            ...gripStyle(active?.kind === "col" && active.index === i),
          }}
        />
      ))}

      {/* Row grips along the left edge */}
      {rows.map((row, i) => (
        <button
          key={`r${i}`}
          title="Row actions"
          onMouseDown={(e) => {
            e.preventDefault();
            setMenu({ kind: "row", index: i, x: table.left, y: row.y + row.h / 2 });
          }}
          style={{
            position: "fixed",
            left: table.left - T - 2,
            top: row.y + 1,
            width: T,
            height: row.h - 2,
            ...gripStyle(active?.kind === "row" && active.index === i),
          }}
        />
      ))}

      {menu && (
        <TableActionMenu
          x={menu.x}
          y={menu.y}
          kind={menu.kind}
          onClose={() => setMenu(null)}
          onInsertBefore={() =>
            menu.kind === "col"
              ? runAtCell(0, menu.index, addColumnBefore)
              : runAtCell(menu.index, 0, addRowBefore)
          }
          onInsertAfter={() =>
            menu.kind === "col"
              ? runAtCell(0, menu.index, addColumnAfter)
              : runAtCell(menu.index, 0, addRowAfter)
          }
          onToggleHeader={() =>
            menu.kind === "col"
              ? runAtCell(0, menu.index, toggleHeaderColumn)
              : runAtCell(menu.index, 0, toggleHeaderRow)
          }
          onDelete={() =>
            menu.kind === "col"
              ? runAtCell(0, menu.index, deleteColumn)
              : runAtCell(menu.index, 0, deleteRow)
          }
          onDeleteTable={() => runAtCell(0, 0, deleteTable)}
        />
      )}
    </>
  );
}

function gripStyle(active: boolean): React.CSSProperties {
  return {
    zIndex: 250,
    border: "none",
    cursor: "pointer",
    borderRadius: 3,
    padding: 0,
    background: active
      ? "var(--accent)"
      : "color-mix(in srgb, var(--fg) 18%, transparent)",
    transition: "background 90ms ease-out",
  };
}

// ─── Action popover ───────────────────────────────────────

interface MenuProps {
  x: number; y: number;
  kind: "col" | "row";
  onClose: () => void;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onToggleHeader: () => void;
  onDelete: () => void;
  onDeleteTable: () => void;
}

function TableActionMenu({ x, y, kind, onClose, onInsertBefore, onInsertAfter, onToggleHeader, onDelete, onDeleteTable }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const W = 200, GAP = 8;
  const left = Math.min(Math.max(x - W / 2, GAP), window.innerWidth - W - GAP);
  const top = Math.min(y + 6, window.innerHeight - 260 - GAP);
  const isCol = kind === "col";

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", top, left, width: W, zIndex: 500,
        ...popoverSurface,
        fontFamily: "var(--font-ui)",
        fontSize: "0.8rem",
        color: "var(--fg)",
        userSelect: "none",
      }}
    >
      <div style={{ padding: "3px 0" }}>
        <MenuItem label={isCol ? "Insert column left" : "Insert row above"} onClick={onInsertBefore} />
        <MenuItem label={isCol ? "Insert column right" : "Insert row below"} onClick={onInsertAfter} />
      </div>
      <Sep />
      <div style={{ padding: "3px 0" }}>
        <MenuItem label={isCol ? "Toggle header column" : "Toggle header row"} onClick={onToggleHeader} />
      </div>
      <Sep />
      <div style={{ padding: "3px 0" }}>
        <MenuItem label={isCol ? "Delete column" : "Delete row"} onClick={onDelete} danger />
        <MenuItem label="Delete table" onClick={onDeleteTable} danger />
      </div>
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "0.45rem 0.75rem",
        background: "transparent", border: "none", cursor: "pointer",
        color: danger ? "var(--accent)" : "var(--fg)",
        fontSize: "inherit", fontFamily: "inherit",
        transition: "background 60ms ease-out",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 7%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <div style={{ height: 1, background: "color-mix(in srgb, var(--fg) 12%, transparent)" }} />;
}
