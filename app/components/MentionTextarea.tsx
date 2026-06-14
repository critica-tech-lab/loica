import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { menuItemHighlight } from "~/lib/popover-styles";

type UserResult = { id: string; name: string; email: string };

interface MentionTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onSubmit?: () => void;
  submitLabel?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  rows?: number;
  autoFocus?: boolean;
}

const mentionPattern = /@\[(.+?)\]\(user:.+?\)/g;

/** True when the text contains at least one mention markup token. */
export function hasMentions(text: string): boolean {
  return /@\[.+?\]\(user:.+?\)/.test(text);
}

/** Render mention markup as bold @name spans, leaving other text intact. */
export function renderMentions(body: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = /@\[(.+?)\]\(user:(.+?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    parts.push(
      <span key={match.index} style={{ fontWeight: 700, color: "var(--color-star)" }}>@{match[1]}</span>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts.length > 0 ? parts : body;
}

/** Replace mention markup with just @name for display */
export function toDisplay(text: string): string {
  return text.replace(mentionPattern, "@$1");
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea({ value, onChange, onKeyDown, onBlur, onSubmit, submitLabel = "Press Enter to comment", placeholder, style, rows, autoFocus }, ref) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current!);

    // Auto-resize textarea to fit content
    useEffect(() => {
      const ta = innerRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }, [value]);

    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<UserResult[]>([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionStart, setMentionStart] = useState(-1);
    const abortRef = useRef<AbortController | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // We store the raw value (with mention markup) externally via onChange,
    // but display a cleaned version in the textarea.
    const displayValue = toDisplay(value);

    // Map a cursor position in display text back to raw text position
    function displayPosToRawPos(displayPos: number): number {
      let rawPos = 0;
      let dPos = 0;
      const re = new RegExp(mentionPattern.source, "g");
      let match: RegExpExecArray | null;
      let lastRaw = 0;
      let lastD = 0;

      while ((match = re.exec(value)) !== null) {
        const mentionRawStart = match.index;
        const mentionRawLen = match[0].length;
        const mentionDisplayText = `@${match[1]}`;
        const mentionDisplayLen = mentionDisplayText.length;

        // Text before this mention
        const textBeforeLen = mentionRawStart - lastRaw;
        if (displayPos <= lastD + textBeforeLen) {
          return lastRaw + (displayPos - lastD);
        }

        // Inside the mention display text
        if (displayPos <= lastD + textBeforeLen + mentionDisplayLen) {
          // Cursor is inside or at the end of the mention display — map to end of raw mention
          return mentionRawStart + mentionRawLen;
        }

        lastRaw = mentionRawStart + mentionRawLen;
        lastD = lastD + textBeforeLen + mentionDisplayLen;
      }

      // After all mentions
      return lastRaw + (displayPos - lastD);
    }

    // Map a cursor position in raw text to display text position
    function rawPosToDisplayPos(rawPos: number): number {
      const re = new RegExp(mentionPattern.source, "g");
      let match: RegExpExecArray | null;
      let lastRaw = 0;
      let lastD = 0;

      while ((match = re.exec(value)) !== null) {
        const mentionRawStart = match.index;
        const mentionRawLen = match[0].length;
        const mentionDisplayText = `@${match[1]}`;
        const mentionDisplayLen = mentionDisplayText.length;

        const textBeforeLen = mentionRawStart - lastRaw;
        if (rawPos <= mentionRawStart) {
          return lastD + (rawPos - lastRaw);
        }
        if (rawPos <= mentionRawStart + mentionRawLen) {
          return lastD + textBeforeLen + mentionDisplayLen;
        }

        lastRaw = mentionRawStart + mentionRawLen;
        lastD = lastD + textBeforeLen + mentionDisplayLen;
      }

      return lastD + (rawPos - lastRaw);
    }

    // Detect @query from cursor position in display text
    useEffect(() => {
      const ta = innerRef.current;
      if (!ta) return;
      const pos = ta.selectionStart;
      const textBefore = displayValue.slice(0, pos);
      const match = textBefore.match(/@(\w*)$/);
      if (match && match[1].length >= 1) {
        setMentionQuery(match[1]);
        setMentionStart(pos - match[0].length);
      } else {
        setMentionQuery("");
        setMentionStart(-1);
        setOpen(false);
      }
    }, [displayValue]);

    // Fetch users when mentionQuery changes
    useEffect(() => {
      if (mentionQuery.length < 1) {
        setResults([]);
        setOpen(false);
        return;
      }

      const timer = setTimeout(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        fetch(`/api/user-search?q=${encodeURIComponent(mentionQuery)}&scope=mygroups`, {
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
    }, [mentionQuery]);

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
      // mentionStart is in display-text coordinates — convert to raw
      const rawStart = displayPosToRawPos(mentionStart);
      const rawCursorPos = displayPosToRawPos(innerRef.current?.selectionStart ?? mentionStart + mentionQuery.length + 1);

      const before = value.slice(0, rawStart);
      const after = value.slice(rawCursorPos);
      const mention = `@[${user.name}](user:${user.id}) `;
      const newValue = before + mention + after;

      const nativeEvent = new Event("input", { bubbles: true });
      Object.defineProperty(nativeEvent, "target", {
        value: { value: newValue },
      });
      onChange(nativeEvent as unknown as React.ChangeEvent<HTMLTextAreaElement>);

      setOpen(false);
      setMentionQuery("");
      setMentionStart(-1);

      requestAnimationFrame(() => {
        const ta = innerRef.current;
        if (ta) {
          const newRawCursor = before.length + mention.length;
          const newDisplayCursor = rawPosToDisplayPos(newRawCursor);
          ta.selectionStart = newDisplayCursor;
          ta.selectionEnd = newDisplayCursor;
          ta.focus();
        }
      });
    }

    // When the user types in the display textarea, translate back to raw value changes
    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const newDisplayValue = e.target.value;

      // If there are no mentions in the raw value, display === raw, pass through
      if (!mentionPattern.test(value)) {
        onChange(e);
        return;
      }

      // Reconstruct raw value: figure out what changed in display and apply to raw
      // Simple approach: find the edit range in display text and apply the same edit to raw text
      const oldDisplay = displayValue;
      const ta = innerRef.current;
      const cursorPos = ta?.selectionStart ?? newDisplayValue.length;

      // Find common prefix and suffix between old and new display values
      let prefixLen = 0;
      while (prefixLen < oldDisplay.length && prefixLen < newDisplayValue.length && oldDisplay[prefixLen] === newDisplayValue[prefixLen]) {
        prefixLen++;
      }
      let suffixLen = 0;
      while (
        suffixLen < oldDisplay.length - prefixLen &&
        suffixLen < newDisplayValue.length - prefixLen &&
        oldDisplay[oldDisplay.length - 1 - suffixLen] === newDisplayValue[newDisplayValue.length - 1 - suffixLen]
      ) {
        suffixLen++;
      }

      const deletedDisplayLen = oldDisplay.length - prefixLen - suffixLen;
      const insertedText = newDisplayValue.slice(prefixLen, newDisplayValue.length - suffixLen);

      // Map display positions to raw positions
      const rawPrefixPos = displayPosToRawPos(prefixLen);
      const rawDeleteEnd = displayPosToRawPos(prefixLen + deletedDisplayLen);

      const newRawValue = value.slice(0, rawPrefixPos) + insertedText + value.slice(rawDeleteEnd);

      const nativeEvent = new Event("input", { bubbles: true });
      Object.defineProperty(nativeEvent, "target", {
        value: { value: newRawValue },
      });
      onChange(nativeEvent as unknown as React.ChangeEvent<HTMLTextAreaElement>);

      // Restore cursor position after React re-renders with new display value
      requestAnimationFrame(() => {
        if (ta) {
          ta.selectionStart = cursorPos;
          ta.selectionEnd = cursorPos;
        }
      });
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (open && results.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => Math.min(i + 1, results.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          // Dropdown open → Enter picks the highlighted result (or the first),
          // never falls through to submit a half-typed mention.
          e.preventDefault();
          e.stopPropagation();
          selectUser(results[activeIdx >= 0 ? activeIdx : 0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation(); // close only the dropdown, not a host popup
          setOpen(false);
          return;
        }
      }
      onKeyDown?.(e);
    }

    return (
      <div ref={wrapperRef} style={{ position: "relative" }}>
        <textarea
          ref={innerRef}
          value={displayValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          style={style}
          rows={rows}
          autoFocus={autoFocus}
        />
        {onSubmit && value.trim() && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            style={submitBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            {submitLabel} ↵
          </button>
        )}
        {open && results.length > 0 && (
          <div style={dropdownStyle}>
            {results.map((user, i) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  // Stop the event reaching host outside-click handlers (e.g.
                  // CommentPopup): selecting synchronously unmounts this button,
                  // so a document-level mousedown would see a detached target
                  // and wrongly treat the pick as an outside click.
                  e.stopPropagation();
                  selectUser(user);
                }}
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
);

const submitBtnStyle: React.CSSProperties = {
  display: "block",
  marginLeft: "auto",
  marginTop: "0.25rem",
  fontSize: "0.6rem",
  fontWeight: 600,
  letterSpacing: "0.05em",
  background: "none",
  border: "none",
  color: "var(--fg)",
  cursor: "pointer",
  padding: 0,
  opacity: 0.5,
  transition: "opacity var(--ease-out)",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  left: 0,
  right: 0,
  zIndex: "var(--z-dropdown)",
  background: "var(--bg)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-md)",
  marginBottom: "2px",
  maxHeight: "180px",
  overflowY: "auto",
  boxShadow: "var(--shadow-md)",
};
