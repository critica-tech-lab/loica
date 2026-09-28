import { test, expect, describe } from "bun:test";
import { Marked, type Tokens } from "marked";
import {
  lexDoc,
  matchCallout,
  footnoteInline,
  fitWidth,
  safeFilename,
} from "~/lib/export/shared.server";

describe("lexDoc", () => {
  test("strips legacy {width=Npx} image markers", () => {
    const { tokens } = lexDoc("![alt](/api/uploads/x.png){width=300px}");
    const html = tokens.map((t) => t.raw).join("");
    expect(html).not.toContain("{width=300px}");
  });

  test("pulls footnote definitions out of the token stream", () => {
    const { tokens, footnotes } = lexDoc("See[^1] this.\n\n[^1]: A note.");
    expect(footnotes.length).toBe(1);
    expect(tokens.some((t) => t.type === "footnotes")).toBe(false);
  });
});

describe("matchCallout", () => {
  function firstBlockquote(markdown: string): Tokens.Blockquote {
    const tokens = new Marked().lexer(markdown);
    const bq = tokens.find((t) => t.type === "blockquote");
    if (!bq) throw new Error("no blockquote produced");
    return bq as Tokens.Blockquote;
  }

  test("recognizes a GitHub-alert-shaped blockquote and strips the label", () => {
    const bq = firstBlockquote("> [!WARNING]\n> Be careful here.");
    const result = matchCallout(bq);
    expect(result).not.toBeNull();
    expect(result?.variant).toBe("warning");
  });

  test("maps each alert keyword to its expected variant", () => {
    const cases: Array<[string, string]> = [
      ["NOTE", "note"],
      ["IMPORTANT", "note"],
      ["TIP", "tip"],
      ["WARNING", "warning"],
      ["CAUTION", "danger"],
      ["DANGER", "danger"],
    ];
    for (const [keyword, variant] of cases) {
      const bq = firstBlockquote(`> [!${keyword}]\n> body`);
      expect(matchCallout(bq)?.variant).toBe(variant);
    }
  });

  test("returns null for a plain blockquote", () => {
    const bq = firstBlockquote("> Just a quote, not an alert.");
    expect(matchCallout(bq)).toBeNull();
  });
});

describe("footnoteInline", () => {
  test("flattens paragraph tokens, joining multiple paragraphs with a space", () => {
    const tokens = new Marked().lexer("First para.\n\nSecond para.");
    const inline = footnoteInline(tokens);
    // No block-level paragraph tokens should remain, only inline content.
    expect(inline.every((t) => t.type !== "paragraph")).toBe(true);
    const text = inline.map((t) => ("raw" in t ? t.raw : "")).join("");
    expect(text).toContain("First para.");
    expect(text).toContain("Second para.");
  });
});

describe("fitWidth", () => {
  const img = { buffer: Buffer.alloc(0), mime: "image/png" as const, width: 800, height: 600 };

  test("scales intrinsic pixel width to points at 96dpi, capped at maxWidth", () => {
    // 800px * 0.75 = 600pt, under the 700pt cap → passes through unscaled
    expect(fitWidth(img, 700)).toBe(600);
  });

  test("never exceeds maxWidth even for a very wide image", () => {
    expect(fitWidth({ ...img, width: 4000 }, 400)).toBe(400);
  });

  test("falls back to maxWidth when intrinsic width is unknown", () => {
    expect(fitWidth({ ...img, width: 0 }, 400)).toBe(400);
  });
});

describe("safeFilename", () => {
  test("passes through an already-safe title", () => {
    expect(safeFilename("My Document 1")).toBe("My Document 1");
  });

  test("replaces unsafe characters with underscores", () => {
    expect(safeFilename("a/b:c*d?")).toBe("a_b_c_d_");
  });

  test("falls back to Untitled for an empty title", () => {
    expect(safeFilename("")).toBe("Untitled");
  });
});
