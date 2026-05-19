/**
 * Small client-side flash used to show an "X created · Undo" toast on the
 * landing page after a doc/spreadsheet creation that redirected us away
 * from the caller.
 *
 * Flow:
 * 1. Before firing the create fetcher, the caller calls `armUndoCreate`
 *    with the kind ("doc" | "spreadsheet") and a path to return to on Undo.
 * 2. The server creates the item and redirects to the new doc.
 * 3. On the landing page, `consumeUndoCreate` is called once on mount.
 *    If the flag is fresh (< 15s old) it is returned and cleared.
 * 4. The landing page shows a toast; clicking Undo trashes the current
 *    doc and navigates to `returnTo`.
 *
 * The freshness window guards against stale flags if a redirect failed,
 * the user opened a different doc manually, etc.
 */

const KEY = "loica.undoCreate";
const FRESHNESS_MS = 15_000;

// Extension templates contribute additional kinds at runtime (e.g.
// "report"), so the union widens to plain string — the toast layer only
// uses this for the label.
export type UndoCreateKind = string;

export interface UndoCreateFlash {
  kind: UndoCreateKind;
  /** Path to navigate to when the user clicks Undo. */
  returnTo: string;
  /** Timestamp (ms). */
  armedAt: number;
}

export function armUndoCreate(kind: UndoCreateKind, returnTo: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ kind, returnTo, armedAt: Date.now() } satisfies UndoCreateFlash),
    );
  } catch { /* no-op */ }
}

export function consumeUndoCreate(): UndoCreateFlash | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as UndoCreateFlash;
    if (!parsed || typeof parsed.armedAt !== "number") return null;
    if (Date.now() - parsed.armedAt > FRESHNESS_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
