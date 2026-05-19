import type { TokenizerExtension, RendererExtension } from "marked";

/**
 * Marked extension for ==highlight== syntax.
 * Renders as <mark>text</mark>.
 * Avoids matching CriticMarkup {==text==}.
 */
export const highlightExtension: (TokenizerExtension | RendererExtension)[] = [
  {
    name: "highlight",
    level: "inline" as const,
    start(src: string) {
      const idx = src.indexOf("==");
      if (idx === -1) return -1;
      // Skip if preceded by { (CriticMarkup)
      if (idx > 0 && src[idx - 1] === "{") return -1;
      return idx;
    },
    tokenizer(src: string) {
      const match = /^==(?!\})((?:[^=]|=[^=])+?)==(?!\})/.exec(src);
      if (match) {
        return {
          type: "highlight",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
      }
      return undefined;
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline(token.tokens!)}</mark>`;
    },
  },
];
