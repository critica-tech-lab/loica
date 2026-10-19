import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { Editor } from "~/components/Editor";

// CodeMirror editor, kept as the VITE_PM_EDITOR=0 fallback. Loaded on
// demand so ProseMirror users never download it.
const EditorImpl = lazy(() => import("~/components/Editor").then((m) => ({ default: m.Editor })));

export function LazyEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={null}>
      <EditorImpl {...props} />
    </Suspense>
  );
}
