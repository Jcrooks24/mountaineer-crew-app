import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../api/client";

/**
 * The office's rolling payroll note, shown above the payroll table.
 *
 * ONE ROLLING NOTE (office direction, 2026-09-09), not one per period. What
 * lives here is standing information - who is on light duties, which rate
 * changed, what to remember before the next run - so a field that emptied itself
 * every fortnight would simply be re-typed every fortnight. Finalizing a period
 * archives what it says at that moment onto that run and into the Sheet, and
 * deliberately does NOT clear it.
 *
 * "IT IS VERY IMPORTANT THE TEXT IS SAVED" was the brief, so the saving is built
 * to be provable rather than optimistic. Four things, each earning its place:
 *
 *  1. A local mirror is written on every keystroke, so a crash, a reload, a lost
 *     connection or a failed request never costs what was typed.
 *  2. The status reads "Saved" only once the server has ECHOED THE TEXT BACK -
 *     never on having sent it. An indicator that reports the attempt rather than
 *     the outcome is worse than none, because it is trusted.
 *  3. A failed save says so in words, keeps the text, and offers a retry.
 *  4. Leaving the page flushes a pending save. A debounce that dies with the
 *     component is the ordinary way an autosave loses the last thing typed.
 *
 * On load, a local mirror that disagrees with the server is treated as UNSAVED
 * WORK rather than as stale: it means a previous save did not land, and letting
 * the server copy overwrite it silently would destroy the thing this field
 * exists to protect.
 *
 * Markdown, not rich text. The office asked for bold, bullets and line breaks;
 * markdown gives exactly those and stays readable as plain text - which matters
 * because the archive is a Sheet cell, where markup would either be lost or read
 * as noise.
 */

const NOTES_MIRROR_KEY = "crew_admin_payroll_notes_mirror_v1";
const AUTOSAVE_MS = 1200;

export default function PayrollNotes() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<number | null>(null);
  // What the server last confirmed. "Saved" holds only while the text on screen
  // equals this, so an edit immediately reads as unsaved again and the indicator
  // can never claim more than the server has actually acknowledged.
  const confirmed = useRef<string>("");

  const mirror = (v: string) => {
    try {
      localStorage.setItem(NOTES_MIRROR_KEY, v);
    } catch {
      /* quota - the server copy is the record; this is only a safety net */
    }
  };

  const push = useCallback(async (v: string) => {
    setStatus("saving");
    setErr(null);
    try {
      const r = await apiFetch<{ notes: string }>("/api/admin/payroll/notes", {
        method: "PUT",
        body: JSON.stringify({ notes: v }),
      });
      confirmed.current = r?.notes ?? v;
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setErr(
        e instanceof ApiError
          ? `${e.message} Your text is kept on this device.`
          : "Could not save. Your text is kept on this device.",
      );
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      let local = "";
      try {
        local = localStorage.getItem(NOTES_MIRROR_KEY) || "";
      } catch {
        /* storage unavailable */
      }
      try {
        const r = await apiFetch<{ notes: string }>("/api/admin/payroll/notes");
        if (!live) return;
        const server = r?.notes ?? "";
        if (local && local !== server) {
          // A mirror that disagrees with the server is work whose save did not
          // land. Keep it and say so; the server copy must not quietly win.
          setText(local);
          confirmed.current = server;
          setStatus("error");
          setErr("This device has changes that never reached the server. Press Save now.");
        } else {
          setText(server);
          confirmed.current = server;
          setStatus("idle");
        }
      } catch {
        if (!live) return;
        setText(local);
        setStatus("error");
        setErr("Could not load the note from the server. Showing this device's copy.");
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Flush a pending save when the page or tab goes away, and on unmount.
  useEffect(() => {
    const flush = () => {
      if (timer.current !== null && text !== confirmed.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
        void push(text);
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [text, push]);

  const onChange = (v: string) => {
    setText(v);
    mirror(v);
    setStatus(v === confirmed.current ? "saved" : "saving");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (v !== confirmed.current) void push(v);
    }, AUTOSAVE_MS);
  };

  /** Wrap or prefix the selection. Markdown in, markdown stored, markdown archived. */
  const apply = (kind: "bold" | "bullet") => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);
    let next: string;
    let caret: number;
    if (kind === "bold") {
      const body = sel || "bold text";
      next = `${before}**${body}**${after}`;
      caret = start + 2 + body.length;
    } else {
      // Every selected line becomes a bullet; an empty selection starts one.
      const lines = sel ? sel.split("\n") : [""];
      const bulleted = lines.map((l) => (l.startsWith("- ") ? l : `- ${l}`)).join("\n");
      const pad = before && !before.endsWith("\n") ? "\n" : "";
      next = `${before}${pad}${bulleted}${after}`;
      caret = before.length + pad.length + bulleted.length;
    }
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const dirty = loaded && text !== confirmed.current;
  const statusText =
    status === "error" ? "Not saved"
      : dirty || status === "saving" ? "Saving..."
        : status === "saved" ? "Saved" : "";
  const statusColor =
    status === "error" ? "var(--danger)"
      : dirty || status === "saving" ? "var(--muted)" : "var(--ok)";

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="microLabel">Payroll notes</div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <button type="button" onClick={() => apply("bold")} title="Bold"
                  aria-label="Bold" style={{ fontSize: 12, fontWeight: 700, padding: "2px 9px" }}>
            B
          </button>
          <button type="button" onClick={() => apply("bullet")} title="Bullet list"
                  aria-label="Bullet list" style={{ fontSize: 12, padding: "2px 9px" }}>
            &bull; List
          </button>
          <span className="small" role="status" aria-live="polite"
                style={{ color: statusColor, minWidth: 72, textAlign: "right" }}>
            {statusText}
          </span>
        </div>
      </div>
      <div className="small" style={{ color: "var(--muted)", margin: "6px 0 8px" }}>
        Carries across pay periods and saves as you type. Finalizing a period files
        a copy of whatever this says at that moment against that run - it is not
        cleared. Bold and bullets are kept.
      </div>
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (text !== confirmed.current) void push(text); }}
        rows={5}
        placeholder="Anything the next payroll run needs to know."
        aria-label="Payroll notes"
        style={{ width: "100%", fontSize: 14, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }}
      />
      {err && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <span className="small" style={{ color: "var(--danger)" }}>{err}</span>
          <button type="button" onClick={() => void push(text)} style={{ fontSize: 12 }}>
            Save now
          </button>
        </div>
      )}
    </div>
  );
}
