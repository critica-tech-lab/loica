// React hooks that wrap the extension registry. Lives in its own file so
// `~/extensions/index.ts` (consumed by `~/lib/templates.ts` and the SDK
// at module-init time) does NOT pull `~/root` into the import graph —
// importing `~/root` here transitively loads the server registry and
// creates a cycle through each extension's `index.ts` ↔ `sdk.ts`.

import { useMemo } from "react";
import type { LoicaExtension } from "./types";
import { getEnabledExtensionForDocType } from "./index";
import { useEnabledExtensionIds } from "~/root";

/**
 * Registry lookup gated on the admin's enabled set.
 * Returns null when the doc's extension is missing, disabled, or the
 * doc is plain markdown (no `type:` frontmatter).
 *
 * Use this instead of `getExtensionForDocType` from any client component
 * so a disabled extension's `EditorView`, `EditorBanner`, `rowIcon`, and
 * `getDocMenuItems` all stop rendering — keeping client UI in sync with
 * the server's `getServerExtensionForDocType` which already gates.
 */
export function useDocTypeExtension(type: string | null | undefined): LoicaExtension | null {
  const enabledIds = useEnabledExtensionIds();
  return useMemo(() => getEnabledExtensionForDocType(type, enabledIds), [type, enabledIds]);
}
