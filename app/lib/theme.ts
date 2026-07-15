/**
 * Client-only theme toggle. Dark mode is a set of CSS var overrides gated on
 * `[data-theme]` on <html> (see app.css). Choice is persisted in localStorage;
 * with no stored choice we follow the OS `prefers-color-scheme`. The pre-paint
 * script in root.tsx applies the same logic before first paint to avoid a flash.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "loica-theme";

/** Explicit user choice, or null when following the system preference. */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The theme in effect: explicit choice if set, else the system preference. */
export function currentTheme(): Theme {
  return getStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / storage disabled — still apply for this session */
  }
  applyTheme(theme);
}

/** Flip light ⇄ dark, persist, and return the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
