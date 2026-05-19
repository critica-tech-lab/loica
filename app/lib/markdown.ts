// Pure markdown utilities — no imports from `~/extensions`, so this module
// is safe for the extension SDK to re-export without creating an init-time
// cycle.
//
// All functions are client-safe (string/regex only). Server-side callers
// can use them too; the duplication of imports is intentional to keep this
// file dependency-free.

/**
 * Renumber footnote labels to sequential 1, 2, 3... by order of first
 * inline reference appearance. Used for preview/export display.
 */
export function renumberFootnotesForDisplay(doc: string): string {
  const refMatches = [...doc.matchAll(/\[\^([\w-]+)\](?!:)/g)];
  if (refMatches.length === 0) return doc;

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of refMatches) {
    if (!seen.has(m[1])) { seen.add(m[1]); ordered.push(m[1]); }
  }

  // Already sequential numbers?
  if (ordered.every((label, i) => label === String(i + 1))) return doc;

  // Two-pass rename: label -> __FN_N__ -> N
  const remap = new Map<string, string>();
  ordered.forEach((old, i) => remap.set(old, String(i + 1)));

  let result = doc.replace(/\[\^([\w-]+)\]/g, (match, label) => {
    const newLabel = remap.get(label);
    return newLabel ? `[^__FN_${newLabel}__]` : match;
  });
  result = result.replace(/\[\^__FN_(\d+)__\]/g, "[^$1]");
  return result;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns key-value pairs or null if no frontmatter found.
 */
export function parseFrontmatter(
  content: string
): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    // Lowercase keys so consumers can read fields without worrying about case
    // (`organization` vs `Organization` should be the same field).
    const key = line.slice(0, idx).trim().toLowerCase();
    // Strip trailing inline `# comments` (require whitespace before `#` so values like #FF0000 survive)
    const val = line.slice(idx + 1).replace(/\s+#.*$/, "").trim();
    if (key) result[key] = val;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Returns the `type` field from frontmatter, or null.
 */
export function getDocumentType(content: string): string | null {
  const fm = parseFrontmatter(content);
  return fm?.type ?? null;
}

/**
 * Strip frontmatter from content, returning the body only.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Fix nested list indentation for pandoc.
 *
 * Pandoc requires sub-items under an ordered list item to be indented
 * by the width of the marker (e.g. "1. " = 3 chars, "10. " = 4 chars).
 * Users often write only 2-space indent which makes pandoc treat the
 * sub-list as a sibling. This function bumps insufficient indentation
 * so pandoc parses the nesting correctly.
 */
export function fixListIndentation(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  // Track the required indent for the current ordered list context
  // Stack of { indent: number, markerWidth: number }
  const olStack: { indent: number; markerWidth: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect ordered list item: optional leading spaces + digits + ". "
    const olMatch = line.match(/^(\s*)(\d+)\.\s/);
    if (olMatch) {
      const indent = olMatch[1].length;
      const markerWidth = olMatch[2].length + 2; // "N. " = digits + dot + space
      // Pop stack entries at same or deeper indent
      while (olStack.length > 0 && olStack[olStack.length - 1].indent >= indent) {
        olStack.pop();
      }
      olStack.push({ indent, markerWidth });
      result.push(line);
      continue;
    }

    // If we have an active OL context, check if this is an under-indented sub-item
    if (olStack.length > 0) {
      const ctx = olStack[olStack.length - 1];
      const requiredIndent = ctx.indent + ctx.markerWidth;
      // Detect list item (- or *) or continuation that's indented but not enough
      const subMatch = line.match(/^(\s*)([-*])\s/);
      if (subMatch) {
        const actualIndent = subMatch[1].length;
        if (actualIndent > ctx.indent && actualIndent < requiredIndent) {
          // Bump indentation to required level
          const padding = " ".repeat(requiredIndent);
          result.push(padding + line.trimStart());
          continue;
        }
      }

      // Blank line or non-list content at base indent resets context
      if (line.trim() === "" || (line.match(/^\S/) && !olMatch)) {
        // Keep stack for blank lines (could have continuation), reset for content at col 0
        if (line.trim() !== "") {
          olStack.length = 0;
        }
      }
    }

    result.push(line);
  }
  return result.join("\n");
}
