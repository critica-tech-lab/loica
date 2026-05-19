// Shared UI utilities — used by both client and server route modules

const FALLBACK_COLORS = ["#AF3029","#66800B","#DA702C","#205EA6","#5E409D","#A02F6F","#D0A215","#24837B"];

export function nameColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

export function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const WORDS = [
  "fox","oak","bay","dew","elm","fig","gem","hay","ivy","jet",
  "koi","log","mew","nap","orb","pen","rye","sap","tar","urn",
  "vat","wax","yam","zen","arc","bog","cob","dam","eel","fan",
  "gum","hop","ink","jar","keg","lob","mob","nod","ore","pod",
  "rag","sob","tug","vim","web","yew","zip","ash","bud","cub",
  "den","dye","fin","gap","hub","imp","jab","kin","lag","map",
  "nib","oaf","pew","rib","sky","tab","tub","wig","yak","zap",
];

export function randomDocName(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}
