import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import {
  newRequestUuid,
  submitFeatureRequest,
  uploadFeatureScreenshot,
  type FeatureRequestInput,
} from "../lib/featureRequestStore";

export default function RequestFeature() {
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
      setErr("Describe the feature before submitting.");
      return;
    }
    setBusy(true);
    setErr(null);
    // Screenshots are best-effort: a failure never blocks the request, which
    // always queues if the network is down.
    const urls: string[] = [];
    let failed = 0;
    for (const f of files) {
      try {
        urls.push(await uploadFeatureScreenshot(f));
      } catch {
        failed++;
      }
    }
    const payload: FeatureRequestInput = {
      request_uuid: newRequestUuid(),
      title: title.trim(),
      description: description.trim(),
      screenshot_urls: urls,
    };
    const { synced } = await submitFeatureRequest(payload);
    setBusy(false);
    setDone({ synced, uploaded: urls.length, failed });
  }

  if (done) {
    return (
      <div className="container">
        <AppHeader title="Request a Feature" onBack={() => nav("/tools")} />
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
            {done.synced ? "Thanks - request sent" : "Saved - it'll send when you're back online"}
          </div>
          <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            {done.synced
              ? "It'll be included in the nightly team email."
              : "Your request is queued on this device and syncs automatically."}
            {done.uploaded > 0 && ` ${done.uploaded} image${done.uploaded > 1 ? "s" : ""} attached.`}
            {done.failed > 0 && ` ${done.failed} image${done.failed > 1 ? "s" : ""} couldn't upload (needs a connection).`}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button
              className="btnPrimary"
              onClick={() => {
                setDone(null);
                setTitle("");
                setDescription("");
                setFiles([]);
              }}
            >
              Request another
            </button>
            <button onClick={() => nav("/tools")}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <AppHeader title="Request a Feature" onBack={() => nav("/tools")} />
      <div className="card">
        <div className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Have an idea for a new feature, or a change to one that exists? Tell us
          what you'd like and why it would help. Requests go to the team in the
          nightly email.
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="col">
            <div className="microLabel">Short title (optional)</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add a Weigh button to the timeline"
              maxLength={120}
            />
          </div>

          <div className="col">
            <div className="microLabel">What would you like</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you want, how you'd use it, and what it would replace or improve."
              rows={5}
            />
          </div>

          <div className="col">
            <div className="microLabel">Screenshots / mockups (optional)</div>
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
                      aria-label="Remove image"
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
            {busy ? "Sending…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
