import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import type { DirectoryEntry } from "../auth/AuthContext";
import {
  currentDirectory,
  ensureDirectory,
  subscribeDirectory,
} from "../lib/userDirectory";
import { compareBySurname } from "../lib/nameSort";

/**
 * Look up a colleague's phone number or email.
 *
 * CURRENT EMPLOYEES ONLY (user direction, 2026-09-04). The directory endpoint
 * filters on `is_active`, and there is no archive concept in this app - the
 * roster action is Revoke / Restore - so "current" and "not revoked" are the
 * same test. Somebody who left and was never revoked still appears here, which
 * is a roster hygiene problem rather than something to paper over on this page.
 *
 * It reads the SAME cached roster the rest of the app already keeps
 * (`userDirectory`), rather than fetching its own list. That roster is
 * load-bearing - employee hours are keyed on it and it is cached so a crew
 * member with no signal can still log hours - so this page works offline for
 * free, and adding a second fetch of the same data would only create a way for
 * the two to disagree.
 *
 * `phone` is optional on purpose: a roster cached by a build older than this
 * feature has no phone field at all, so "no phone on file" has to be a real
 * state rather than a crash.
 */
export default function EmployeeDirectory() {
  // Same cached-first pattern the roster picker uses: seed from the store
  // (which itself seeds from localStorage), revalidate in the background, and
  // re-render when it changes. An offline launch has a usable directory at once.
  const [roster, setRoster] = useState<DirectoryEntry[]>(() => currentDirectory());
  const [q, setQ] = useState("");

  useEffect(() => {
    ensureDirectory().catch(() => { /* offline - the cached roster stands */ });
    return subscribeDirectory(() => setRoster(currentDirectory()));
  }, []);

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? roster.filter((p) => {
          const name = (p.name || "").toLowerCase();
          const email = (p.email || "").toLowerCase();
          // Digits only, so "555 0134", "(555) 0134" and "5550134" all match.
          const phone = (p.phone || "").replace(/\D/g, "");
          const needleDigits = needle.replace(/\D/g, "");
          return (
            name.includes(needle) ||
            email.includes(needle) ||
            (needleDigits.length >= 3 && phone.includes(needleDigits))
          );
        })
      : roster;
    // By LAST name, matching the admin roster and the payroll page. Sorting on
    // the whole string puts everyone in first-name order, which is not how
    // anybody looks a person up.
    return [...matched].sort(compareBySurname);
  }, [roster, q]);

  return (
    <div className="page">
      <AppHeader title="Employee Directory" />
      <div className="col" style={{ gap: 12, padding: "0 12px 24px" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search the employee directory"
          // 16px or iOS zooms the whole page when this is focused.
          style={{ width: "100%", fontSize: 16, minHeight: 44 }}
        />

        {roster.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>
            The roster has not loaded yet. It caches after your first time online,
            and then this page works without signal.
          </div>
        ) : people.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>
            Nobody matches "{q.trim()}".
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {people.map((p) => (
              <div key={p.id} className="card" style={{ padding: "10px 12px" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {p.name || p.email}
                </div>
                <div className="col" style={{ gap: 2, marginTop: 4 }}>
                  {p.phone ? (
                    // tel: and mailto: rather than plain text. This is opened on
                    // a phone, usually because somebody needs to call the person
                    // right now.
                    <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                       className="small" style={{ color: "var(--brand)" }}>
                      {p.phone}
                    </a>
                  ) : (
                    <span className="small" style={{ color: "var(--muted)" }}>
                      No phone on file
                    </span>
                  )}
                  <a href={`mailto:${p.email}`} className="small"
                     style={{ color: "var(--brand)", wordBreak: "break-all" }}>
                    {p.email}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="small" style={{ color: "var(--muted)" }}>
          Current employees only. If somebody is missing or their number is wrong,
          the office maintains this on the roster.
        </div>
      </div>
    </div>
  );
}
