/**
 * Short status messages from extensions, shown in the editor footer.
 *
 * An extension publishes a message with a browser event; the footer shows it
 * and removes it again. Using an event means an extension needs no import from
 * the host, and a host that lacks this file simply ignores the event.
 *
 *   window.dispatchEvent(new CustomEvent("loica:status", {
 *     cancelable: true,
 *     detail: { id: "languagetool", text: "Check unavailable", tone: "error" },
 *   }));
 *
 * The footer calls `preventDefault()` on the event when it displays the
 * message, so `dispatchEvent` returns false and the extension knows not to fall
 * back to its own notice.
 *
 *   id      one message per id: a new one replaces the previous; `text: null`
 *           clears it (call it when the problem goes away)
 *   text    what the footer shows (keep it short)
 *   title   optional longer explanation, shown as a tooltip
 *   tone    "error" (red, stays visible over "info") or "info" (default)
 *   ttlMs   remove after this long; without it the message stays until cleared
 */
import { useEffect, useState } from "react";

export const EXTENSION_STATUS_EVENT = "loica:status";

export type StatusTone = "info" | "error";

export interface ExtensionStatus {
  id: string;
  text: string | null;
  title?: string;
  tone?: StatusTone;
  ttlMs?: number;
}

export interface ActiveStatus {
  id: string;
  text: string;
  title?: string;
  tone: StatusTone;
  /** Epoch ms after which the message is dropped; null when it stays. */
  expiresAt: number | null;
  /** Arrival order, so the latest message can win. */
  seq: number;
}

/** Add, replace or (with empty text) remove the message for `status.id`. */
export function applyStatus(list: ActiveStatus[], status: ExtensionStatus, now: number, seq: number): ActiveStatus[] {
  const rest = list.filter((s) => s.id !== status.id);
  if (!status.text) {
    return rest;
  }

  return [
    ...rest,
    {
      id: status.id,
      text: status.text,
      title: status.title,
      tone: status.tone ?? "info",
      expiresAt: status.ttlMs ? now + status.ttlMs : null,
      seq,
    },
  ];
}

export function dropExpired(list: ActiveStatus[], now: number): ActiveStatus[] {
  return list.filter((s) => s.expiresAt === null || s.expiresAt > now);
}

/** The message to show: errors before info, then the most recent. */
export function visibleStatus(list: ActiveStatus[]): ActiveStatus | null {
  let best: ActiveStatus | null = null;
  for (const s of list) {
    const beats =
      !best ||
      (s.tone === "error" && best.tone !== "error") ||
      (s.tone === best.tone && s.seq > best.seq);
    if (beats) {
      best = s;
    }
  }
  return best;
}

const EXPIRY_SLACK_MS = 50;

/** Subscribe to extension messages; returns the one the footer should show. */
export function useExtensionStatus(): ActiveStatus | null {
  const [list, setList] = useState<ActiveStatus[]>([]);

  useEffect(() => {
    let seq = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function onStatus(event: Event) {
      const detail = (event as CustomEvent<ExtensionStatus>).detail;
      if (!detail || typeof detail.id !== "string") {
        return;
      }
      // Tell the sender the host is showing it.
      event.preventDefault();

      setList((prev) => applyStatus(prev, detail, Date.now(), ++seq));
      if (detail.text && detail.ttlMs) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          setList((prev) => dropExpired(prev, Date.now()));
        }, detail.ttlMs + EXPIRY_SLACK_MS);
        timers.add(timer);
      }
    }

    window.addEventListener(EXTENSION_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener(EXTENSION_STATUS_EVENT, onStatus);
      timers.forEach(clearTimeout);
    };
  }, []);

  return visibleStatus(list);
}
