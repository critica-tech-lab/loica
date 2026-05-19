/**
 * CodeMirror decoration extensions for Loica editor.
 * These decorations are extracted from Editor.tsx to keep that file more maintainable.
 *
 * All functions receive CodeMirror modules as parameters since they're dynamically loaded.
 */

import type {
  EditorView,
  Decoration,
  WidgetType,
} from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

// ── Image decoration ────────────────────────────────────────

export function createImageDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  WidgetType: typeof WidgetType;
}) {
  const { EditorView: CM_EditorView, Decoration: CM_Decoration, WidgetType: CM_WidgetType } = modules;

  class ImageWidget extends CM_WidgetType {
    constructor(public url: string, public alt: string) { super(); }
    eq(w: ImageWidget) { return w.url === this.url; }
    toDOM() {
      const wrapper = document.createElement("span");
      wrapper.style.cssText = "display:block;line-height:0";
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.alt;
      img.style.cssText =
        "max-width:min(100%,600px);border-radius:6px;display:block;margin:4px 0";
      img.draggable = false;
      wrapper.appendChild(img);
      return wrapper;
    }
    ignoreEvent() { return false; }
  }

  const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const hiddenMark = CM_Decoration.mark({ class: "cm-image-markup" });
  return CM_EditorView.decorations.compute(
    ["doc", "selection"],
    (state: EditorState) => {
      const doc = state.doc.toString();
      const cursor = state.selection.main.head;
      const decos: any[] = [];
      IMG_RE.lastIndex = 0;
      let m;
      while ((m = IMG_RE.exec(doc)) !== null) {
        const from = m.index;
        const to = from + m[0].length;
        if (cursor >= from && cursor <= to) continue;
        // Hide markdown with a mark, show image as point widget
        // (Decoration.replace spanning full lines corrupts HeightMap)
        decos.push(hiddenMark.range(from, to));
        decos.push(
          CM_Decoration.widget({
            widget: new ImageWidget(m[2], m[1]),
            side: 1,
          }).range(to)
        );
      }
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── List marker decorations ────────────────────────────────

export function createListMarkerDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    syntaxTree,
  } = modules;

  const orderedMarkerMark = CM_Decoration.mark({ class: "cm-list-marker" });
  // Cache line decorations by indent width to avoid recreating objects
  const hangingIndentCache = new Map<string, any>();
  function hangingIndentDeco(indent: string) {
    let deco = hangingIndentCache.get(indent);
    if (!deco) {
      deco = CM_Decoration.line({
        attributes: {
          style: `padding-left: ${indent}; text-indent: -${indent}`,
        },
      });
      hangingIndentCache.set(indent, deco);
    }
    return deco;
  }

  return CM_EditorView.decorations.compute(
    ["doc", "selection"],
    (state: EditorState) => {
      const decos: any[] = [];
      const cursor = state.selection.main.head;
      const tree = syntaxTree(state);
      tree.iterate({
        enter(node: any) {
          if (node.name === "ListMark") {
            const markerText = state.doc.sliceString(node.from, node.to);
            const isUnordered =
              markerText === "-" ||
              markerText === "*" ||
              markerText === "+";
            const lineStart = state.doc.lineAt(node.from).from;
            const lineEnd = state.doc.lineAt(node.from).to;
            const cursorOnLine = cursor >= lineStart && cursor <= lineEnd;

            if (isUnordered && !cursorOnLine) {
              // Style the marker and show bullet via CSS ::after
              decos.push(
                CM_Decoration.mark({ class: "cm-list-bullet" }).range(
                  node.from,
                  node.to
                )
              );
            } else {
              // Ordered numbers or cursor-on-line: just color them
              const mark = isUnordered
                ? CM_Decoration.mark({ class: "cm-list-marker" })
                : orderedMarkerMark;
              decos.push(mark.range(node.from, node.to));
            }

            // Hanging indent
            const markerLen = node.to - node.from;
            const indentCh = markerLen + 1;
            const leadingSpaces = node.from - lineStart;
            const totalIndent = leadingSpaces + indentCh;
            decos.push(hangingIndentDeco(`${totalIndent}ch`).range(lineStart));
          }
        },
      });
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── Link decorations ───────────────────────────────────────

export function createLinkDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
}) {
  const { EditorView: CM_EditorView, Decoration: CM_Decoration } = modules;

  const LINK_RE = /(?<!!)\[(?!\^)([^\]]+)\]\(([^)]+)\)/g;
  return CM_EditorView.decorations.compute(
    ["doc", "selection"],
    (state: EditorState) => {
      const doc = state.doc.toString();
      const cursor = state.selection.main.head;
      const decos: any[] = [];
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(doc)) !== null) {
        const from = m.index; // start of `[`
        const to = from + m[0].length; // end of `)`
        // If cursor is inside the markup, show raw text
        if (cursor >= from && cursor <= to) continue;
        const textStart = from + 1; // after `[`
        const textEnd = textStart + m[1].length; // before `]`
        // Hide `[`
        decos.push(CM_Decoration.replace({}).range(from, textStart));
        // Style the link text
        decos.push(
          CM_Decoration.mark({
            class: "cm-link-text",
            attributes: {
              "data-href": m[2],
              style: "color: var(--color-link); text-decoration: underline",
            },
          }).range(textStart, textEnd)
        );
        // Hide `](url)`
        decos.push(CM_Decoration.replace({}).range(textEnd, to));
      }
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── Table decorations ──────────────────────────────────────

function parseTableNode(
  state: { doc: { sliceString: (from: number, to: number) => string } },
  node: { from: number; to: number; node: any }
) {
  const rows: string[][] = [];
  const alignments: (string | null)[] = [];
  let hasHeader = false;

  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return { data: rows, alignments };

  do {
    const name = cursor.name;
    if (name === "TableHeader") {
      hasHeader = true;
      const text = state.doc.sliceString(cursor.from, cursor.to);
      rows.push(parsePipeRow(text));
    } else if (name === "TableDelimiter") {
      const text = state.doc.sliceString(cursor.from, cursor.to);
      const cells = parsePipeRow(text);
      for (const cell of cells) {
        const trimmed = cell.trim();
        if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
          alignments.push("center");
        } else if (trimmed.endsWith(":")) {
          alignments.push("right");
        } else if (trimmed.startsWith(":")) {
          alignments.push("left");
        } else {
          alignments.push(null);
        }
      }
    } else if (name === "TableRow") {
      const text = state.doc.sliceString(cursor.from, cursor.to);
      rows.push(parsePipeRow(text));
    }
  } while (cursor.nextSibling());

  return { data: rows, alignments, hasHeader };
}

function parsePipeRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Convert <br> back to newlines for display in textareas
  return s.split("|").map((c) => c.trim().replace(/<br\s*\/?>/gi, "\n"));
}

function reconstructTable(
  rows: string[][],
  alignments: (string | null)[],
  hasHeader: boolean
): string {
  const numCols = rows.length > 0 ? rows[0].length : 0;
  if (numCols === 0) return "";

  // Convert newlines to <br> for markdown storage
  const mdRows = rows.map(row => row.map(cell => cell.replace(/\n/g, "<br>")));

  // Compute max width per column
  const colWidths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    let max = 3; // minimum delimiter width
    for (const row of mdRows) {
      if (c < row.length) max = Math.max(max, row[c].length);
    }
    colWidths.push(max);
  }

  const buildRow = (cells: string[]) => {
    const parts = cells.map((cell, i) => {
      const w = colWidths[i] || 3;
      return ` ${cell.padEnd(w)} `;
    });
    return `|${parts.join("|")}|`;
  };

  const lines: string[] = [];
  const startRow = hasHeader ? 1 : 0;

  if (hasHeader && mdRows.length > 0) {
    lines.push(buildRow(mdRows[0]));
    // Build delimiter row
    const delimParts = colWidths.map((w, i) => {
      const align = alignments[i];
      const dashes = "-".repeat(w);
      if (align === "center") return ` :${dashes.slice(2)}: `;
      if (align === "right") return ` ${dashes.slice(1)}: `;
      if (align === "left") return ` :${dashes.slice(1)} `;
      return ` ${dashes} `;
    });
    lines.push(`|${delimParts.join("|")}|`);
  }

  for (let r = startRow; r < mdRows.length; r++) {
    lines.push(buildRow(mdRows[r]));
  }

  return lines.join("\n");
}

