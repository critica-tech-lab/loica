// Minimal lint config: react-hooks rules only, via Babel's TypeScript/JSX
// syntax stripping instead of typescript-eslint — this project runs
// TypeScript 7 (the native Go compiler preview), which typescript-eslint
// does not support yet. Babel's parser never touches the `typescript`
// package, so it isn't affected by that. No stylistic/formatting rules —
// tsc already owns type safety; this exists to catch the one class of bug
// tsc can't see: stale closures from incomplete hook dependency arrays.
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [".react-router/**", "build/**", "node_modules/**", "dist/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript", "@babel/preset-react"],
        },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Deliberately narrower than the plugin's "recommended" preset, which
      // as of v6+ also bundles React Compiler-era rules (set-state-in-effect,
      // refs, purity, ...) unrelated to what this config exists to catch.
      // The two classic hook rules are the actual target — every existing
      // `eslint-disable` comment in the codebase already references
      // exhaustive-deps specifically.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
