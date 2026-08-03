/**
 * DQ document-type catalog editor (C4.1b), shown in admin Settings. Each type
 * has an audience (driver-filled vs admin-filled) and a required flag that
 * drives the missing-docs reminder.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

type DqType = { key?: string; name: string; audience: "driver" | "admin"; required: boolean };

export default function DqDocTypesCard() {
  const [types, setTypes] = useState<DqType[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ types: DqType[] }>("/api/admin/dq/config/types")
      .then((r) => { setTypes(r.types); setLoaded(true); })
      .catch(() => { setErr("Failed to load document types"); setLoaded(true); });
  }, []);

  const update = (i: number, patch: Partial<DqType>) => {
    setTypes((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    setSaved(false);
  };
  const remove = (i: number) => { setTypes((prev) => prev.filter((_, j) => j !== i)); setSaved(false); };
  const add = () => { setTypes((prev) => [...prev, { name: "", audience: "driver", required: true }]); setSaved(false); };

  async function save() {
    if (types.some((t) => !t.name.trim())) { setErr("Every document type needs a name."); return; }
    if (types.length === 0) { setErr("Keep at least one document type."); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/admin/dq/config/types", { method: "PUT", body: JSON.stringify({ types }) });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="microLabel" style={{ marginBottom: 10 }}>DQ document types</div>
      <div className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
        The documents that make up a driver's DQ file. Driver-filled documents
        (a medical card, the certification of violations) the driver uploads;
        admin-filled ones (the road-test form and certificate) the office files.
        Required documents show in the driver's missing-docs reminder.
      </div>
      {!loaded ? (
        <div className="small" style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {types.map((t, i) => (
            <div key={i} className="row wrap" style={{ gap: 8, alignItems: "flex-end", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
              <label className="col" style={{ gap: 2, flex: "1 1 200px", minWidth: 160 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Name</span>
                <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Document name" />
              </label>
              <label className="col" style={{ gap: 2 }}>
                <span className="small" style={{ color: "var(--muted)" }}>Filled by</span>
                <select value={t.audience} onChange={(e) => update(i, { audience: e.target.value as "driver" | "admin" })}>
                  <option value="driver">Driver</option>
                  <option value="admin">Office (admin)</option>
                </select>
              </label>
              <label className="row" style={{ gap: 6, alignItems: "center", paddingBottom: 6 }}>
                <input type="checkbox" checked={t.required} onChange={(e) => update(i, { required: e.target.checked })} />
                <span className="small">Required</span>
              </label>
              <button type="button" onClick={() => remove(i)} style={{ fontSize: 12, color: "var(--danger)", marginLeft: "auto" }}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={add} style={{ alignSelf: "flex-start", fontSize: 13 }}>+ Add document type</button>
        </div>
      )}
      {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 12 }}>
        {saved && <span className="small" style={{ color: "var(--ok)" }}>Saved.</span>}
        <button className="btnPrimary" onClick={save} disabled={busy || !loaded}>{busy ? "Saving…" : "Save document types"}</button>
      </div>
    </div>
  );
}
