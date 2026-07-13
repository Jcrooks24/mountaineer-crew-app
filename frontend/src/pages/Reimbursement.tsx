import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BetaTag } from "../components/BetaTag";
import {
  discardFailed,
  enqueueExpense,
  enqueueMileage,
  EXPENSE_CATEGORIES,
  fetchHistory,
  newReimbursementUuid,
  renderedRows,
  retryFailed,
  syncQueue,
  type PaymentMethod,
  type ReimbursementRow,
} from "../lib/reimbursementStore";

function todayLocalIso(): string {
  // Local-day "YYYY-MM-DD" - toISOString would shift past midnight UTC for
  // crew on the western side of the country, putting "yesterday" in the
  // picker when they open the form first thing in the morning.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Mode = "mileage" | "expense";

export default function Reimbursement() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState<Mode>("mileage");
  const [rows, setRows] = useState<ReimbursementRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Mileage form state
  const [odoStart, setOdoStart] = useState("");
  const [odoEnd, setOdoEnd] = useState("");
  const [odoStartFile, setOdoStartFile] = useState<File | null>(null);
  const [odoEndFile, setOdoEndFile] = useState<File | null>(null);

  // Expense form state
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("personal");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // Shared
  const [notes, setNotes] = useState("");
  // Date the expense / mileage actually happened - defaults to today, but
  // crew often log on a different day (e.g. submitting the next morning).
  const [expenseDate, setExpenseDate] = useState<string>(todayLocalIso());
  const odoStartRef = useRef<HTMLInputElement>(null);
  const odoEndRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setRows(await renderedRows());
  }

  async function handleRetry(uuid: string) {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      await retryFailed(uuid);
      await fetchHistory();
      await refresh();
      // renderedRows() is the truth here: if it still shows the row as failed, the
      // server rejected it a second time and the reason under it is now the fresh
      // one. Claiming success would be a lie the crew member pays for later.
      const still = (await renderedRows()).find((r) => r.reimbursement_uuid === uuid);
      if (still?.status === "failed") {
        setErr("Still not accepted. See the reason on the submission below.");
      } else {
        setOk("Submission sent.");
      }
    } catch (e: any) {
      setErr(e?.message || "Could not send it. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard(uuid: string) {
    // Deleting a submission destroys its odometer/receipt photos, which exist
    // nowhere else. Never do it on a single tap.
    if (!window.confirm("Delete this submission? Its photos are only on this phone and cannot be recovered.")) {
      return;
    }
    setBusy(true);
    try {
      await discardFailed(uuid);
      await refresh();
      setOk("Submission deleted.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      await refresh();
      await syncQueue();
      await fetchHistory();
      await refresh();
    })();

    function onOnline() {
      (async () => {
        const drained = await syncQueue();
        const refreshed = await fetchHistory();
        if (drained || refreshed) refresh();
      })();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function clearMileage() {
    setOdoStart("");
    setOdoEnd("");
    setOdoStartFile(null);
    setOdoEndFile(null);
    if (odoStartRef.current) odoStartRef.current.value = "";
    if (odoEndRef.current) odoEndRef.current.value = "";
  }
  function clearExpense() {
    setAmount("");
    setCategory("");
    setVendor("");
    setPaymentMethod("personal");
    setReceiptFile(null);
    if (receiptRef.current) receiptRef.current.value = "";
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);
    setOk(null);

    if (mode === "mileage") {
      // Fields are all optional - crew can submit a partial request and
      // the admin follows up. Only block a completely empty form, and a
      // genuine reading inversion (both numbers present, end < start).
      const start = odoStart.trim() === "" ? null : Math.floor(Number(odoStart));
      const end = odoEnd.trim() === "" ? null : Math.floor(Number(odoEnd));
      if (start !== null && !Number.isFinite(start)) {
        setErr("Start odometer must be a number."); return;
      }
      if (end !== null && !Number.isFinite(end)) {
        setErr("End odometer must be a number."); return;
      }
      if (start !== null && end !== null && end < start) {
        setErr("End odometer can't be lower than the start odometer."); return;
      }
      const isEmpty =
        start === null && end === null && !odoStartFile && !odoEndFile && !notes.trim();
      if (isEmpty) {
        setErr("Add at least one detail or photo before submitting."); return;
      }

      setBusy(true);
      try {
        await enqueueMileage({
          reimbursement_uuid: newReimbursementUuid(),
          type: "mileage",
          odometer_start: start,
          odometer_end: end,
          job_uuid: "",
          job_name: "",
          job_date: "",
          expense_date: expenseDate,
          notes,
          odo_start_blob: odoStartFile,
          odo_end_blob: odoEndFile,
          created_at: new Date().toISOString(),
        });
        await refresh();
        setOk("Submission queued.");
        clearMileage();
        setNotes("");
        setExpenseDate(todayLocalIso());
        // Fire-and-forget sync
        (async () => {
          await syncQueue();
          await fetchHistory();
          await refresh();
        })();
      } catch (e: any) {
        setErr(e?.message || "Failed to queue submission.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // expense
    const amt = amount.trim() === "" ? null : Number(amount);
    if (amt !== null && (!Number.isFinite(amt) || amt < 0)) {
      setErr("Amount must be a positive number."); return;
    }
    const expenseEmpty =
      amt === null && !category && !vendor.trim() && !receiptFile && !notes.trim();
    if (expenseEmpty) {
      setErr("Add at least one detail or photo before submitting."); return;
    }

    setBusy(true);
    try {
      await enqueueExpense({
        reimbursement_uuid: newReimbursementUuid(),
        type: "expense",
        amount: amt === null ? null : Math.round(amt * 100) / 100,
        category,
        vendor,
        payment_method: paymentMethod,
        job_uuid: "",
        job_name: "",
        job_date: "",
        expense_date: expenseDate,
        notes,
        receipt_blob: receiptFile,
        created_at: new Date().toISOString(),
      });
      await refresh();
      setOk("Submission queued.");
      clearExpense();
      setNotes("");
      setExpenseDate(todayLocalIso());
      (async () => {
        await syncQueue();
        await fetchHistory();
        await refresh();
      })();
    } catch (e: any) {
      setErr(e?.message || "Failed to queue submission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="topbar" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Log Expense / Request Reimbursement</div>
        <button
          onClick={() => nav(-1)}
          style={{
            background: "none", border: "none", color: "var(--muted)",
            cursor: "pointer", fontSize: 13, padding: "4px 8px",
          }}
        >
          &larr; Back
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={() => setMode("mileage")}
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 8,
              background: mode === "mileage" ? "var(--brand)" : "transparent",
              color: mode === "mileage" ? "var(--on-brand)" : "var(--text)",
              border: "1px solid var(--brand)",
              fontWeight: 700,
            }}
          >
            Mileage
          </button>
          <button
            type="button"
            onClick={() => setMode("expense")}
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 8,
              background: mode === "expense" ? "var(--brand)" : "transparent",
              color: mode === "expense" ? "var(--on-brand)" : "var(--text)",
              border: "1px solid var(--brand)",
              fontWeight: 700,
            }}
          >
            Business expense
          </button>
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">
          {mode === "mileage" ? "Mileage reimbursement" : "Business expense"}
        </div>
        <form onSubmit={handleSubmit} className="col" style={{ gap: 10 }}>
          <div>
            <div className="label">
              Date of {mode === "mileage" ? "trip" : "expense"}
            </div>
            <BetaTag feature="reimbursementExpenseDate" />
            <input
              type="date"
              value={expenseDate}
              max={todayLocalIso()}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
            <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
              Defaults to today - change it if you're logging this for a different day.
            </div>
          </div>
          {mode === "mileage" ? (
            <>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="label">Start odometer</div>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={odoStart}
                    onChange={(e) => setOdoStart(e.target.value)}
                    placeholder="e.g. 124533"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="label">End odometer</div>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={odoEnd}
                    onChange={(e) => setOdoEnd(e.target.value)}
                    placeholder="e.g. 124612"
                  />
                </div>
              </div>
              <div>
                <div className="label">Start odometer photo</div>
                <BetaTag feature="reimbursementPhotoLibrary" />
                <input
                  ref={odoStartRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setOdoStartFile(e.target.files?.[0] ?? null)}
                />
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                  Take a new photo or choose one from your library.
                </div>
              </div>
              <div>
                <div className="label">End odometer photo</div>
                <input
                  ref={odoEndRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setOdoEndFile(e.target.files?.[0] ?? null)}
                />
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                  Take a new photo or choose one from your library.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="label">Amount ($)</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.01}
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 24.99"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="label">Category</div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      width: "100%", padding: "9px 10px", borderRadius: 8,
                      border: "1px solid var(--border)", background: "var(--bg)",
                      color: "var(--text)", fontSize: 14, boxSizing: "border-box",
                      appearance: "auto",
                    }}
                  >
                    <option value="">Select a category…</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <div className="label">Vendor</div>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. Home Depot, Shell, U-Haul"
                />
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                  The store or business where the purchase was made - enter it as
                  it appears on the receipt.
                </div>
              </div>
              <div>
                <div className="label">Paid with</div>
                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  {([
                    { v: "personal" as PaymentMethod, label: "Personal card", sub: "request reimbursement" },
                    { v: "company" as PaymentMethod, label: "Company card", sub: "log only - no reimbursement" },
                  ]).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setPaymentMethod(opt.v)}
                      style={{
                        flex: 1, padding: "8px 10px", borderRadius: 8, textAlign: "left",
                        border: paymentMethod === opt.v ? "2px solid var(--brand)" : "1px solid var(--border)",
                        background: paymentMethod === opt.v ? "rgba(93,214,194,0.12)" : "var(--card)",
                        color: "var(--text)", cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                      <div className="small" style={{ color: "var(--muted)" }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="label">Receipt photo</div>
                <BetaTag feature="reimbursementPhotoLibrary" />
                <input
                  ref={receiptRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
                <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                  Take a new photo or choose one from your library.
                </div>
              </div>
            </>
          )}

          <div>
            <div className="label">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional - what the trip / expense was for"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)",
                color: "var(--text)", fontSize: 14, resize: "vertical", boxSizing: "border-box",
              }}
            />
          </div>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}
          {ok && <div className="small" style={{ color: "var(--ok)" }}>{ok}</div>}

          <button className="btnPrimary" disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : mode === "expense" && paymentMethod === "company"
                ? "Log expense"
                : "Submit request"}
          </button>
          <div className="small" style={{ color: "var(--muted)" }}>
            Works offline - queued submissions sync automatically when you're back online.
          </div>
        </form>
      </div>

      <div className="card">
        <div className="sectionTitle">{user?.name ? `${user.name}'s submissions` : "Your submissions"}</div>
        {rows.length === 0 && (
          <div className="small" style={{ color: "var(--muted)" }}>No requests yet.</div>
        )}
        <div className="col" style={{ gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.reimbursement_uuid}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 8,
                opacity: r.status === "pending" ? 0.7 : 1,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {r.type === "mileage"
                      ? `Mileage · ${r.odometer_start ?? "?"} → ${r.odometer_end ?? "?"}`
                      : `Expense · $${(r.amount ?? 0).toFixed(2)}${r.vendor ? ` · ${r.vendor}` : ""}${r.category ? ` · ${r.category}` : ""}`}
                  </div>
                  <div className="small" style={{ color: "var(--muted)" }}>
                    {new Date(r.created_at).toLocaleString()} · <StatusBadge status={r.status} />
                    {r.type === "expense" && r.payment_method === "company" && (
                      <span style={{ marginLeft: 6, color: "var(--muted)" }}>
                        · Company card (log only)
                      </span>
                    )}
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {r.notes}
                    </div>
                  )}
                  {r.approval_notes && (
                    <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
                      Admin: {r.approval_notes}
                    </div>
                  )}
                  {r.status === "failed" && (
                    // The submission is still on this phone, photos and all. Say what
                    // went wrong and give the crew member both ways out, rather than
                    // deleting their work and telling nobody.
                    <div
                      style={{
                        marginTop: 6,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--danger)",
                        background: "rgba(255,107,107,0.08)",
                      }}
                    >
                      <div className="small" style={{ color: "var(--danger)", fontWeight: 600 }}>
                        Not sent: {r.failed_reason || "the server rejected this submission."}
                      </div>
                      <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                        It is still saved on this phone. Nothing has been lost.
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleRetry(r.reimbursement_uuid)}
                          disabled={busy}
                          className="btnPrimary"
                          style={{ padding: "8px 12px" }}
                        >
                          Try again
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscard(r.reimbursement_uuid)}
                          disabled={busy}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--text)",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Delete it
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "approved" ? "var(--ok)"
    : status === "rejected" || status === "failed" ? "var(--danger)"
    : status === "pending" ? "var(--muted)"
    : "var(--brand)";
  const label =
    status === "submitted" ? "Submitted"
    : status === "approved" ? "Approved"
    : status === "rejected" ? "Rejected"
    // "Rejected" is the admin declining a valid claim. "Not sent" is the app
    // failing to deliver one. Very different news for a crew member.
    : status === "failed" ? "Not sent"
    : status === "pending" ? "Pending sync"
    : status;
  return <span style={{ color, fontWeight: 700 }}>{label}</span>;
}
