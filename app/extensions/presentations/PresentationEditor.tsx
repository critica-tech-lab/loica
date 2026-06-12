import { lazy, Suspense } from "react";
import type { ExtensionEditorViewProps } from "~/extensions/types";

// Thin wrapper that lazy-loads the real editor. The impl imports app modules
// (PMToolbar → DocumentContext → extensions/hooks) that would otherwise loop
// back to the extension registry at module-init time and crash it
// ("Cannot read properties of undefined (reading 'apiVersion')"). Deferring the
// import to render time breaks that init-time cycle. This file imports only
// React + a type, so the registry can load it cleanly.
const PresentationEditorImpl = lazy(() =>
  import("./PresentationEditorImpl").then((m) => ({ default: m.PresentationEditorImpl })),
);

export function PresentationEditor(props: ExtensionEditorViewProps) {
  return (
    <Suspense fallback={null}>
      <PresentationEditorImpl {...props} />
    </Suspense>
  );
}
