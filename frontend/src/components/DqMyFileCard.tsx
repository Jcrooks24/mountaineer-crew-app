/**
 * The driver's own DQ file (C4.1c), shown in Profile. The driver uploads the
 * documents they are responsible for; office-filed documents (road test) are
 * view-only here. In-app fillable forms come later; for now a driver uploads a
 * scan/photo or a filled PDF.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMyDqFile, uploadMyDq, type DqFile, type DqFileItem } from "../lib/dqStore";
import DqCertViolationsForm from "./DqCertViolationsForm";
import DqEmploymentAppForm from "./DqEmploymentAppForm";

// Driver-audience DQ types with an in-app fillable form. Others are upload-only.
const FILLABLE = new Set<string>(["annual_cert_violations", "employment_application"]);

export default function DqMyFileCard() {
  const [file, setFile] = useState<DqFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filling, setFilling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setFile(await loadMyDqFile()); setErr(null); }
    catch { setErr("Could not load your DQ file."); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (err) {
    return (
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 8 }}>DQ file</div>
        <div className="small" style={{ color: "var(--muted)" }}>{err}</div>
      </div>
    );
  }
  if (!file) {
    return (
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 8 }}>DQ file</div>
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }
  // No Driver tag, no DQ obligation (49 CFR 391 applies to drivers). Hide the
  // card entirely rather than show an empty file: a mover who never drives does
  // not need a medical card, and a "DQ file" card on their Profile is a standing
  // question they cannot answer. Older builds of the API do not send the flag,
  // so an absent value keeps the previous behavior instead of hiding the card
  // from real drivers.
  if (file.is_driver === false) return null;

  if (filling === "annual_cert_violations") {
    return (
      <div className="card">
        <DqCertViolationsForm
          driverName={file.name || ""}
          onDone={() => { setFilling(null); refresh(); }}
          onCancel={() => setFilling(null)}
        />
      </div>
    );
  }
  if (filling === "employment_application") {
    return (
      <div className="card">
        <DqEmploymentAppForm
          driverName={file.name || ""}
          onDone={() => { setFilling(null); refresh(); }}
          onCancel={() => setFilling(null)}
        />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 4 }}>DQ file</div>
      <div className="small" style={{ color: file.missing_required.length ? "var(--warn, #e0a800)" : "var(--ok)", marginBottom: 12 }}>
        {file.missing_required.length
          ? `You still need: ${file.missing_required.join(", ")}`
          : "Your required documents are on file ✓"}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {file.types.map((t) => (
          <MyDqRow
            key={t.key}
            item={t}
            onUploaded={refresh}
            fillable={t.audience === "driver" && FILLABLE.has(t.key)}
            onFill={() => setFilling(t.key)}
          />
        ))}
      </div>
    </div>
  );
}

function MyDqRow({
  item,
  onUploaded,
  fillable,
  onFill,
}: {
  item: DqFileItem;
  onUploaded: () => void;
  fillable?: boolean;
  onFill?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = item.audience === "driver";

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    try { await uploadMyDq(f, item.key); await onUploaded(); }
    catch (ex: any) { setErr(ex?.message ?? "Upload failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
      <div className="col" style={{ gap: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {item.name}
          {item.required && <span className="small" style={{ color: "var(--muted)", fontWeight: 400 }}> · required</span>}
        </span>
        {item.document ? (
          <>
            <a href={item.document.drive_url || "#"} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand2)" }}>
              View{item.document.submitted_at ? ` · filed ${item.document.submitted_at.slice(0, 10)}` : ""}
            </a>
            {item.renewal_due && (
              <span className="small" style={{ color: "var(--warn, #e0a800)", fontWeight: 700 }}>
                Renewal due{item.due_date ? ` (expires ${item.due_date})` : ""} - re-file
              </span>
            )}
          </>
        ) : mine ? (
          <span className="small" style={{ color: "var(--warn, #e0a800)" }}>Not submitted yet</span>
        ) : (
          // Admin-audience (office-filed) doc that isn't on file yet - the driver
          // can't upload it, so tell them to get it scheduled.
          <span className="small" style={{ color: "var(--warn, #e0a800)" }}>
            Not on file - ask the office to schedule your road test
          </span>
        )}
        {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
      {mine && (
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {fillable && (
            <button type="button" onClick={onFill} disabled={busy} className="btnPrimary" style={{ fontSize: 12 }}>
              Fill in app
            </button>
          )}
          <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{ display: "none" }} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ fontSize: 12 }}>
            {busy ? "Uploading…" : item.document ? "Replace" : "Upload"}
          </button>
        </div>
      )}
    </div>
  );
}
