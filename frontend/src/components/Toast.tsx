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

/** How long a toast should stay up to be READ, given how much it says.
 *
 *  A fixed 2.6s is right for "Departure added to timeline" and wrong for a
 *  paragraph explaining what released-value liability means: the crew member
 *  reads three words, the toast goes, and they have to tap again. So the
 *  duration follows the length - three seconds to begin with, and three more for
 *  every ten words on top of that.
 *
 *  Ten words per three seconds is about 200 words a minute, which is ordinary
 *  adult reading speed, and the flat three seconds on top covers noticing the
 *  toast at all before starting to read. Generous on purpose: this is somebody
 *  standing in a driveway on a phone, not at a desk.
 *
 *  Exported so the value shown on screen and the value the timer uses are the
 *  same number. Two of them would eventually disagree, and the progress bar
 *  would be lying about when the toast goes away. */
export function readingTimeMs(text: string): number {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return 3000 + Math.floor(words / 10) * 3000;
}

export function Toast({
  message,
  onDone,
  durationMs,
  align = "center",
  showProgress = false,
}: {
  message: ToastMessage | null;
  onDone: () => void;
  /** Defaults to the short confirmation timing. Pass `readingTimeMs(text)` for
   *  anything long enough to actually read. */
  durationMs?: number;
  /** Confirmations are one centered line; prose reads better left-aligned. */
  align?: "center" | "left";
  /** A depleting bar along the bottom. Worth it only when the toast is up long
   *  enough for somebody to wonder whether it is stuck - see the note where it
   *  is rendered. */
  showProgress?: boolean;
}) {
  const [shown, setShown] = useState(false);
  // Drives the progress bar. Starts full, then transitions to empty over
  // exactly `ms`, so what the bar shows and what the timer does are one number.
  const [draining, setDraining] = useState(false);
  const timer = useRef<number | null>(null);
  const ms = durationMs ?? TOAST_MS;

  useEffect(() => {
    if (!message) return;
    setShown(true);
    // Two frames: the bar has to paint at full width once before the transition
    // to zero is applied, or the browser collapses it instantly with no
    // animation. A single rAF is not always enough on a cold render.
    setDraining(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDraining(true)));
    if (timer.current) window.clearTimeout(timer.current);
    // Keyed on message.id, so a second event tapped while the first toast is up
    // restarts the timer with the new text rather than the new message
    // inheriting the old one's remaining time and vanishing early.
    timer.current = window.setTimeout(() => {
      setShown(false);
      onDone();
    }, ms);
    return () => {
      cancelAnimationFrame(raf);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [message?.id, ms]);

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
        fontWeight: align === "center" ? 600 : 400,
        lineHeight: align === "center" ? undefined : 1.45,
        textAlign: align,
        overflow: "hidden",
        boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(8px)",
        transition: "opacity .18s, transform .18s",
        pointerEvents: shown ? "auto" : "none",
        cursor: "pointer",
      }}
    >
      {message.text}
      {showProgress && (
        // WHY THIS EXISTS. A long help toast has no close button, so without
        // something moving on screen a crew member has no way to tell "this will
        // go away in a moment" from "this is stuck and the app is broken". The
        // bar is the answer to that question and nothing else, so it is
        // deliberately quiet: a hairline in the muted colour, no percentage, no
        // countdown number.
        //
        // aria-hidden because a screen reader gets the text read to it by
        // role="status" and a draining bar tells it nothing; the timing is a
        // visual affordance only.
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: "transparent",
          }}
        >
          <div
            style={{
              height: "100%",
              width: draining ? "0%" : "100%",
              background: "var(--muted)",
              opacity: 0.5,
              // Linear, not eased: an eased bar looks like it stalls near the
              // end, which is the exact impression this exists to prevent.
              transition: `width ${ms}ms linear`,
            }}
          />
        </div>
      )}
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
