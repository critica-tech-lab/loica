import { ResizableNodeView, ResizableRatioType } from "prosemirror-resizable-view";
import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

interface CreateProps {
  node: Node;
  view: EditorView;
  getPos: () => number;
  options?: Record<string, any>;
}

export class ResizableImageView extends ResizableNodeView {
  createElement({ node }: CreateProps): HTMLElement {
    const img = document.createElement("img");
    img.src = node.attrs.src ?? "";
    if (node.attrs.alt) img.alt = node.attrs.alt;
    if (node.attrs.title) img.title = node.attrs.title;
    img.style.maxWidth = "100%";
    img.style.display = "block";
    img.draggable = false;
    return img;
  }
}

export function makeImageNodeView(node: Node, view: EditorView, getPos: (() => number | undefined) | boolean) {
  return new ResizableImageView({
    node,
    view,
    getPos: getPos as () => number,
    aspectRatio: ResizableRatioType.Fixed,
    initialSize: node.attrs.width && node.attrs.height
      ? { width: node.attrs.width, height: node.attrs.height }
      : undefined,
  });
}
