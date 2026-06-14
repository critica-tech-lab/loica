import { useMemo } from "react";
import { LogoIcon } from "./icons";

// ─── Markup stripping ────────────────────────────────────

/** Strip CriticMarkup and common Markdown formatting to get "plain" text */
function stripMarkup(text: string): string {
  let s = text;

  // CriticMarkup
  s = s.replace(/\{==([\s\S]*?)==\}\{>>[\s\S]*?<<\}/g, "$1");
  s = s.replace(/\{>>[\s\S]*?<<\}/g, "");
  s = s.replace(/\{==([\s\S]*?)==\}/g, "$1");
  s = s.replace(/\{\+\+(?:@[^:]+:)?([\s\S]*?)\+\+\}/g, "$1");
  s = s.replace(/\{--(?:@[^:]+:)?[\s\S]*?--\}/g, "");
  s = s.replace(/\{~~(?:@[^:]+:)?[\s\S]*?~>([\s\S]*?)~~\}/g, "$1");

  // Markdown
  s = s.replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3));
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\*{3}(.+?)\*{3}/g, "$1");
  s = s.replace(/\*{2}(.+?)\*{2}/g, "$1");
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^>\s?/gm, "");
  s = s.replace(/^[\t ]*[-*+]\s+/gm, "");
  s = s.replace(/^[\t ]*\d+\.\s+/gm, "");
  s = s.replace(/^[-*_]{3,}\s*$/gm, "");

  return s;
}

// ─── Language detection ─────────────────────────────────

const EN_WORDS = new Set([
  "the", "and", "is", "in", "to", "of", "that", "for", "with", "this",
  "was", "are", "but", "not", "have", "has", "had", "been", "will", "would",
  "can", "could", "should", "from", "they", "their", "there", "which", "what",
  "when", "where", "who", "how", "all", "about", "more", "some", "than",
  "them", "these", "other", "into", "its", "also", "just", "because",
]);

const ES_WORDS = new Set([
  "de", "el", "la", "en", "que", "por", "una", "con", "es", "los",
  "las", "del", "para", "al", "como", "pero", "su", "más", "fue", "son",
  "está", "ser", "esta", "han", "hay", "uno", "sin", "sobre", "entre",
  "también", "todo", "desde", "nos", "hasta", "ese", "cada", "muy",
  "otro", "ya", "tiene", "puede", "hace", "donde", "sus", "estos",
]);

/** Detect language from plain text by counting stop-word hits */
export function detectLanguage(text: string): "en" | "es" {
  const words = text.toLowerCase().split(/\s+/);
  let en = 0;
  let es = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    if (ES_WORDS.has(w)) es++;
  }
  return es > en ? "es" : "en";
}

// ─── Shared style for floating bubble buttons ────────────

export const floatingBubbleBtnStyle: React.CSSProperties = {
  fontSize: "var(--text-base)",
  fontWeight: 600,
  padding: "0.4rem 0.75rem",
  background: "var(--fg)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  boxShadow: "var(--shadow-md)",
  lineHeight: 1,
  whiteSpace: "nowrap",
};

// ─── Component ───────────────────────────────────────────

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface DocActionBarProps {
  content: string;
  connectionStatus?: ConnectionStatus;
  showBranding?: boolean;
}

export function DocActionBar({ content, connectionStatus, showBranding }: DocActionBarProps) {
  const stats = useMemo(() => {
    const plain = stripMarkup(content);
    const chars = plain.length;
    const words = plain.split(/\s+/).filter((w) => w.length > 0).length;
    return { chars, words };
  }, [content]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "0.2rem max(1rem, calc(50% - 22rem))",
        borderTop: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
        flexShrink: 0,
        fontSize: "var(--text-xs)",
        color: "color-mix(in srgb, var(--fg) 45%, transparent)",
        letterSpacing: "0.02em",
      }}
    >
      {connectionStatus && connectionStatus !== "connected" && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
            marginRight: "auto",
            color: connectionStatus === "disconnected"
              ? "var(--color-scarlet, #AF3029)"
              : "color-mix(in srgb, var(--fg) 55%, transparent)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: connectionStatus === "disconnected"
                ? "var(--color-scarlet, #AF3029)"
                : "var(--color-tawny, #DA702C)",
              flexShrink: 0,
            }}
          />
          {connectionStatus === "disconnected" ? "offline" : "reconnecting\u2026"}
        </span>
      )}
      {showBranding ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <LogoIcon style={{ width: "auto", height: "0.65rem", opacity: 0.4 }} />
          Written and shared with Loica
        </span>
      ) : (
        <>
          <span>{stats.words.toLocaleString()} words</span>
          <span>{stats.chars.toLocaleString()} characters</span>
        </>
      )}
    </div>
  );
}
