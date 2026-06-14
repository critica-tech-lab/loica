export interface PMActiveState {
  strong: boolean;
  em: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  highlight: boolean;
  heading: 0 | 1 | 2 | 3 | 4;
  inBlockquote: boolean;
  inBulletList: boolean;
  inOrderedList: boolean;
  textAlign: string | null;
}

export interface TrackedChangeEntry {
  id: string;
  ids: string[]; // all segment IDs merged into this entry
  type: "insert" | "delete" | "other";
  text: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  from: number;
  to: number;
}

export interface TrackChangesActiveState {
  enabled: boolean;
  pendingCount: number;
  changes: TrackedChangeEntry[];
}

export type EditingMode = "editing" | "suggesting" | "viewing";

// Deterministic author color — shared palette so an author reads the same
// across cursors, avatars, comments, and track changes.
import { colorForKey } from "~/lib/user-colors";
export function authorTrackColor(authorId: string): string {
  return colorForKey(authorId);
}
