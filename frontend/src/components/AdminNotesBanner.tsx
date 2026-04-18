import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { getAdminNotesSeenAt, markAdminNotesSeen } from "../lib/adminNotesSeen";

type AdminNote = {
  id: number;
  title: string;
  body: string;
  job_uuid: string | null;
  updated_at: string;
};

// Surfaces admin notes for a scope ("global" for landing-page notes, or a
// job_uuid for job-specific ones). Only renders when there are notes the
// current device hasn't acknowledged since their latest update. Clicking
// "Got it" marks the max updated_at as seen and hides the banner.
export default function AdminNotesBanner({ scope }: { scope: string }) {
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [unseen, setUnseen] = useState<AdminNote[]>([]);

  useEffect(() => {
    apiFetch<AdminNote[]>(`/api/admin-notes?scope=${encodeURIComponent(scope)}`)
      .then((rows) => {
        setNotes(rows);
        const seenAt = getAdminNotesSeenAt(scope);
        const cutoff = seenAt ? new Date(seenAt).getTime() : 0;
        setUnseen(rows.filter((n) => new Date(n.updated_at).getTime() > cutoff));
      })
      .catch(() => {/* non-fatal — no banner */});
  }, [scope]);

  if (unseen.length === 0) return null;

  function acknowledge() {
    const maxUpdatedAt = notes
      .map((n) => n.updated_at)
      .sort()
      .pop();
    if (maxUpdatedAt) markAdminNotesSeen(scope, maxUpdatedAt);
    setUnseen([]);
  }

  return (
    <div
      className="card"
      style={{
        border: "1px solid var(--brand)",
        background: "rgba(93,214,194,0.08)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--brand)" }}>
          {scope === "global" ? "New admin note" : "Note for this job"}
          {unseen.length > 1 ? ` · ${unseen.length}` : ""}
        </div>
        <button onClick={acknowledge} style={{ fontSize: 12 }}>Got it</button>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {unseen.map((n) => (
          <div key={n.id}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
            <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
