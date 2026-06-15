import { useEffect, useRef, useState } from "react";
import { menuItemHighlight } from "~/lib/popover-styles";

type UserResult = { id: string; name: string; email: string };

interface UserAutocompleteProps {
  name: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  required?: boolean;
  /** Extra query params appended to the search URL (e.g. { groupId: "..." }) */
  extraParams?: Record<string, string>;
  /** Called when the user selects a result — receives the email */
  onSelect?: (user: UserResult) => void;
}

export function UserAutocomplete({
  name,
  placeholder = "Name or email…",
  className,
  style,
  required,
  extraParams,
  onSelect,
}: UserAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Debounce 200ms
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({ q: query, ...extraParams });
      fetch(`/api/user-search?${params}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data: UserResult[]) => {
          setResults(data);
          setOpen(data.length > 0);
          setActiveIdx(-1);
        })
        .catch(() => {});
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectUser(user: UserResult) {
    setQuery(user.email);
    setOpen(false);
    onSelect?.(user);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      selectUser(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative", flex: 1, minWidth: style?.minWidth ?? (className ? undefined : "100px") }}>
      {/* Hidden input with the email value for form submission */}
      <input type="hidden" name={name} value={query} />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        required={required}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        className={className}
        style={style}
      />
      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: "var(--z-dropdown)",
            background: "var(--bg)",
            border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
            borderRadius: "var(--radius-md)",
            marginTop: "2px",
            maxHeight: "180px",
            overflowY: "auto",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {results.map((user, i) => (
            <button
              key={user.id}
              type="button"
              onClick={() => selectUser(user)}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                padding: "0.4rem 0.6rem 0.4rem calc(0.6rem - 2px)",
                border: "none",
                ...menuItemHighlight(i === activeIdx),
                color: "var(--fg)",
                cursor: "pointer",
                textAlign: "left",
                gap: "1px",
              }}
            >
              <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{user.name}</span>
              <span style={{ fontSize: "0.65rem", opacity: 0.5 }}>{user.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
