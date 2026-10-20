import { test, expect, describe } from "bun:test";
import { buildFtsQuery, MIN_SEARCH_QUERY_LENGTH } from "~/lib/search-query.server";

describe("buildFtsQuery", () => {
  test("wraps each term as a quoted prefix phrase", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello"* "world"*');
  });

  test("doubles an embedded double quote (FTS5's own escape)", () => {
    // Unescaped, the quote would close the phrase early and leave `it"`
    // dangling as bare, invalid FTS syntax — searchDocuments's caller
    // (api.search.ts) swallows the resulting SQLite error into an empty
    // result, so this used to silently return no matches instead of
    // searching for the literal text.
    expect(buildFtsQuery('fix "it"')).toBe('"fix"* """it"""*');
  });

  test("collapses irregular whitespace between terms", () => {
    expect(buildFtsQuery("  foo   bar  ")).toBe('"foo"* "bar"*');
  });

  test("a lone double quote still produces balanced FTS syntax", () => {
    expect(buildFtsQuery('"')).toBe('""""*');
  });
});

describe("MIN_SEARCH_QUERY_LENGTH", () => {
  test("is at least 2 — a 1-char query against a prefix index is unusably broad", () => {
    expect(MIN_SEARCH_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
  });
});