export function createTableDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  WidgetType: typeof WidgetType;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    WidgetType: CM_WidgetType,
    syntaxTree,
  } = modules;

  class TableWidget extends CM_WidgetType {
    constructor(
      public rows: string[][],
      public alignments: (string | null)[],
      public hasHeader: boolean,
      public docFrom: number
    ) {
      super();
    }

    eq(w: TableWidget) {
      return (
        this.hasHeader === w.hasHeader &&
        this.rows.length === w.rows.length &&
        this.rows.every(
          (r, i) =>
            r.length === w.rows[i].length &&
            r.every((c, j) => c === w.rows[i][j])
        )
      );
    }

    toDOM(view: EditorView) {
      const wrapper = document.createElement("div");
      wrapper.className = "cm-table-widget";
      wrapper.setAttribute("data-table-from", String(this.docFrom));

      const table = document.createElement("table");
      const numCols = this.rows.length > 0 ? this.rows[0].length : 0;
      const widget = this;

      // Helper: find table range and dispatch updated markdown
      const dispatchTable = (
        newRows: string[][],
        newAlignments: (string | null)[],
        focusCellAfter?: { row: number; col: number }
      ) => {
        const markdown = reconstructTable(newRows, newAlignments, widget.hasHeader);
        const pos = view.posAtDOM(wrapper);
        const tree = syntaxTree(view.state);
        let tableFrom = -1;
        let tableTo = -1;
        tree.iterate({
          enter(nodeRef: any) {
            if (nodeRef.name === "Table" && nodeRef.from <= pos && nodeRef.to >= pos) {
              tableFrom = nodeRef.from;
              tableTo = nodeRef.to;
              return false;
            }
          },
        });
        if (tableFrom >= 0 && tableTo >= 0) {
          const scrollTop = view.scrollDOM.scrollTop;
          view.dispatch({
            changes: { from: tableFrom, to: tableTo, insert: markdown },
          });
          view.scrollDOM.scrollTop = scrollTop;
          if (focusCellAfter) {
            requestAnimationFrame(() => {
              const container = view.dom.querySelector<HTMLElement>(
                `.cm-table-widget[data-table-from="${tableFrom}"]`
              ) || view.dom;
              const target = container.querySelector<HTMLInputElement>(
                `input.cm-table-input[data-row="${focusCellAfter.row}"][data-col="${focusCellAfter.col}"]`
              );
              if (target) target.focus();
            });
          }
        }
      };

      // Helper: read current cell values from DOM textareas
      const readRowsFromDOM = () => {
        const cells = Array.from(wrapper.querySelectorAll<HTMLTextAreaElement>("textarea.cm-table-input"));
        const rows: string[][] = [];
        for (const ta of cells) {
          const r = parseInt(ta.getAttribute("data-row")!);
          const c = parseInt(ta.getAttribute("data-col")!);
          while (rows.length <= r) rows.push([]);
          while (rows[r].length <= c) rows[r].push("");
          rows[r][c] = ta.value;
        }
        return rows;
      };

      const sizeCell = (ta: HTMLTextAreaElement) => {
        // Auto-grow height to fit content
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
        // Keep parent cell data-value in sync for print
        const cell = ta.closest("th, td") as HTMLElement | null;
        if (cell) cell.setAttribute("data-value", ta.value);
      };

      const createInput = (value: string, rowIdx: number, colIdx: number): Node => {
        const ta = document.createElement("textarea");
        ta.rows = 1;
        ta.value = value;
        ta.className = "cm-table-input";
        ta.setAttribute("data-row", String(rowIdx));
        ta.setAttribute("data-col", String(colIdx));
        if (widget.alignments[colIdx]) {
          ta.style.textAlign = widget.alignments[colIdx]!;
        }

        // Auto-size on creation (deferred so DOM is ready)
        requestAnimationFrame(() => sizeCell(ta));

        // Sync cell content to CodeMirror document (debounced to avoid
        // destroying/recreating the widget on every keystroke)
        let syncTimer: ReturnType<typeof setTimeout> | null = null;
        const syncToDoc = () => {
          if (syncTimer) clearTimeout(syncTimer);
          syncTimer = setTimeout(() => {
            syncTimer = null;
            const focusRow = ta.getAttribute("data-row")!;
            const focusCol = ta.getAttribute("data-col")!;
            const selStart = ta.selectionStart;
            const selEnd = ta.selectionEnd;

            const newRows = readRowsFromDOM();
            const markdown = reconstructTable(newRows, widget.alignments, widget.hasHeader);

            const pos2 = view.posAtDOM(wrapper);
            const tree = syntaxTree(view.state);
            let tableFrom = -1;
            let tableTo = -1;
            tree.iterate({
              enter(nodeRef: any) {
                if (nodeRef.name === "Table" && nodeRef.from <= pos2 && nodeRef.to >= pos2) {
                  tableFrom = nodeRef.from;
                  tableTo = nodeRef.to;
                  return false;
                }
              },
            });

            if (tableFrom >= 0 && tableTo >= 0) {
              const scrollTop = view.scrollDOM.scrollTop;
              view.dispatch({
                changes: { from: tableFrom, to: tableTo, insert: markdown },
              });
              view.scrollDOM.scrollTop = scrollTop;
              requestAnimationFrame(() => {
                const container = view.dom.querySelector<HTMLElement>(
                  `.cm-table-widget[data-table-from="${tableFrom}"]`
                ) || view.dom;
                const target = container.querySelector<HTMLTextAreaElement>(
                  `textarea.cm-table-input[data-row="${focusRow}"][data-col="${focusCol}"]`
                );
                if (target) {
                  target.focus();
                  target.setSelectionRange(selStart, selEnd);
                }
              });
            }
          }, 300);
        };

        // Flush pending sync immediately (used on blur and before undo/redo)
        const flushSync = () => {
          if (syncTimer) {
            clearTimeout(syncTimer);
            syncTimer = null;
            const newRows = readRowsFromDOM();
            const markdown = reconstructTable(newRows, widget.alignments, widget.hasHeader);
            const pos2 = view.posAtDOM(wrapper);
            const tree = syntaxTree(view.state);
            let tableFrom = -1;
            let tableTo = -1;
            tree.iterate({
              enter(nodeRef: any) {
                if (nodeRef.name === "Table" && nodeRef.from <= pos2 && nodeRef.to >= pos2) {
                  tableFrom = nodeRef.from;
                  tableTo = nodeRef.to;
                  return false;
                }
              },
            });
            if (tableFrom >= 0 && tableTo >= 0) {
              const scrollTop = view.scrollDOM.scrollTop;
              view.dispatch({
                changes: { from: tableFrom, to: tableTo, insert: markdown },
              });
              view.scrollDOM.scrollTop = scrollTop;
            }
          }
        };

        ta.addEventListener("input", () => {
          sizeCell(ta);
          syncToDoc();
        });

        ta.addEventListener("blur", flushSync);

        ta.addEventListener("keydown", (e: KeyboardEvent) => {
          // Forward undo/redo to CodeMirror
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
            flushSync();
            e.preventDefault();
            const focusRow = ta.getAttribute("data-row")!;
            const focusCol = ta.getAttribute("data-col")!;
            const tableFromAttr = wrapper.getAttribute("data-table-from");
            view.focus();
            view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
              key: e.key, code: e.code,
              metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
              bubbles: true, cancelable: true,
            }));
            requestAnimationFrame(() => {
              const container = (tableFromAttr
                ? view.dom.querySelector<HTMLElement>(`.cm-table-widget[data-table-from="${tableFromAttr}"]`)
                : null) || view.dom;
              const target = container.querySelector<HTMLTextAreaElement>(
                `textarea.cm-table-input[data-row="${focusRow}"][data-col="${focusCol}"]`
              );
              if (target) target.focus();
            });
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            const cells = Array.from(
              wrapper.querySelectorAll<HTMLTextAreaElement>("textarea.cm-table-input")
            );
            const idx = cells.indexOf(ta);
            if (e.shiftKey) {
              if (idx > 0) cells[idx - 1].focus();
            } else {
              if (idx < cells.length - 1) {
                cells[idx + 1].focus();
              } else {
                const newRows = readRowsFromDOM();
                newRows.push(new Array(numCols).fill(""));
                dispatchTable(newRows, widget.alignments, {
                  row: newRows.length - 1, col: 0,
                });
              }
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            const pos = view.posAtDOM(wrapper);
            const tree = syntaxTree(view.state);
            let tableTo = -1;
            tree.iterate({
              enter(nodeRef: any) {
                if (nodeRef.name === "Table" && nodeRef.from <= pos && nodeRef.to >= pos) {
                  tableTo = nodeRef.to;
                  return false;
                }
              },
            });
            if (tableTo >= 0) {
              const afterTable = Math.min(tableTo + 1, view.state.doc.length);
              view.dispatch({ selection: { anchor: afterTable } });
              view.focus();
            }
          }
        });

        const showContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          const row = parseInt(ta.getAttribute("data-row")!);
          const col = parseInt(ta.getAttribute("data-col")!);

          // Remove any existing context menu
          wrapper.querySelector(".cm-table-ctx")?.remove();

          const menu = document.createElement("div");
          menu.className = "cm-table-ctx";

          const mkItem = (label: string, onClick: () => void) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "cm-table-ctx-item";
            item.textContent = label;
            item.addEventListener("mousedown", (ev) => {
              ev.preventDefault();
              menu.remove();
              onClick();
            });
            return item;
          };

          const rows = readRowsFromDOM();
          const startR = widget.hasHeader ? 1 : 0;
          const dataRows = rows.length - startR;
          const canDeleteRow = row >= startR && dataRows > 1;

          const mkSep = () => {
            const sep = document.createElement("div");
            sep.className = "cm-table-ctx-sep";
            return sep;
          };

          // ── Insert actions ──
          menu.appendChild(mkItem("Insert row above", () => {
            const newRow = new Array(numCols).fill("");
            rows.splice(row, 0, newRow);
            dispatchTable(rows, widget.alignments, { row, col });
          }));
          menu.appendChild(mkItem("Insert row below", () => {
            const newRow = new Array(numCols).fill("");
            rows.splice(row + 1, 0, newRow);
            dispatchTable(rows, widget.alignments, { row: row + 1, col });
          }));
          menu.appendChild(mkItem("Insert column left", () => {
            const newRows = rows.map(r => { const nr = [...r]; nr.splice(col, 0, ""); return nr; });
            const newAlignments = [...widget.alignments];
            newAlignments.splice(col, 0, null);
            dispatchTable(newRows, newAlignments, { row, col });
          }));
          menu.appendChild(mkItem("Insert column right", () => {
            const newRows = rows.map(r => { const nr = [...r]; nr.splice(col + 1, 0, ""); return nr; });
            const newAlignments = [...widget.alignments];
            newAlignments.splice(col + 1, 0, null);
            dispatchTable(newRows, newAlignments, { row, col: col + 1 });
          }));

          // ── Delete actions ──
          if (canDeleteRow || numCols > 1) {
            menu.appendChild(mkSep());
          }

          if (canDeleteRow) {
            menu.appendChild(mkItem("Delete row", () => {
              rows.splice(row, 1);
              const focusRow = Math.min(row, rows.length - 1);
              dispatchTable(rows, widget.alignments, { row: focusRow, col });
            }));
          }

          if (numCols > 1) {
            menu.appendChild(mkItem("Delete column", () => {
              const newRows = rows.map(r => { const nr = [...r]; nr.splice(col, 1); return nr; });
              const newAlignments = [...widget.alignments];
              newAlignments.splice(col, 1);
              dispatchTable(newRows, newAlignments);
            }));
          }

          // Append to body with fixed positioning so the menu escapes any
          // overflow clipping or stacking context from the table/editor DOM.
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY}px`;
          document.body.appendChild(menu);

          // Flip if the menu would overflow the viewport edge
          requestAnimationFrame(() => {
            const r = menu.getBoundingClientRect();
            if (r.right > window.innerWidth - 8) menu.style.left = `${e.clientX - r.width}px`;
            if (r.bottom > window.innerHeight - 8) menu.style.top = `${e.clientY - r.height}px`;
          });

          // Close on click outside
          const close = () => { menu.remove(); document.removeEventListener("mousedown", close); };
          setTimeout(() => document.addEventListener("mousedown", close), 0);
        };

        ta.addEventListener("contextmenu", showContextMenu);

        return ta;
      };

      // ── Table with edge controls ──
      const tableWrap = document.createElement("div");
      tableWrap.className = "cm-table-body";

      // ── Column resize helpers ──
      const createResizeHandle = (colIdx: number) => {
        const handle = document.createElement("div");
        handle.className = "cm-table-resize-handle";
        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const th = handle.parentElement!;
          const startX = e.clientX;
          const startW = th.offsetWidth;
          handle.classList.add("cm-table-resize-active");

          const onMove = (ev: MouseEvent) => {
            const newW = Math.max(40, startW + ev.clientX - startX);
            table.style.tableLayout = "fixed";
            th.style.width = `${newW}px`;
          };
          const onUp = () => {
            handle.classList.remove("cm-table-resize-active");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        return handle;
      };

      let startRow = 0;
      if (this.hasHeader && this.rows.length > 0) {
        const thead = document.createElement("thead");
        const tr = document.createElement("tr");
        this.rows[0].forEach((cell, i) => {
          const th = document.createElement("th");
          th.style.position = "relative";
          th.appendChild(createInput(cell, 0, i));
          th.appendChild(createResizeHandle(i));
          th.addEventListener("mousedown", (e) => {
            if ((e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              e.stopPropagation();
              th.querySelector<HTMLTextAreaElement>("textarea.cm-table-input")?.focus();
            }
          });
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
        startRow = 1;
      }

      if (startRow < this.rows.length) {
        const tbody = document.createElement("tbody");
        for (let r = startRow; r < this.rows.length; r++) {
          const tr = document.createElement("tr");
          this.rows[r].forEach((cell, i) => {
            const td = document.createElement("td");
            td.appendChild(createInput(cell, r, i));
            td.addEventListener("mousedown", (e) => {
              if ((e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
                e.stopPropagation();
                td.querySelector<HTMLTextAreaElement>("textarea.cm-table-input")?.focus();
              }
            });
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
      }

      tableWrap.appendChild(table);

      // Add column button (right edge)
      const addCol = document.createElement("button");
      addCol.type = "button";
      addCol.className = "cm-table-add cm-table-add-col";
      addCol.textContent = "+";
      addCol.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const rows = readRowsFromDOM();
        const newRows = rows.map(r => [...r, ""]);
        const newAlignments = [...widget.alignments, null];
        dispatchTable(newRows, newAlignments);
      });
      tableWrap.appendChild(addCol);

      wrapper.appendChild(tableWrap);

      // Add row button (bottom edge)
      const addRow = document.createElement("button");
      addRow.type = "button";
      addRow.className = "cm-table-add cm-table-add-row";
      addRow.textContent = "+";
      addRow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const rows = readRowsFromDOM();
        rows.push(new Array(numCols).fill(""));
        dispatchTable(rows, widget.alignments, { row: rows.length - 1, col: 0 });
      });
      wrapper.appendChild(addRow);

      return wrapper;
    }

    updateDOM(dom: HTMLElement, _view: EditorView) {
      dom.setAttribute("data-table-from", String(this.docFrom));
      const cells = dom.querySelectorAll<HTMLTextAreaElement>("textarea.cm-table-input");
      const totalCells = this.rows.reduce((sum, r) => sum + r.length, 0);
      if (cells.length !== totalCells) return false;

      let idx = 0;
      for (let r = 0; r < this.rows.length; r++) {
        for (let c = 0; c < this.rows[r].length; c++) {
          const ta = cells[idx++];
          if (ta !== document.activeElement) {
            ta.value = this.rows[r][c];
          }
          ta.setAttribute("data-row", String(r));
          ta.setAttribute("data-col", String(c));
          // Auto-grow height and update print data
          ta.style.height = "auto";
          ta.style.height = `${ta.scrollHeight}px`;
          const cell = ta.closest("th, td") as HTMLElement | null;
          if (cell) cell.setAttribute("data-value", ta.value);
        }
      }
      return true;
    }

    ignoreEvent() {
      return true;
    }
  }

  return CM_EditorView.decorations.compute(
    ["doc"],
    (state: EditorState) => {
      const decos: any[] = [];
      const tree = syntaxTree(state);
      tree.iterate({
        enter(nodeRef: any) {
          if (nodeRef.name === "Table") {
            const { data, alignments, hasHeader } = parseTableNode(state, nodeRef);
            if (data.length > 0) {
              decos.push(
                CM_Decoration.replace({
                  widget: new TableWidget(data, alignments, hasHeader ?? false, nodeRef.from),
                }).range(nodeRef.from, nodeRef.to)
              );
            }
            return false;
          }
        },
      });
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── Horizontal rule decoration ─────────────────────────────

export function createHorizontalRuleDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  WidgetType: typeof WidgetType;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    WidgetType: CM_WidgetType,
    syntaxTree,
  } = modules;

  class HRWidget extends CM_WidgetType {
    eq() { return true; }
    toDOM() {
      const hr = document.createElement("hr");
      hr.className = "cm-hr";
      return hr;
    }
  }

  const hrWidget = new HRWidget();

  return CM_EditorView.decorations.compute(["doc"], (state: EditorState) => {
    const decos: any[] = [];

    // Skip HR widgets for the opening and closing `---` of YAML frontmatter,
    // so the metadata block reads as a quiet text region rather than being
    // sliced by two full-width horizontal rules.
    let fmOpenFrom = -1;
    let fmCloseFrom = -1;
    if (state.doc.line(1).text === "---") {
      const lastLineNo = Math.min(state.doc.lines, 40);
      for (let n = 2; n <= lastLineNo; n++) {
        if (state.doc.line(n).text === "---") {
          fmOpenFrom = state.doc.line(1).from;
          fmCloseFrom = state.doc.line(n).from;
          break;
        }
      }
    }

    const tree = syntaxTree(state);
    tree.iterate({
      enter(node: any) {
        if (node.name === "HorizontalRule") {
          if (node.from === fmOpenFrom || node.from === fmCloseFrom) return;
          decos.push(
            CM_Decoration.replace({ widget: hrWidget }).range(node.from, node.to)
          );
        }
      },
    });
    return CM_Decoration.set(decos, true);
  });
}

// ── Heading spacing decorations ────────────────────────────

export function createHeadingSpacingDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    syntaxTree,
  } = modules;

  const headingSpacing: Record<string, any> = {
    ATXHeading2: CM_Decoration.line({
      attributes: { style: "padding-bottom:0.3em" },
    }),
    ATXHeading3: CM_Decoration.line({
      attributes: { style: "padding-bottom:0.25em" },
    }),
    ATXHeading4: CM_Decoration.line({
      attributes: { style: "padding-bottom:0.2em" },
    }),
  };

  return CM_EditorView.decorations.compute(["doc"], (state: EditorState) => {
    const decos: any[] = [];
    const tree = syntaxTree(state);
    tree.iterate({
      enter(node: any) {
        const deco = headingSpacing[node.name];
        if (deco) {
          const line = state.doc.lineAt(node.from);
          decos.push(deco.range(line.from));
        }
      },
    });
    return CM_Decoration.set(decos, true);
  });
}

// ── Blockquote line decorations ─────────────────────────────

export function createBlockquoteDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    syntaxTree,
  } = modules;

  const blockquoteLine = CM_Decoration.line({ class: "cm-blockquote-line" });

  return CM_EditorView.decorations.compute(["doc"], (state: EditorState) => {
    const decos: any[] = [];
    const tree = syntaxTree(state);
    tree.iterate({
      enter(node: any) {
        if (node.name === "Blockquote") {
          // Add line decoration to every line within the blockquote
          const from = node.from;
          const to = node.to;
          const startLine = state.doc.lineAt(from).number;
          const endLine = state.doc.lineAt(to).number;
          for (let i = startLine; i <= endLine; i++) {
            const line = state.doc.line(i);
            decos.push(blockquoteLine.range(line.from));
          }
        }
      },
    });
    return CM_Decoration.set(decos, true);
  });
}

// ── Highlight decorations (==text==) ───────────────────────

export function createHighlightDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
}) {
  const { EditorView: CM_EditorView, Decoration: CM_Decoration } = modules;

  const highlightContentMark = CM_Decoration.mark({ class: "cm-highlight" });
  const highlightMarkerMark = CM_Decoration.mark({
    class: "cm-highlight-marker",
  });
  const HIGHLIGHT_RE = /(?<![{=])==(?!\})((?:[^=]|=[^=])+?)==(?!\})/g;

  return CM_EditorView.decorations.compute(
    ["doc"],
    (state: EditorState) => {
      const decos: any[] = [];
      const doc = state.doc.toString();
      HIGHLIGHT_RE.lastIndex = 0;
      let m;
      while ((m = HIGHLIGHT_RE.exec(doc)) !== null) {
        if (m.index > 0 && doc[m.index - 1] === "{") continue;
        // Skip if closing == is the opening of a CriticMarkup {== block
        const closingEqPos = m.index + m[0].length - 2;
        if (closingEqPos > 0 && doc[closingEqPos - 1] === "{") continue;
        const start = m.index;
        const innerStart = start + 2;
        const innerEnd = innerStart + m[1].length;
        const end = innerEnd + 2;
        // Fade the == markers
        decos.push(highlightMarkerMark.range(start, innerStart));
        // Highlight the inner text
        decos.push(highlightContentMark.range(innerStart, innerEnd));
        // Fade the closing == markers
        decos.push(highlightMarkerMark.range(innerEnd, end));
      }
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── Footnote reference decorations ──────────────────────────

export function createFootnoteDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  WidgetType: typeof WidgetType;
}) {
  const { EditorView: CM_EditorView, Decoration: CM_Decoration, WidgetType: CM_WidgetType } = modules;

  class FootnoteWidget extends CM_WidgetType {
    constructor(public displayNum: string) { super(); }
    eq(w: FootnoteWidget) { return w.displayNum === this.displayNum; }
    toDOM() {
      const sup = document.createElement("sup");
      sup.className = "cm-footnote-ref";
      sup.textContent = this.displayNum;
      return sup;
    }
    ignoreEvent() { return false; }
  }

  class FootnoteDefWidget extends CM_WidgetType {
    constructor(public displayNum: string) { super(); }
    eq(w: FootnoteDefWidget) { return w.displayNum === this.displayNum; }
    toDOM() {
      const span = document.createElement("span");
      span.className = "cm-footnote-def-label";
      span.textContent = `${this.displayNum}.`;
      return span;
    }
    ignoreEvent() { return false; }
  }

  const FNREF_RE = /\[\^(\w[\w-]*)\](?!:)/g;
  const FNDEF_RE = /^\[\^(\w[\w-]*)\]:/gm;

  return CM_EditorView.decorations.compute(
    ["doc", "selection"],
    (state: EditorState) => {
      const doc = state.doc.toString();
      const cursor = state.selection.main.head;
      const decos: any[] = [];

      // First pass: determine display number for each label by order of first appearance
      FNREF_RE.lastIndex = 0;
      const labelOrder = new Map<string, number>();
      let m;
      while ((m = FNREF_RE.exec(doc)) !== null) {
        if (!labelOrder.has(m[1])) labelOrder.set(m[1], labelOrder.size + 1);
      }

      // Second pass: create decorations for inline refs
      FNREF_RE.lastIndex = 0;
      while ((m = FNREF_RE.exec(doc)) !== null) {
        const from = m.index;
        const to = from + m[0].length;
        if (cursor >= from && cursor <= to) continue;
        const displayNum = String(labelOrder.get(m[1]) ?? m[1]);
        decos.push(
          CM_Decoration.replace({
            widget: new FootnoteWidget(displayNum),
          }).range(from, to)
        );
      }

      // Third pass: replace definition labels with numbers
      FNDEF_RE.lastIndex = 0;
      while ((m = FNDEF_RE.exec(doc)) !== null) {
        const from = m.index;
        const to = from + m[0].length; // covers `[^label]:`
        const line = state.doc.lineAt(from);
        if (cursor >= line.from && cursor <= line.to) continue;
        const displayNum = String(labelOrder.get(m[1]) ?? m[1]);
        decos.push(
          CM_Decoration.replace({
            widget: new FootnoteDefWidget(displayNum),
          }).range(from, to)
        );
      }

      return CM_Decoration.set(decos, true);
    }
  );
}

// ── Hide bold/italic/heading markup ─────────────────────────

export function createMarkupHidingDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
  syntaxTree: (state: EditorState) => any;
}) {
  const {
    EditorView: CM_EditorView,
    Decoration: CM_Decoration,
    syntaxTree,
  } = modules;

  return CM_EditorView.decorations.compute(
    ["doc", "selection"],
    (state: EditorState) => {
      const decos: any[] = [];
      const cursor = state.selection.main.head;
      const tree = syntaxTree(state);
      tree.iterate({
        enter(node: any) {
          if (node.name === "HeaderMark") {
            const line = state.doc.lineAt(node.from);
            const cursorOnLine = cursor >= line.from && cursor <= line.to;
            if (!cursorOnLine) {
              const after = state.doc.sliceString(node.to, node.to + 1);
              const end = after === " " ? node.to + 1 : node.to;
              decos.push(CM_Decoration.replace({}).range(node.from, end));
            }
          } else if (node.name === "QuoteMark") {
            const line = state.doc.lineAt(node.from);
            const cursorOnLine = cursor >= line.from && cursor <= line.to;
            if (!cursorOnLine) {
              const after = state.doc.sliceString(node.to, node.to + 1);
              const end = after === " " ? node.to + 1 : node.to;
              decos.push(CM_Decoration.replace({}).range(node.from, end));
            }
          } else if (node.name === "EmphasisMark") {
            // Only hide emphasis delimiters that are inside Emphasis or
            // StrongEmphasis nodes — never touch list markers or other
            // ambiguous * characters.
            const parent = node.node?.parent;
            if (
              parent &&
              (parent.name === "Emphasis" || parent.name === "StrongEmphasis")
            ) {
              const line = state.doc.lineAt(node.from);
              const cursorOnLine = cursor >= line.from && cursor <= line.to;
              if (!cursorOnLine) {
                decos.push(
                  CM_Decoration.replace({}).range(node.from, node.to)
                );
              }
            }
          }
        },
      });
      return CM_Decoration.set(decos, true);
    }
  );
}

// ── YAML frontmatter decoration ────────────────────────────
//
// A leading `---\n…\n---` block is metadata, not content. Without styling it
// reads identically to the slide separators that follow, which makes the
// editor feel like there's an extra empty slide at the top of presentation
// docs. This decoration fades the block, shrinks the type, and tags the
// opening fence with a small "metadata" label so the role is visually
// unambiguous while still fully editable.
export function createFrontmatterDecorations(modules: {
  EditorView: typeof EditorView;
  Decoration: typeof Decoration;
}) {
  const { EditorView: CM_EditorView, Decoration: CM_Decoration } = modules;

  const lineDeco = CM_Decoration.line({ attributes: { class: "cm-frontmatter-line" } });
  const openDeco = CM_Decoration.line({ attributes: { class: "cm-frontmatter-line cm-frontmatter-open" } });
  const closeDeco = CM_Decoration.line({ attributes: { class: "cm-frontmatter-line cm-frontmatter-close" } });

  return CM_EditorView.decorations.compute(["doc"], (state: EditorState) => {
    const decos: any[] = [];
    const firstLine = state.doc.line(1);
    if (firstLine.text !== "---") return CM_Decoration.set(decos, true);

    // Find closing `---` within a reasonable window (max 40 lines of frontmatter)
    const lastLineNo = Math.min(state.doc.lines, 40);
    let closeLineNo = -1;
    for (let n = 2; n <= lastLineNo; n++) {
      if (state.doc.line(n).text === "---") { closeLineNo = n; break; }
    }
    if (closeLineNo === -1) return CM_Decoration.set(decos, true);

    decos.push(openDeco.range(firstLine.from));
    for (let n = 2; n < closeLineNo; n++) {
      decos.push(lineDeco.range(state.doc.line(n).from));
    }
    decos.push(closeDeco.range(state.doc.line(closeLineNo).from));
    return CM_Decoration.set(decos, true);
  });
}
