#!/usr/bin/env node
/**
 * check-colors — guards the single-source-of-truth color system.
 *
 * Rule: no raw color literals (hex / rgb() / rgba() / hsl() / hsla()) in the
 * app's TS/TSX. Every color must go through a CSS variable defined in app.css,
 * so themes (light / Dracula dark) can flip the whole UI by overriding a handful
 * of base vars. See app/app.css.
 *
 * Unlike the earlier version, literals inside `var(--tok, <fallback>)` are NOT
 * exempt: a fallback to a nonexistent token (e.g. `var(--fg-secondary, rgba(...))`)
 * silently pinned a dark-ink color that vanished in dark mode. Flagging the
 * literal forces either a real token or an explicit opt-out.
 *
 * Opt-outs:
 *   - Files in ALLOWLIST (brand asset / avatar sources).
 *   - Any line containing the marker `allow-hex` (add with a reason).
 *
 * app/app.css itself is the palette source and is not scanned (it's .css, and
 * this walker only visits .ts/.tsx).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = "app";
// Self-contained subtrees with their own palettes (e.g. reveal.js in
// presentations) — not part of the core token system.
const SKIP_DIRS = new Set(["extensions", "export"]);
// Files that legitimately hold raw color (brand marks, hashed avatar colors).
const ALLOWLIST = new Set(["icons.tsx", "Avatar.tsx"]);
// Server/document output — emails, PDFs and print-preview HTML render outside
// the app's themeable DOM (mail clients, PDF, print), so they carry fixed color.
const SKIP_FILE = /\.server\.ts$|api\.doc-preview\./;

// A color hex, but not an HTML entity (`&#8984;`) — those aren't colors.
const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;

/** @type {{file:string,line:number,text:string}[]} */
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (ALLOWLIST.has(basename(path))) continue;
    if (SKIP_FILE.test(path)) continue;
    scan(path);
  }
}

function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("allow-hex")) return;
    // Drop `//` line comments so prose mentioning a hex (e.g. an example in a
    // doc comment) isn't flagged — only real code is checked.
    const code = line.replace(/\/\/.*$/, "");
    if (HEX.test(code) || FUNC.test(code)) {
      violations.push({ file, line: i + 1, text: line.trim() });
    }
  });
}

walk(ROOT);

if (violations.length === 0) {
  console.log("check-colors: clean — no raw color literals.");
  process.exit(0);
}

console.error(`check-colors: ${violations.length} raw color literal(s) found.\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error(
  `\nUse a CSS variable from app/app.css instead. If a raw value is truly` +
    ` required, append a comment containing "allow-hex" with a reason.`,
);
process.exit(1);
