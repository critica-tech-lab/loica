/**
 * In-process concurrency guard for heavy, blocking work (workspace ZIP
 * export, PDF/DOCX rendering) that would otherwise stall the event loop for
 * every other request while it runs. Single-process only — same assumption
 * rate-limit.server.ts makes for Loica's deployment model.
 */

export class Semaphore {
  private available: number;

  constructor(max: number) {
    this.available = max;
  }

  /** Grab a slot without waiting. Returns false (no-op) when none is free. */
  tryAcquire(): boolean {
    if (this.available <= 0) return false;
    this.available--;
    return true;
  }

  release(): void {
    this.available++;
  }
}

// How long a caller turned away by the guard should wait before retrying.
// Heavy export jobs are seconds, not minutes, so a short retry is enough.
export const HEAVY_OP_RETRY_AFTER_SECONDS = 5;

/** Shared by every route that renders a workspace ZIP, PDF, or DOCX export. */
export const heavyExportSemaphore = new Semaphore(1);

// A doc-pdf/doc-docx POST body carries unsaved editor content, which isn't
// bound by the `contentSchema` cap applied to saved documents. Cap it
// independently so a single export request can't hand the renderer an
// arbitrarily large body.
export const MAX_EXPORT_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB

/** 429 response for a caller turned away by a concurrency guard. */
export function tooManyHeavyOps(): Response {
  return new Response("Server is busy with another export. Try again shortly.", {
    status: 429,
    headers: { "Retry-After": String(HEAVY_OP_RETRY_AFTER_SECONDS) },
  });
}
