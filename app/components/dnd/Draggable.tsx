import { useDraggable } from "@dnd-kit/core";
import type { DragItem } from "./DndProvider";

interface DraggableProps {
  item: DragItem;
  disabled?: boolean;
  children: (props: {
    dragRef: (el: HTMLElement | null) => void;
    isDragging: boolean;
    attributes: Record<string, unknown>;
    listeners: Record<string, Function> | undefined;
  }) => React.ReactNode;
}

export function Draggable({ item, disabled, children }: DraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `drag-${item.type}-${item.id}`,
    data: item,
    disabled,
  });

  return <>{children({ dragRef: setNodeRef, isDragging, attributes: attributes as unknown as Record<string, unknown>, listeners })}</>;
}
