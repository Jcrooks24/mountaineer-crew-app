/**
 * A brief confirmation message, bottom of the screen.
 *
 * Built for one reported problem: the Actions timeline now lives behind a
 * Timeline button, so tapping "Depart" gave no visible sign that anything had
 * happened. The crew member could not see the list the event had just been added
 * to, so the only feedback was a button that briefly said "...".
 *
 * Deliberately says the event was ADDED, not synced. An event is written to the
 * device first and reaches the server whenever there is signal - that is the
 * whole offline-first design - so claiming it was sent would be a lie on a job
 * site with no bars, which is exactly where crews work. "Added to timeline" is
 * true the moment it is saved locally.
 */
import { useEffect, useRef, useState } from "react";

export type ToastMessage = { id: number; text: string };

/** How long a message stays up. Long enough to read one line while putting a
 *  phone back in a pocket, short enough not to sit over the next tap. */
const TOAST_MS = 2600;

export function Toast({
  message,
  onDone,
}: {
  message: ToastMessage | null;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!message) return;
    setShown(true);
    if (timer.current) window.clearTimeout(timer.current);
    // Keyed on message.id, so a second event tapped while the first toast is up
    // restarts the timer with the new text rather than the new message
    // inheriting the old one's remaining time and vanishing early.
    timer.current = window.setTimeout(() => {
      setShown(false);
      onDone();
    }, TOAST_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [message?.id]);

  if (!message) return null;

  return (
    <div
      // polite, not assertive: this confirms something the crew member just did
      // on purpose. It should be announced without interrupting them.
      role="status"
      aria-live="polite"
      onClick={() => { setShown(false); onDone(); }}
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        // Clears the bottom nav (56px + its safe-area padding). The nav is fixed
        // and always on top of this screen, so anchoring at 0 would put the
        // confirmation underneath it.
        bottom: "calc(72px + env(safe-area-inset-bottom))",
        zIndex: 60,
        margin: "0 auto",
        maxWidth: 420,
        padding: "10px 14px",
        borderRadius: 10,
        background: "var(--card)",
        border: "1px solid var(--ok)",
        color: "var(--text)",
        fontSize: 14,
        fontWeight: 600,
        textAlign: "center",
        boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(8px)",
        transition: "opacity .18s, transform .18s",
        pointerEvents: shown ? "auto" : "none",
        cursor: "pointer",
      }}
    >
      {message.text}
    </div>
  );
}

/** Crew-facing name for an event type.
 *
 *  The timeline stores terse verbs ("DEPART"); the confirmation should read the
 *  way a person would say it. Unknown types fall back to the raw value rather
 *  than to a generic word, so a new event type shows up as itself instead of
 *  silently reading "Event added" and looking like it did the wrong thing. */
const EVENT_LABELS: Record<string, string> = {
  ARRIVE: "Arrival",
  DEPART: "Departure",
  START: "Start",
  FINISH: "Finish",
  NOTE: "Note",
  WEIGHT: "Loaded weight",
  BREAK_START: "Break start",
  BREAK_END: "Break end",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] || type;
}

/** "Departure at 3:04 PM added to timeline". */
export function timelineAddedMessage(type: string, iso: string): string {
  // An unparseable date must drop the time, not print it. `new Date("nonsense")`
  // does NOT throw - it yields an Invalid Date whose toLocaleTimeString is the
  // literal string "Invalid Date", so a try/catch here catches nothing and the
  // crew member reads "Departure at Invalid Date added to timeline". Check the
  // time value instead.
  let when = "";
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    when = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return `${eventLabel(type)}${when ? ` at ${when}` : ""} added to timeline`;
}
