#!/usr/bin/env node
// Color-coherence guard: fail if a .tsx introduces a raw hex color instead of
// referencing a token from app.css (--success, --danger, --accent, --fg, …).
//
// Allowed: icons.tsx (brand/logo + icon art), `var(--token, #fallback)` (token
// with standalone fallback), HTML entities (&#8220;), and any line marked
// with a trailing `// allow-hex` opt-out. CSS lives in app.css (centralized).
//
// Run: bun run check:colors
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "app";
const ALLOW_FILES = new Set(["app/components/icons.tsx"]);
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  if (ALLOW_FILES.has(file)) continue;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!HEX.test(line)) return;
    if (line.includes("var(--")) return;   // token with fallback — fine
    if (line.includes("&#")) return;       // HTML entity, not a color
    if (line.includes("allow-hex")) return; // explicit opt-out
    offenders.push(`  ${file}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error("Raw hex colors found in .tsx — use a token from app.css (or `// allow-hex`):");
  console.error(offenders.join("\n"));
  process.exit(1);
}
console.log("✓ check:colors — no stray hex in .tsx");
