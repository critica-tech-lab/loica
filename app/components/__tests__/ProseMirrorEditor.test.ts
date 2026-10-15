import { test, expect, describe } from "bun:test";
import {
  isDocumentRestoredClose,
  DOCUMENT_RESTORED_CLOSE_CODE,
  isConnectionNoticeClose,
} from "~/components/ProseMirrorEditor";
import {
  WS_CLOSE_DOCUMENT_RESTORED,
  WS_CLOSE_ACCESS_REVOKED,
  WS_CLOSE_DOC_UNAVAILABLE,
} from "../../../ws/types";

// Restoring a version closes every open WS connection on that doc with this
// code (ws-server.ts's flushAndDestroyRoom) so each client clears its stale
// local Yjs/IndexedDB copy instead of letting y-websocket's auto-reconnect
// merge pre-restore history back onto the server and undo the restore. The
// client and server define this code independently (one runs in the
// browser, one in ws-server's Node process, so they can't share a module) —
// guard against them drifting apart.
describe("isDocumentRestoredClose", () => {
  test("client and server agree on the close code", () => {
    expect(DOCUMENT_RESTORED_CLOSE_CODE).toBe(WS_CLOSE_DOCUMENT_RESTORED);
  });

  test("matches the document-restored close code", () => {
    expect(isDocumentRestoredClose({ code: DOCUMENT_RESTORED_CLOSE_CODE })).toBe(true);
  });

  test("does not match an unrelated close code", () => {
    expect(isDocumentRestoredClose({ code: 1000 })).toBe(false);
    expect(isDocumentRestoredClose({ code: 4401 })).toBe(false);
  });

  test("handles a null event (e.g. a local disconnect, not a server close)", () => {
    expect(isDocumentRestoredClose(null)).toBe(false);
    expect(isDocumentRestoredClose(undefined)).toBe(false);
  });
});

// Access-revoked and doc-unavailable closes: client and server must agree
// on these too, for the same reason as above.
describe("isConnectionNoticeClose", () => {
  test("client and server agree on both close codes", () => {
    expect(isConnectionNoticeClose({ code: WS_CLOSE_ACCESS_REVOKED })).toBe(true);
    expect(isConnectionNoticeClose({ code: WS_CLOSE_DOC_UNAVAILABLE })).toBe(true);
  });

  test("does not fire for the document-restored close (handled separately) or a plain disconnect", () => {
    expect(isConnectionNoticeClose({ code: WS_CLOSE_DOCUMENT_RESTORED })).toBe(false);
    expect(isConnectionNoticeClose({ code: 1000 })).toBe(false);
    expect(isConnectionNoticeClose(null)).toBe(false);
  });
});
