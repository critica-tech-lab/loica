export interface PMActiveState {
  strong: boolean;
  em: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  heading: 0 | 1 | 2 | 3 | 4;
  inBlockquote: boolean;
  inBulletList: boolean;
  inOrderedList: boolean;
}

export interface TrackedChangeEntry {
  id: string;
  type: "insert" | "delete" | "other";
  text: string;
  authorId: string;
}

export interface TrackChangesActiveState {
  enabled: boolean;
  pendingCount: number;
  changes: TrackedChangeEntry[];
}
