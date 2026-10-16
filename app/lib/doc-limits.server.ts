/**
 * Size limit on a document's content, shared by both processes: the ws server
 * enforces it on realtime saves (`ws/persistence.ts`) and `updateDocument`
 * enforces it on HTTP saves. Imports nothing from the app so the ws server can
 * load it under plain Node.
 */

export const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

const HTTP_PAYLOAD_TOO_LARGE = 413;

/** Throw a 413 when `content` is larger than `MAX_DOC_BYTES` in UTF-8 bytes. */
export function assertDocSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") <= MAX_DOC_BYTES) {
    return;
  }

  throw new Response("Document too large", { status: HTTP_PAYLOAD_TOO_LARGE });
}
