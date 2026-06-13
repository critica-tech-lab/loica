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

// Deterministic author color — same palette Word uses for the first 7 authors.
const AUTHOR_COLORS = ["#2563eb","#dc2626","#16a34a","#7c3aed","#d97706","#0891b2","#be185d"];
export function authorTrackColor(authorId: string): string {
  if (!authorId) return AUTHOR_COLORS[0];
  let h = 0;
  for (let i = 0; i < authorId.length; i++) {
    h = Math.imul(31, h) + authorId.charCodeAt(i) | 0;
  }
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length];
}
