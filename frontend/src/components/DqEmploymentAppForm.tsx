/**
 * Driver's Employment Application - in-app fillable form (C4.4), 49 CFR 391.21.
 * Driver-filled. Structured form -> generated PDF -> the driver's DQ file.
 */
import { useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";
import { uploadMyDq } from "../lib/dqStore";
import {
  generateEmploymentAppPdf,
  type AddressRow, type EmployerRow, type ExperienceRow,
  type AccidentRow, type ConvictionRow, type LicenseRow,
} from "../lib/dqEmploymentAppPdf";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputStyle = { padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 };

function Text({ label, value, onChange, type = "text", w, maxLength, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; w?: number | string; maxLength?: number; placeholder?: string }) {
  return (
    <label className="col" style={{ gap: 2, width: w, flex: w ? undefined : "1 1 140px" }}>
      <span className="small" style={{ color: "var(--muted)" }}>{label}</span>
      <input type={type} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="small" style={{ color: "var(--muted)", fontWeight: 700 }}>{title}</span>
      {children}
      {onAdd && <button type="button" onClick={onAdd} style={{ alignSelf: "flex-start", fontSize: 13 }}>{addLabel || "+ Add"}</button>}
    </div>
  );
}

function RowCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="col" style={{ gap: 6, border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
      {children}
      <button type="button" onClick={onRemove} style={{ alignSelf: "flex-end", color: "var(--danger)", fontSize: 12 }}>Remove</button>
    </div>
  );
}

export default function DqEmploymentAppForm({ driverName, onDone, onCancel }: { driverName: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(driverName || "");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [positionApplied, setPositionApplied] = useState("Mover / Driver");
  const [dateAvailable, setDateAvailable] = useState("");

  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [experience, setExperience] = useState<ExperienceRow[]>([]);
  const [accidents, setAccidents] = useState<AccidentRow[]>([]);
  const [convictions, setConvictions] = useState<ConvictionRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [noAccidents, setNoAccidents] = useState(true);
  const [noConvictions, setNoConvictions] = useState(true);

  const [signedDate, setSignedDate] = useState(todayISO());
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upd = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>) => (i: number, patch: Partial<T>) =>
    setter((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rm = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>) => (i: number) =>
    setter((prev) => prev.filter((_, j) => j !== i));

  const updAddr = upd(setAddresses); const updEmp = upd(setEmployers); const updExp = upd(setExperience);
  const updAcc = upd(setAccidents); const updConv = upd(setConvictions); const updLic = upd(setLicenses);

  async function submit() {
    if (!name.trim()) { setErr("Enter your name."); return; }
    if (sigRef.current?.isEmpty()) { setErr("Sign in the box before submitting."); return; }
    setBusy(true);
    setErr(null);
    try {
      const blob = await generateEmploymentAppPdf({
        name: name.trim(), address: address.trim(), dob, phone: phone.trim(), email: email.trim(),
        positionApplied: positionApplied.trim(), dateAvailable,
        addresses, employers, experience,
        accidents: noAccidents ? [] : accidents,
        convictions: noConvictions ? [] : convictions,
        licenses, noAccidents, noConvictions,
        signatureDataUrl: sigRef.current?.toDataURL() || "", signedDate,
      });
      const file = new File([blob], "drivers_employment_application.pdf", { type: "application/pdf" });
      await uploadMyDq(file, "employment_application");
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Could not submit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Driver's Employment Application</div>
        <div className="small" style={{ color: "var(--muted)", marginTop: 2 }}>49 CFR 391.21. Fill what applies; leave the rest blank.</div>
      </div>

      <Section title="Applicant">
        <div className="row wrap" style={{ gap: 10 }}>
          <Text label="Name" value={name} onChange={setName} />
          <Text label="Date of birth" value={dob} onChange={setDob} type="date" w={160} />
        </div>
        <Text label="Current address" value={address} onChange={setAddress} />
        <div className="row wrap" style={{ gap: 10 }}>
          <Text label="Phone" value={phone} onChange={setPhone} />
          <Text label="Email" value={email} onChange={setEmail} />
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <Text label="Position applied for" value={positionApplied} onChange={setPositionApplied} />
          <Text label="Date available" value={dateAvailable} onChange={setDateAvailable} type="date" w={160} />
        </div>
      </Section>

      <Section title="Address history (past 3 years)" addLabel="+ Add address" onAdd={() => setAddresses((p) => [...p, { address: "", from: "", to: "" }])}>
        {addresses.map((a, i) => (
          <RowCard key={i} onRemove={() => rm(setAddresses)(i)}>
            <Text label="Address" value={a.address} onChange={(v) => updAddr(i, { address: v })} />
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="From" value={a.from} onChange={(v) => updAddr(i, { from: v })} type="date" w={150} />
              <Text label="To" value={a.to} onChange={(v) => updAddr(i, { to: v })} type="date" w={150} />
            </div>
          </RowCard>
        ))}
      </Section>

      <Section title="Employment history" addLabel="+ Add employer" onAdd={() => setEmployers((p) => [...p, { name: "", address: "", position: "", from: "", to: "", reasonLeaving: "", subjectFmcsr: false, safetySensitive: false }])}>
        {employers.map((e, i) => (
          <RowCard key={i} onRemove={() => rm(setEmployers)(i)}>
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="Employer" value={e.name} onChange={(v) => updEmp(i, { name: v })} />
              <Text label="Position" value={e.position} onChange={(v) => updEmp(i, { position: v })} />
            </div>
            <Text label="Employer address" value={e.address} onChange={(v) => updEmp(i, { address: v })} />
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="From" value={e.from} onChange={(v) => updEmp(i, { from: v })} type="date" w={150} />
              <Text label="To" value={e.to} onChange={(v) => updEmp(i, { to: v })} type="date" w={150} />
            </div>
            <Text label="Reason for leaving" value={e.reasonLeaving} onChange={(v) => updEmp(i, { reasonLeaving: v })} />
            <div className="row wrap" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={e.subjectFmcsr} onChange={(ev) => updEmp(i, { subjectFmcsr: ev.target.checked })} />
                <span className="small">Subject to FMCSRs</span>
              </label>
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={e.safetySensitive} onChange={(ev) => updEmp(i, { safetySensitive: ev.target.checked })} />
                <span className="small">Safety-sensitive (DOT-tested)</span>
              </label>
            </div>
          </RowCard>
        ))}
      </Section>

      <Section title="Driving experience" addLabel="+ Add experience" onAdd={() => setExperience((p) => [...p, { equipmentClass: "", equipmentType: "", from: "", to: "", approxMiles: "" }])}>
        {experience.map((x, i) => (
          <RowCard key={i} onRemove={() => rm(setExperience)(i)}>
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="Class of equipment" value={x.equipmentClass} onChange={(v) => updExp(i, { equipmentClass: v })} />
              <Text label="Type" value={x.equipmentType} onChange={(v) => updExp(i, { equipmentType: v })} />
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="From" value={x.from} onChange={(v) => updExp(i, { from: v })} type="date" w={150} />
              <Text label="To" value={x.to} onChange={(v) => updExp(i, { to: v })} type="date" w={150} />
              <Text label="Approx. miles" value={x.approxMiles} onChange={(v) => updExp(i, { approxMiles: v })} w={120} />
            </div>
          </RowCard>
        ))}
      </Section>

      <Section title="Accident record (past 3 years)">
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={noAccidents} onChange={(e) => setNoAccidents(e.target.checked)} />
          <span className="small"><strong>No accidents</strong> in the past 3 years</span>
        </label>
        {!noAccidents && (
          <>
            {accidents.map((a, i) => (
              <RowCard key={i} onRemove={() => rm(setAccidents)(i)}>
                <div className="row wrap" style={{ gap: 10 }}>
                  <Text label="Date" value={a.date} onChange={(v) => updAcc(i, { date: v })} type="date" w={150} />
                  <Text label="Nature" value={a.nature} onChange={(v) => updAcc(i, { nature: v })} />
                </div>
                <div className="row wrap" style={{ gap: 10 }}>
                  <Text label="Fatalities" value={a.fatalities} onChange={(v) => updAcc(i, { fatalities: v })} w={110} />
                  <Text label="Injuries" value={a.injuries} onChange={(v) => updAcc(i, { injuries: v })} w={110} />
                </div>
              </RowCard>
            ))}
            <button type="button" onClick={() => setAccidents((p) => [...p, { date: "", nature: "", fatalities: "", injuries: "" }])} style={{ alignSelf: "flex-start", fontSize: 13 }}>+ Add accident</button>
          </>
        )}
      </Section>

      <Section title="Traffic convictions (past 12 months)">
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={noConvictions} onChange={(e) => setNoConvictions(e.target.checked)} />
          <span className="small"><strong>No convictions</strong> in the past 12 months</span>
        </label>
        {!noConvictions && (
          <>
            {convictions.map((c, i) => (
              <RowCard key={i} onRemove={() => rm(setConvictions)(i)}>
                <div className="row wrap" style={{ gap: 10 }}>
                  <Text label="Date" value={c.date} onChange={(v) => updConv(i, { date: v })} type="date" w={150} />
                  <Text label="Offense" value={c.offense} onChange={(v) => updConv(i, { offense: v })} />
                </div>
                <div className="row wrap" style={{ gap: 10 }}>
                  <Text label="Location" value={c.location} onChange={(v) => updConv(i, { location: v })} />
                  <Text label="Penalty" value={c.penalty} onChange={(v) => updConv(i, { penalty: v })} />
                </div>
              </RowCard>
            ))}
            <button type="button" onClick={() => setConvictions((p) => [...p, { date: "", offense: "", location: "", penalty: "" }])} style={{ alignSelf: "flex-start", fontSize: 13 }}>+ Add conviction</button>
          </>
        )}
      </Section>

      <Section title="Driver's licenses" addLabel="+ Add license" onAdd={() => setLicenses((p) => [...p, { state: "", number: "", classType: "", expiration: "" }])}>
        {licenses.map((l, i) => (
          <RowCard key={i} onRemove={() => rm(setLicenses)(i)}>
            <div className="row wrap" style={{ gap: 10 }}>
              <Text label="State" value={l.state} onChange={(v) => updLic(i, { state: v })} w={90} maxLength={2} placeholder="MT" />
              <Text label="License #" value={l.number} onChange={(v) => updLic(i, { number: v })} />
              <Text label="Class / type" value={l.classType} onChange={(v) => updLic(i, { classType: v })} w={130} />
              <Text label="Expiration" value={l.expiration} onChange={(v) => updLic(i, { expiration: v })} type="date" w={150} />
            </div>
          </RowCard>
        ))}
      </Section>

      <div className="col" style={{ gap: 6 }}>
        <span className="small" style={{ color: "var(--muted)" }}>Signature</span>
        <SignaturePad ref={sigRef} />
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => sigRef.current?.clear()} style={{ fontSize: 12 }}>Clear signature</button>
          <label className="row" style={{ gap: 6, alignItems: "center", marginLeft: "auto" }}>
            <span className="small" style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </div>

      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btnPrimary" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Sign & submit"}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
