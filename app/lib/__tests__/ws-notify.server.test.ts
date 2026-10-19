import { test, expect, describe } from "bun:test";
import { shouldRejectContentWrite } from "~/lib/ws-notify.server";

// workspace.doc.$id.tsx, shared.doc.$id.tsx and s.$token.tsx all accept a
// direct `content` write outside the Yjs room. While a room is live, the
// room's own debounced save would just overwrite that write again — this
// is the decision each of those three call sites guards with.
describe("shouldRejectContentWrite", () => {
  test("rejects a content write while the room is live", () => {
    expect(shouldRejectContentWrite(true, true)).toBe(true);
  });

  test("allows a content write when no room is open", () => {
    expect(shouldRejectContentWrite(true, false)).toBe(false);
  });

  test("never rejects a title-only save (no content in the form)", () => {
    expect(shouldRejectContentWrite(false, true)).toBe(false);
    expect(shouldRejectContentWrite(false, false)).toBe(false);
  });
});
