import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useToast } from "~/components/Toast";
import type { DragItem, DropTarget } from "./DndProvider";

export function useDndMove() {
  const fetcher = useFetcher();
  const { toast } = useToast();
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = fetcher.state;
    if (prev !== "idle" && fetcher.state === "idle") {
      window.dispatchEvent(new CustomEvent("loica:sidebar-refresh"));
    }
  }, [fetcher.state]);

  function handleMove(item: DragItem, target: DropTarget) {
    const formData = new FormData();

    const isCrossWorkspace = !!target.workspaceId;

    if (item.type === "doc") {
      formData.set("intent", isCrossWorkspace ? "move-doc-to-workspace" : "move-doc");
      formData.set("docId", item.id);
    } else {
      formData.set("intent", isCrossWorkspace ? "move-folder-to-workspace" : "move-folder");
      formData.set("folderId", item.id);
    }

    formData.set("targetFolderId", target.id ?? "");

    if (isCrossWorkspace) {
      formData.set("targetWorkspaceId", target.workspaceId!);
    }

    fetcher.submit(formData, { method: "post" });
    toast(`Moved "${item.title}"`, "success");
  }

  return { handleMove };
}
