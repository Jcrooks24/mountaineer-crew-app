/**
 * Admin DQ Files tab (C4.1b). A missing-docs board across drivers, and a
 * per-driver DQ file where the office uploads/replaces any document (including
 * the admin-filled road-test forms and scans on a driver's behalf).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import DqRoadTest from "./DqRoadTest";
import {
  loadDqOverview,
  loadDqFile,
  adminUploadDq,
  type DqOverview,
  type DqFile,
  type DqFileItem,
} from "../lib/dqStore";

// Admin-filled DQ types with an in-app form (C4.3). Others are upload-only.
const FILLABLE_ADMIN = new Set<string>(["road_test_form", "road_test_certificate"]);

export default function DqFilesTab() {
  const [overview, setOverview] = useState<DqOverview | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [file, setFile] = useState<DqFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState<string | null>(null);

  const refreshOverview = useCallback(async () => {
    try { setOverview(await loadDqOverview()); } catch { setErr("Could not load DQ overview."); }
  }, []);

  useEffect(() => { refreshOverview(); }, [refreshOverview]);

  const openDriver = async (userId: number) => {
    setSelected(userId);
    setFile(null);
    setErr(null);
    setLoading(true);
    try { setFile(await loadDqFile(userId)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Could not load this driver's file."); }
    finally { setLoading(false); }
  };

  const onUploaded = async () => {
    if (selected != null) { await loadDqFile(selected).then(setFile).catch(() => {}); }
    await refreshOverview();
  };

  if (selected != null) {
    if (filling && file) {
      return (
        <div className="card">
          <DqRoadTest
            variant={filling === "road_test_form" ? "form" : "certificate"}
            driverName={file.name || ""}
            userId={file.user_id}
            onDone={() => { setFilling(null); onUploaded(); }}
            onCancel={() => setFilling(null)}
          />
        </div>
      );
    }
    return (
      <div className="col" style={{ gap: 14 }}>
        <button type="button" onClick={() => { setSelected(null); setFile(null); }} style={{ alignSelf: "flex-start", fontSize: 13 }}>
          ← All drivers
        </button>
        {err && <div className="card" style={{ borderColor: "var(--danger)" }}><span style={{ color: "var(--danger)" }}>{err}</span></div>}
        {loading || !file ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : (
          <div className="card">
            <div className="microLabel" style={{ marginBottom: 4 }}>{file.name}</div>
            <div className="small" style={{ color: file.missing_required.length ? "var(--warn, #e0a800)" : "var(--ok)", marginBottom: 12 }}>
              {file.missing_required.length
                ? `${file.missing_required.length} required document${file.missing_required.length === 1 ? "" : "s"} missing`
                : "All required documents on file ✓"}
            </div>
            <div className="col" style={{ gap: 8 }}>
              {file.types.map((t) => (
                <DqRow
                  key={t.key}
                  item={t}
                  userId={file.user_id}
                  onUploaded={onUploaded}
                  fillable={FILLABLE_ADMIN.has(t.key)}
                  onFill={() => setFilling(t.key)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      {err && <div className="card" style={{ borderColor: "var(--danger)" }}><span style={{ color: "var(--danger)" }}>{err}</span></div>}
      <div className="card">
        <div className="microLabel" style={{ marginBottom: 10 }}>Driver DQ files</div>
        {!overview ? (
          <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : overview.drivers.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>No active drivers.</div>
        ) : (
          <div className="col" style={{ gap: 0 }}>
            {overview.drivers.map((d) => (
              <button
                key={d.user_id}
                type="button"
                onClick={() => openDriver(d.user_id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 8px", borderTop: "1px solid var(--border)", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}
              >
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span
                  className="chip"
                  style={{
                    fontSize: 11,
                    color: d.missing_count ? "var(--warn, #e0a800)" : "var(--ok)",
                    borderColor: d.missing_count ? "color-mix(in srgb, var(--warn, #e0a800) 30%, transparent)" : "color-mix(in srgb, var(--ok) 30%, transparent)",
                  }}
                >
                  {d.missing_count ? `${d.missing_count} missing` : "Complete"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DqRow({
  item,
  userId,
  onUploaded,
  fillable,
  onFill,
}: {
  item: DqFileItem;
  userId: number;
  onUploaded: () => void;
  fillable?: boolean;
  onFill?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    try { await adminUploadDq(f, userId, item.key); await onUploaded(); }
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
          <a href={item.document.drive_url || "#"} target="_blank" rel="noreferrer" className="small" style={{ color: "var(--brand2)" }}>
            View{item.document.submitted_at ? ` · filed ${item.document.submitted_at.slice(0, 10)}` : ""}
          </a>
        ) : (
          <span className="small" style={{ color: "var(--warn, #e0a800)" }}>Not on file</span>
        )}
        {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        {fillable && (
          <button type="button" onClick={onFill} disabled={busy} className="btnPrimary" style={{ fontSize: 12 }}>
            Fill in app
          </button>
        )}
        <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{ display: "none" }} />
        <button type="button" onClick={pick} disabled={busy} style={{ fontSize: 12 }}>
          {busy ? "Uploading…" : item.document ? "Replace" : "Upload"}
        </button>
      </div>
    </div>
  );
}
