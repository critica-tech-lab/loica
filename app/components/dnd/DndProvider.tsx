import { useState, useCallback, createContext, useContext } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { FolderSummary } from "~/lib/folder.server";
import { getDescendantIds } from "~/lib/folder-utils";
import { FolderIcon, DocIcon } from "~/components/icons";

export type DragItem = {
  type: "doc" | "folder";
  id: string;
  title: string;
  currentFolderId: string | null;
};

export type DropTarget = {
  type: "folder" | "root";
  id: string | null;
  /** When set, indicates a cross-workspace drop target. */
  workspaceId?: string;
};

interface DndStateContext {
  activeItem: DragItem | null;
  allFolders: FolderSummary[];
  enabled: boolean;
}

const DndStateCtx = createContext<DndStateContext>({
  activeItem: null,
  allFolders: [],
  enabled: false,
});

export function useDndState() {
  return useContext(DndStateCtx);
}

interface DndProviderProps {
  onMove: (item: DragItem, target: DropTarget) => void;
  allFolders: FolderSummary[];
  children: React.ReactNode;
}

function isDropValid(
  item: DragItem,
  target: DropTarget,
  allFolders: FolderSummary[]
): boolean {
  // Cross-workspace drops: always valid (server validates further)
  if (target.workspaceId) return true;

  // Can't drop a folder onto itself
  if (item.type === "folder" && target.type === "folder" && item.id === target.id)
    return false;

  // Can't drop a folder onto one of its descendants
  if (item.type === "folder" && target.type === "folder") {
    const descendants = getDescendantIds(allFolders, item.id);
    if (descendants.has(target.id!)) return false;
  }

  // Can't drop into the same folder it's already in
  const targetFolderId = target.type === "root" ? null : target.id;
  if (item.currentFolderId === targetFolderId) return false;

  return true;
}

export { isDropValid };

export function DndProvider({ onMove, allFolders, children }: DndProviderProps) {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragItem | undefined;
    if (data) setActiveItem(data);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null);

      const item = event.active.data.current as DragItem | undefined;
      const target = event.over?.data.current as DropTarget | undefined;

      if (!item || !target) return;
      if (!isDropValid(item, target, allFolders)) return;

      onMove(item, target);
    },
    [allFolders, onMove]
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
  }, []);

  return (
    <DndStateCtx.Provider value={{ activeItem, allFolders, enabled: true }}>
      <DndContext
        id="main-dnd"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeItem && (
            <div className="flex items-center gap-2 rounded-lg border border-fg/20 bg-bg px-3 py-2 shadow-lg">
              {activeItem.type === "folder" ? (
                <FolderIcon className="h-4 w-4 text-fg/50" />
              ) : (
                <DocIcon className="h-4 w-4 text-fg/25" />
              )}
              <span className="text-sm font-medium">{activeItem.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </DndStateCtx.Provider>
  );
}
