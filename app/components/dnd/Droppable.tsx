import { useId } from "react";
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
  // dnd-kit needs a unique id per mounted useDroppable call, but the same
  // logical target (e.g. workspace root) can render in several places at
  // once — sidebar header, breadcrumb, teamspace nav — and a folder can be
  // visible in both the main list and the sidebar tree simultaneously. Drop
  // resolution reads `event.over.data.current` (the `target` below), never
  // the id string, so the id itself just needs to be unique per instance.
  const instanceId = useId();
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${instanceId}`,
    data: target,
    disabled,
  });

  const { activeItem, allFolders } = useDndState();
  const isInvalid =
    isOver && activeItem != null && !isDropValid(activeItem, target, allFolders);

  return <>{children({ dropRef: setNodeRef, isOver, isInvalid })}</>;
}
