import { useDroppable } from "@dnd-kit/core";
import { type DropTarget, useDndState, isDropValid } from "./DndProvider";

interface DroppableProps {
  target: DropTarget;
  disabled?: boolean;
  children: (props: {
    dropRef: (el: HTMLElement | null) => void;
    isOver: boolean;
    isInvalid: boolean;
  }) => React.ReactNode;
}

export function Droppable({ target, disabled, children }: DroppableProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${target.type}-${target.id ?? "root"}`,
    data: target,
    disabled,
  });

  const { activeItem, allFolders } = useDndState();
  const isInvalid =
    isOver && activeItem != null && !isDropValid(activeItem, target, allFolders);

  return <>{children({ dropRef: setNodeRef, isOver, isInvalid })}</>;
}
