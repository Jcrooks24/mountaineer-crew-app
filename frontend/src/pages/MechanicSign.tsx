import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useResolvedLogo } from "../theme/ThemeContext";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";

// Public page - a mechanic with no app account opens this from an emailed
// link to remotely sign off a defective DVIR. Auth is the token in the URL.

type MechanicReview = {
  dvir_id: string;
  vehicle_number: string;
  trailer_number: string | null;
  odometer: number | null;
  inspection_type: string;
  inspection_date: string;
  defects: string[];
  defect_notes: string | null;
  condition: string;
  driver_name: string;
  created_at: string;
  already_signed: boolean;
  needs_mechanic_review: boolean;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

export default function MechanicSign() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { src: logo, variant: logoVariant } = useResolvedLogo();

  const [review, setReview] = useState<MechanicReview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mechanicName, setMechanicName] = useState("");
  const [repairsMade, setRepairsMade] = useState<boolean | null>(null);
  const [mechanicNotes, setMechanicNotes] = useState("");
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadErr("This link is missing its signature token.");
      setLoading(false);
      return;
    }
    apiFetch<MechanicReview>(`/api/dvir/mechanic-sign/review?token=${encodeURIComponent(token)}`)
      .then((r) => setReview(r))
      .catch((e: any) =>
        setLoadErr(
          e instanceof ApiError ? e.message : "Could not load this inspection report.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!mechanicName.trim()) return setErr("Mechanic name is required.");
    if (repairsMade === null) return setErr("Please indicate whether repairs were made.");
    if (sigRef.current?.isEmpty()) return setErr("Signature is required - please sign above.");

    setBusy(true);
    try {
      await apiFetch(`/api/dvir/mechanic-sign/submit?token=${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify({
          mechanic_name: mechanicName.trim(),
          mechanic_signature: sigRef.current!.toDataURL(),
          repairs_made: repairsMade,
          mechanic_notes: mechanicNotes.trim() || null,
        }),
      });
      setDone(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to submit signature.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 40, marginBottom: 12, gap: 10 }}>
        <img
          src={logo}
          alt="Logo"
          style={{
            width: 48, height: 48, borderRadius: 14, objectFit: "contain",
            filter: logoVariant === "light" ? "invert(1) brightness(1.15) contrast(1.05)" : undefined,
          }}
        />
        <div style={{ fontWeight: 900, fontSize: 18 }}>Mountaineer Moving Co.</div>
        <div className="small" style={{ color: "var(--muted)" }}>Mechanic Vehicle Sign-Off</div>
      </div>

      {loading && (
        <div className="card">
          <div className="small" style={{ color: "var(--muted)" }}>Loading inspection report…</div>
        </div>
      )}

      {!loading && loadErr && (
        <div className="card">
          <div className="small" style={{ color: "var(--danger)" }}>{loadErr}</div>
          <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
            If you believe this is a mistake, contact Mountaineer Moving for a fresh link.
          </div>
        </div>
      )}

      {!loading && review && done && (
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "var(--ok)", marginBottom: 6 }}>
            Sign-Off Recorded
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            Vehicle <strong>{review.vehicle_number}</strong> is cleared to return to service.
            You can close this page.
          </div>
        </div>
      )}

      {!loading && review && !done && review.already_signed && (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, color: "var(--ok)", marginBottom: 6 }}>
            ✓ Already Signed
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            This inspection report for <strong>{review.vehicle_number}</strong> has already been
            signed off. No further action is needed.
          </div>
        </div>
      )}

      {!loading && review && !done && !review.already_signed && !review.needs_mechanic_review && (
        <div className="card">
          <div className="label" style={{ fontWeight: 700, color: "var(--ok)", marginBottom: 6 }}>
            No Review Required
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            This inspection has no defects - the vehicle is already cleared.
          </div>
        </div>
      )}

      {!loading && review && !done && !review.already_signed && review.needs_mechanic_review && (
        <>
          {/* DVIR summary */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {review.vehicle_number}
              {review.trailer_number ? ` / Trailer ${review.trailer_number}` : ""}
            </div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
              {review.inspection_type === "pre-trip" ? "Pre-Trip" : "Post-Trip"} · {review.inspection_date}
              {review.odometer ? ` · Odometer: ${review.odometer.toLocaleString()} mi` : ""}
            </div>

            {review.defects.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Defects:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {review.defects.map((d) => (
                    <span key={d} className="chip" style={{ background: "rgba(255,107,107,0.12)", color: "var(--danger)" }}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {review.defect_notes && (
              <div style={{ marginBottom: 8 }}>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 2 }}>Defect Notes:</div>
                <div style={{ fontSize: 13 }}>{review.defect_notes}</div>
              </div>
            )}

            <div className="small" style={{ color: "var(--muted)" }}>
              Reported by: {review.driver_name}
            </div>
          </div>

          {/* Sign form */}
          <div className="card">
            <div className="label" style={{ fontWeight: 700, marginBottom: 4 }}>Mechanic Approval</div>
            <p className="small" style={{ color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
              By signing below you certify the above defects have been repaired or do not
              require repair, and that the vehicle is safe to return to service.
            </p>

            <form onSubmit={handleSign} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Name *</div>
                <input
                  value={mechanicName}
                  onChange={(e) => setMechanicName(e.target.value)}
                  placeholder="Full name"
                  style={inputStyle}
                />
              </div>

              <div>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Repairs *</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {[
                    { label: "Repairs Made", value: true },
                    { label: "No Repair Needed", value: false },
                  ].map(({ label, value }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setRepairsMade(value)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        border: repairsMade === value ? "2px solid var(--brand)" : "1px solid var(--border)",
                        background: repairsMade === value ? "rgba(93,214,194,0.12)" : "var(--card)",
                        color: repairsMade === value ? "var(--brand)" : "var(--muted)",
                        cursor: "pointer",
                        fontWeight: repairsMade === value ? 700 : 400,
                        fontSize: 13,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Mechanic Notes</div>
                <textarea
                  value={mechanicNotes}
                  onChange={(e) => setMechanicNotes(e.target.value)}
                  placeholder="Optional notes on repairs or inspection…"
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div>
                <div className="small" style={{ color: "var(--muted)", marginBottom: 6 }}>Signature * - sign below</div>
                <SignaturePad ref={sigRef} height={150} />
                <button
                  type="button"
                  onClick={() => sigRef.current?.clear()}
                  style={{ marginTop: 6, background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
                >
                  Clear signature
                </button>
              </div>

              {err && (
                <div style={{ color: "var(--danger)", fontSize: 13, padding: "8px 12px", background: "rgba(255,107,107,0.1)", borderRadius: 8 }}>
                  {err}
                </div>
              )}

              <button type="submit" className="btnPrimary" disabled={busy}>
                {busy ? "Submitting…" : "Approve & Sign"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
