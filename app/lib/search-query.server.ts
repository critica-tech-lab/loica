// Pure query-building logic for full-text search, kept separate from
// document.server.ts (and its DB import) so it can be unit tested without a
// database connection.

// A 1-character query against an FTS prefix index matches almost everything
// in the table, which is slow and useless — reject it before it reaches SQLite.
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Build a `documents_fts MATCH` expression from a raw user query: each
 * whitespace-separated term becomes a quoted FTS5 phrase with a trailing `*`
 * for prefix matching. A `"` embedded in a term must be doubled — FTS5's own
 * escape for a literal quote inside a phrase — or it closes the phrase early
 * and the remainder is parsed as bare (often invalid) FTS syntax. An
 * unescaped quote used to throw a SQLite error that searchDocuments quietly
 * turned into an empty result, so a query like `fix "it"` returned nothing
 * instead of erroring or matching.
 */
export function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(" ");
}
