import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import {
  newBugUuid,
  submitBugReport,
  uploadBugScreenshot,
  type BugReportInput,
} from "../lib/bugReportStore";

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ReportBug() {
  const nav = useNavigate();
  const [description, setDescription] = useState("");
  const [occurredDate, setOccurredDate] = useState(todayLocal());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { synced: boolean; uploaded: number; failed: number }>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imgs]);
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!description.trim()) {
      setErr("Describe the bug before submitting.");
      return;
    }
    setBusy(true);
    setErr(null);
    // Screenshots are best-effort: upload each to Drive; a failure never blocks
    // the report itself, which always queues if the network is down.
    const urls: string[] = [];
    let failed = 0;
    for (const f of files) {
      try {
        urls.push(await uploadBugScreenshot(f, occurredDate));
      } catch {
        failed++;
      }
    }
    const payload: BugReportInput = {
      bug_uuid: newBugUuid(),
      description: description.trim(),
      occurred_date: occurredDate,
      screenshot_urls: urls,
    };
    const { synced } = await submitBugReport(payload);
    setBusy(false);
    setDone({ synced, uploaded: urls.length, failed });
  }

  if (done) {
    return (
      <div className="container">
        <AppHeader title="Report a Bug" onBack={() => nav("/tools")} />
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
            {done.synced ? "Thanks - bug report sent" : "Saved - it'll send when you're back online"}
          </div>
          <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            {done.synced
              ? "It'll be included in the nightly team email."
              : "Your report is queued on this device and syncs automatically."}
            {done.uploaded > 0 && ` ${done.uploaded} screenshot${done.uploaded > 1 ? "s" : ""} attached.`}
            {done.failed > 0 && ` ${done.failed} screenshot${done.failed > 1 ? "s" : ""} couldn't upload (needs a connection).`}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button
              className="btnPrimary"
              onClick={() => {
                setDone(null);
                setDescription("");
                setFiles([]);
                setOccurredDate(todayLocal());
              }}
            >
              Report another
            </button>
            <button onClick={() => nav("/tools")}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <AppHeader title="Report a Bug" onBack={() => nav("/tools")} />
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Found something broken or confusing in the app? Tell us what happened and
          attach a screenshot if you have one. Reports go to the team in the nightly email.
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="col">
            <div className="microLabel">What went wrong</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you were doing, what you expected, and what happened instead."
              rows={5}
            />
          </div>

          <div className="col">
            <div className="microLabel">Date it happened</div>
            <input type="date" value={occurredDate} max={todayLocal()} onChange={(e) => setOccurredDate(e.target.value)} />
          </div>

          <div className="col">
            <div className="microLabel">Screenshots (optional)</div>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={URL.createObjectURL(f)}
                      alt=""
                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label="Remove screenshot"
                      style={{
                        position: "absolute", top: -6, right: -6, width: 20, height: 20,
                        borderRadius: "50%", border: "none", background: "var(--danger)",
                        color: "#fff", cursor: "pointer", fontSize: 12, lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

          <button className="btnPrimary" disabled={busy} onClick={submit}>
            {busy ? "Sending…" : "Submit bug report"}
          </button>
        </div>
      </div>
    </div>
  );
}
