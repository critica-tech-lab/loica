/**
 * Whether a failure is a request cancelled on purpose (AbortController, or the
 * router replacing an in-flight autosave with a newer one). That is routine,
 * not an error worth a full-page screen or an error report.
 *
 * The error's `name` is reliable, but a message-only value reaches the error
 * reporter, and each browser words the message differently.
 */
const ABORT_MESSAGE = /operation was aborted|signal is aborted|user aborted a request/i;

export function isAbortError(reason: unknown): boolean {
  if (typeof reason === "string") {
    return ABORT_MESSAGE.test(reason);
  }

  if (typeof reason !== "object" || reason === null) {
    return false;
  }

  const { name, message } = reason as { name?: unknown; message?: unknown };
  return name === "AbortError" || (typeof message === "string" && ABORT_MESSAGE.test(message));
}
