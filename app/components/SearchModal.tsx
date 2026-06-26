import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import DOMPurify from "dompurify";
import { useFocusTrap } from "~/components/hooks/useFocusTrap";
import { popoverSurface } from "~/lib/popover-styles";

type SearchResult = {
  id: string;
  title: string;
  snippet: string;
  workspace_id: string;
  workspace_name: string;
  workspace_type: string;
};

export function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((data: SearchResult[]) => {
        setResults(data);
        setSelectedIndex(0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(val: string) {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  }

  function handleSelect(result: SearchResult) {
    onClose();
    if (result.workspace_type === "team") {
      navigate(`/t/${result.workspace_id}/doc/${result.id}`);
    } else {
      navigate(`/w/doc/${result.id}`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    }
  }

  const trapRef = useFocusTrap<HTMLDivElement>(onClose);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "min(20vh, 10rem)",
        background: "rgba(28,22,18,0.4)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search documents"
        style={{
          width: "min(36rem, 90vw)",
          ...popoverSurface,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search documents…"
            style={{
              flex: 1,
              fontSize: "var(--fs-lg)",
              background: "none",
              border: "none",
              color: "var(--fg)",
              outline: "none",
              padding: 0,
            }}
          />
          <kbd
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-2xs)",
              padding: "0.15rem 0.4rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
              opacity: 0.35,
            }}
          >
            ESC
          </kbd>
        </div>

        {query.trim() && (
          <div style={{ maxHeight: "20rem", overflowY: "auto" }}>
            {loading && results.length === 0 && (
              <div style={{ padding: "1rem", textAlign: "center", opacity: 0.4, fontSize: "var(--fs-base)" }}>
                Searching…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div style={{ padding: "1rem", textAlign: "center", opacity: 0.4, fontSize: "var(--fs-base)" }}>
                No results found.
              </div>
            )}
            {results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.6rem 1rem",
                  fontSize: "var(--fs-base)",
                  background: i === selectedIndex
                    ? "color-mix(in srgb, var(--fg) 6%, transparent)"
                    : "none",
                  border: "none",
                  color: "var(--fg)",
                  cursor: "pointer",
                  borderTop: i > 0 ? "1px solid color-mix(in srgb, var(--fg) 5%, transparent)" : "none",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>{r.title}</div>
                <div
                  style={{ opacity: 0.5, fontSize: "var(--fs-sm)", lineHeight: 1.4 }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(r.snippet) }}
                />
                <div style={{ opacity: 0.3, fontSize: "var(--fs-2xs)", marginTop: "0.15rem" }}>
                  {r.workspace_name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
