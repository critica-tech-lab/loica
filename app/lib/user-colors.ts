// Single source of truth for per-user / author / collaborator colors.
// Deterministic: the same key always maps to the same color, so a user reads
// the same across collab cursors, avatars, comment authors, track-change
// authors, and sidebar icons. Pure module — safe on client and server.

export const USER_COLORS = [
  "#AF3029", "#205EA6", "#66800B", "#D0A215", "#5E409D", "#A02F6F",
  "#24837B", "#879A39", "#DA702C", "#4385BE", "#3AA99F", "#D14D41",
];

/** Stable color for a key (user id, author id, name, email). */
export function colorForKey(key: string): string {
  if (!key) return USER_COLORS[0];
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}
