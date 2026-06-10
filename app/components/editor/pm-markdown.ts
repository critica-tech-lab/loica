import { defaultMarkdownSerializer, MarkdownSerializer } from "prosemirror-markdown";

// Extends defaultMarkdownSerializer to cover the full loica schema:
// - table/table_row/table_cell/table_header → GFM pipe tables
// - underline, highlight, tracked_insert → emit text only
// - tracked_delete → emit text only (exported as accepted)
// - strikethrough → ~~text~~
export const loicaMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,

    // Preserve a resized image's width on export. Emits the default
    // `![alt](src "title")` plus a `{width=Npx}` marker that the PDF route's
    // image-width Lua filter turns into a real width attribute (pandoc gfm
    // can't parse link attributes natively). No marker when width is unset.
    image(state, node) {
      const { src, alt, title, width } = node.attrs;
      state.write(
        "![" + state.esc(alt || "") + "](" + src.replace(/[()]/g, "\\$&") +
        (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")"
      );
      const w = parseInt(width, 10);
      if (Number.isFinite(w) && w > 0) state.write(`{width=${w}px}`);
    },

    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const parts: string[] = [];
          cell.forEach((block) => {
            parts.push(block.textContent.replace(/\|/g, "\\|").replace(/\n/g, " "));
          });
          cells.push(parts.join(" "));
        });
        rows.push(cells);
      });
      if (!rows.length) return;
      const colCount = Math.max(...rows.map((r) => r.length));
      const pad = (s: string) => s || " ";
      state.write("| " + rows[0].map(pad).join(" | ") + " |\n");
      state.write("|" + Array(colCount).fill(" --- ").join("|") + "|\n");
      for (let i = 1; i < rows.length; i++) {
        const row = [...rows[i]];
        while (row.length < colCount) row.push("");
        state.write("| " + row.map(pad).join(" | ") + " |\n");
      }
      state.write("\n");
    },
    // Handled wholesale by `table` above; these are never invoked by renderContent
    // but must be registered to avoid "token type not supported" errors.
    table_row() {},
    table_cell() {},
    table_header() {},
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: { open: "", close: "", mixable: true },
    highlight: { open: "", close: "", mixable: true },
    tracked_insert: { open: "", close: "", mixable: true },
    tracked_delete: { open: "", close: "", mixable: true },
  }
);
