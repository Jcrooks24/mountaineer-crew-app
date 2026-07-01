/**
 * On-device Bill of Lading PDF generator (pdf-lib).
 *
 * Produces the signed BOL as a PDF Blob entirely in the browser — so the crew
 * can hand the shipper a dated copy at the moment of signing, even with no
 * signal. The same generator runs at sync time (in bolStore.syncQueue) to
 * upload the finished PDF to Drive.
 *
 * Legal text reproduces the 16-section Mountaineer Moving interstate BOL
 * (49 CFR Part 375). Sections 15-16 use the user-approved DIGITAL wording
 * (electronic execution + electronic copy delivery) in place of the template's
 * paper "print two copies / carry in the cab" procedure; all substantive terms,
 * timeframes, and certifications are unchanged. Edit the SECTIONS text below to
 * revise wording.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BOLDraft } from "./bolStore";

const CARRIER = {
  name: "Mountaineer Moving LLC",
  address: "3021 S 27th Ave. #B, Bozeman, MT 59718",
  phone: "(406) 201-9580",
  email: "management@mountaineermoving.com",
  dot: "4557708",
  mc: "1811084",
};

// Page geometry (US Letter).
const PW = 612;
const PH = 792;
const MARGIN = 50;
const MAXW = PW - MARGIN * 2;

type Section = { n: number; title: string; body: string };

// Sections 1-14 + 15-16 (digital-adapted). Kept faithful to the template; the
// per-move variable data (job, dates, valuation election, etc.) is carried
// forward from the signed estimate and confirmed on signing.
const SECTIONS: Section[] = [
  { n: 2, title: "Additional Motor Carriers [§375.505(b)(2)]", body: "If any additional motor carriers will participate in this shipment, they are listed on the signed estimate carried forward with this Bill of Lading. Write N/A if none." },
  { n: 3, title: "Shipper (Customer) Information [§375.505(b)(3)]", body: "Shipper name, current address, and contact information are carried forward from the signed estimate and confirmed as accurate and complete at signing, or corrected in the crew notes." },
  { n: 4, title: "Shipment Details", body: "Job / shipment number, Bill of Lading issue date, and the origin, stop(s), and destination addresses are carried forward from the signed estimate and confirmed at signing." },
  { n: 5, title: "Pickup and Delivery Dates [§375.505(b)(6)(8)]", body: "The estimate type (binding or non-binding) and the agreed pickup and delivery dates/windows are carried forward from the signed estimate. The actual pickup date is recorded at time of loading (Section 16)." },
  { n: 6, title: "Vehicle Identification [§375.505(b)(9)]", body: "The vehicle unit / plate / company ID used for this shipment is recorded at time of loading (see origin signing, Section 16)." },
  { n: 7, title: "Valuation Confirmation [§375.505(b)(12)]", body: "The shipper's valuation election was made on the signed estimate and is confirmed here as required by federal law. FULL VALUE PROTECTION: the applicable charge is 1.25% of the declared value. RELEASED VALUE (waiver): no additional charge; recovery is limited to 60 cents per pound per article regardless of actual value, made freely and in writing as required by the Surface Transportation Board's Released Rates Order." },
  { n: 8, title: "Third-Party Insurance [§375.505(b)(13)]", body: "If the shipper purchased separate liability insurance from an independent insurer for this shipment, the details appear on the estimate carried forward. Write N/A if none." },
  { n: 9, title: "Crew, Services, and Charges [§375.505(b)(4)(10)(11)(14)]", body: "Crew size, services ordered, charge summary, and payment method are carried forward from the signed estimate. Final charges are based on actual time and materials unless this is a binding estimate. Mountaineer Moving bills from departure from dispatch to return to dispatch, in quarter-hour increments rounded up after 5 minutes; minimum charge 2 hours. Maximum collect-on-delivery amount: Mountaineer Moving will not demand more than 110% of a non-binding estimate, or the exact binding estimate amount, at delivery to release the shipment." },
  { n: 10, title: "Delivery Notification Contact [§375.505(b)(5)]", body: "For a shipment transported on a collect-on-delivery basis, the person to be notified about charges prior to delivery is as stated on the estimate, or \"same\" as the shipper." },
  { n: 11, title: "Attachments and Reference [§375.505(b)(15)(16)(17)]", body: "The following are incorporated into this Bill of Lading: the written estimate (binding or non-binding); the declared inventory / item list (below); the Contract for Moving Services; \"Your Rights and Responsibilities When You Move\" (FMCSA-ESA-03-006); \"Ready to Move?\" (FMCSA-ESA-03-005); and the Arbitration Program Summary (Section 13). This Bill of Lading incorporates by reference all services included on the estimate." },
  { n: 12, title: "Loss and Damage Claims", body: "All claims for loss or damage must be submitted in writing to Mountaineer Moving LLC (management@mountaineermoving.com) within 9 months following the date of delivery or the date the shipment should have been delivered, whichever is later. This federal timeframe cannot be shortened by contract. The shipper must participate in a final walk-through before departure and document any damage at that time; failure to identify damage during the walk-through constitutes acceptance of the condition of the goods. Mountaineer Moving is not responsible for damage to the contents of boxes packed by the shipper." },
  { n: 13, title: "Arbitration Program Notice [§375.211]", body: "Mountaineer Moving maintains a neutral arbitration program for loss-and-damage disputes and disputes over additional charges, as required by 49 CFR 375.211 and 49 U.S.C. 14708. Arbitration is OPTIONAL — the shipper retains the right to pursue judicial remedies under 49 U.S.C. 14704. The arbitrator is a neutral third party. A complete written summary is available on request (management@mountaineermoving.com)." },
  { n: 14, title: "Acknowledgment of Required Publications [§375.213]", body: "Federal law requires Mountaineer Moving to provide, before execution of this Bill of Lading: (1) \"Your Rights and Responsibilities When You Move\" (FMCSA-ESA-03-006) and (2) \"Ready to Move?\" (FMCSA-ESA-03-005), both available at www.fmcsa.dot.gov. By signing at origin, the shipper confirms receipt of, or a link to, each publication." },
  // ── DIGITAL-ADAPTED ──
  { n: 15, title: "Right to Rescind and Delivery of Copies [§375.505(h)]", body: "PRE-SIGNING REQUIREMENT: This Bill of Lading must be in the shipper's possession at least 3 days before the shipment is scheduled to be loaded. Do not sign on moving day unless items or services added that day require an updated estimate, in which case only the charge changes are exempt from the 3-day requirement.\nRIGHT TO RESCIND: The shipper may cancel this Bill of Lading without penalty within 3 days of the date of signing, by notifying Mountaineer Moving in writing (management@mountaineermoving.com) or by calling (406) 201-9580 within that window.\nELECTRONIC COPY PROCEDURE: This Bill of Lading is executed electronically. At the time of each signing, Mountaineer Moving provides the shipper a dated PDF copy of the signed document — downloaded to the shipper's device and/or emailed to the address on file. Mountaineer Moving retains the signed electronic record (the equivalent of the carrier copy) for a minimum of one year from the date of issue. The signed Bill of Lading remains accessible to the crew on the company device throughout transportation, in place of a printed copy carried in the cab." },
  { n: 16, title: "Signatures [§375.505(f)]", body: "This Bill of Lading is signed twice, electronically: once at origin before loading, and once at destination upon delivery. Mountaineer Moving provides the shipper a dated electronic copy at the time of each signing.\nELECTRONIC SIGNATURE CONSENT: By signing electronically below, each party agrees that their electronic signature is legally binding and equivalent to a handwritten signature for the purposes of this Bill of Lading.\nBy signing at origin, the shipper confirms: (a) all information in this Bill of Lading is accurate; (b) the valuation election in Section 7 was made freely with full understanding of both coverage options; (c) the required federal publications in Section 14 were received; and (d) the shipper agrees to the terms and conditions of this Bill of Lading, and acknowledges it has been in their possession at least 3 days prior to signing, or that today is the moving day and only charge adjustments from new or additional services are being made. At destination, by signing the shipper confirms receipt of the shipment and that a final walk-through was completed with the crew; any damage attributable to Mountaineer Moving was identified and documented at that time." },
];

function fmtDate(iso?: string): string {
  if (!iso) return "";
  // Accept "YYYY-MM-DD" or full ISO — show a readable date.
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export async function generateBolPdf(draft: BOLDraft): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PW, PH]);
  let y = PH - MARGIN;

  const ensure = (space: number) => {
    if (y - space < MARGIN) {
      page = doc.addPage([PW, PH]);
      y = PH - MARGIN;
    }
  };

  const wrap = (str: string, f: PDFFont, size: number, maxW: number): string[] => {
    const out: string[] = [];
    for (const para of str.split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      let cur = "";
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          out.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      out.push(cur);
    }
    return out.length ? out : [""];
  };

  const drawText = (
    str: string,
    opts: { size?: number; f?: PDFFont; indent?: number; gap?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = opts.size ?? 8.5;
    const f = opts.f ?? font;
    const indent = opts.indent ?? 0;
    const color = opts.color ?? rgb(0.1, 0.1, 0.12);
    const lh = size + 2.5;
    for (const line of wrap(str, f, size, MAXW - indent)) {
      ensure(lh);
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font: f, color });
      y -= lh;
    }
    y -= opts.gap ?? 4;
  };

  const heading = (str: string) => {
    ensure(18);
    y -= 4;
    drawText(str, { size: 10.5, f: bold, gap: 3, color: rgb(0.05, 0.18, 0.23) });
  };

  const rule = () => {
    ensure(8);
    page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
    y -= 8;
  };

  // ── Title + carrier ──
  drawText("BILL OF LADING", { size: 15, f: bold, gap: 1, color: rgb(0.05, 0.18, 0.23) });
  drawText("Receipt for Household Goods and Contract for Transportation — issued pursuant to 49 CFR Part 375 (Interstate Household Goods). Standalone document, separate from the Contract for Moving Services.", { size: 8, gap: 6 });

  heading("Section 1 — Carrier Information [§375.505(b)(1)]");
  drawText(`${CARRIER.name}\n${CARRIER.address}\n${CARRIER.phone} · ${CARRIER.email}\nU.S. DOT ${CARRIER.dot} · MC ${CARRIER.mc}`, { gap: 6 });

  // ── Shipment / job summary ──
  heading("Shipment Summary");
  drawText(
    `Job: ${draft.job_name || "—"}\nMove date: ${fmtDate(draft.job_date) || "—"}\nCrew representative: ${draft.crew_rep || "—"}` +
      (draft.actual_pickup_date ? `\nActual pickup date: ${fmtDate(draft.actual_pickup_date)}` : "") +
      (draft.vehicle ? `\nVehicle: ${draft.vehicle}` : ""),
    { gap: 6 },
  );

  // ── Sections 2-11 ──
  for (const s of SECTIONS.filter((x) => x.n <= 11)) {
    heading(`Section ${s.n} — ${s.title}`);
    drawText(s.body, { gap: 5 });
  }

  // ── Declared inventory (Section 11 attachment) ──
  heading("Declared Inventory — Item List (Section 11 Attachment)");
  if (draft.items.length === 0) {
    drawText("No items declared.", { gap: 4 });
  } else {
    ensure(14);
    drawText("#    Item                                             Qty   Condition / Photos", { size: 8, f: bold, gap: 2 });
    rule();
    for (const it of draft.items) {
      const photoCount = it.photos.filter((p) => p.drive_url).length;
      const line = `#${it.item_no}  ${it.name}`;
      const right = `x${it.qty}`;
      ensure(12);
      page.drawText(wrap(line, font, 8.5, MAXW - 90)[0], { x: MARGIN, y: y - 8.5, size: 8.5, font, color: rgb(0.1, 0.1, 0.12) });
      page.drawText(right, { x: PW - MARGIN - 70, y: y - 8.5, size: 8.5, font: bold, color: rgb(0.1, 0.1, 0.12) });
      y -= 12;
      const extra: string[] = [];
      if (it.condition_notes) extra.push(`Condition: ${it.condition_notes}`);
      if (photoCount > 0) extra.push(`${photoCount} photo${photoCount === 1 ? "" : "s"} on file`);
      if (extra.length) drawText(extra.join("  ·  "), { size: 7.5, indent: 16, gap: 2, color: rgb(0.35, 0.37, 0.4) });
    }
    y -= 4;
    drawText(`Total: ${draft.items.length} item type(s), ${draft.items.reduce((s, it) => s + it.qty, 0)} piece(s).`, { size: 8, f: bold, gap: 6 });
  }

  // ── Sections 12-16 ──
  for (const s of SECTIONS.filter((x) => x.n >= 12)) {
    heading(`Section ${s.n} — ${s.title}`);
    drawText(s.body, { gap: 5 });
  }

  // ── Signature blocks ──
  const drawSig = async (label: string, dataUrl?: string, whenIso?: string) => {
    ensure(96);
    y -= 4;
    drawText(label, { size: 9, f: bold, gap: 3 });
    // signature area
    const boxTop = y;
    const boxH = 54;
    if (dataUrl) {
      try {
        const png = await doc.embedPng(dataUrl);
        const dims = png.scaleToFit(220, boxH - 6);
        page.drawImage(png, { x: MARGIN + 4, y: boxTop - dims.height, width: dims.width, height: dims.height });
      } catch {
        /* bad image data — leave the line blank */
      }
    }
    // signature line
    page.drawLine({ start: { x: MARGIN, y: boxTop - boxH }, end: { x: MARGIN + 260, y: boxTop - boxH }, thickness: 0.6, color: rgb(0.4, 0.42, 0.45) });
    y = boxTop - boxH - 2;
    drawText(`Signature${whenIso ? "   ·   " + fmtDate(whenIso) : ""}`, { size: 7.5, gap: 6, color: rgb(0.4, 0.42, 0.45) });
  };

  heading("Origin Signing — before loading");
  await drawSig("Shipper — signature at origin", draft.origin_shipper_sig, draft.origin_signed_at);
  await drawSig("Carrier representative — signature at origin", draft.origin_carrier_sig, draft.origin_signed_at);

  if (draft.dest_shipper_sig || draft.dest_carrier_sig) {
    heading("Destination Signing — upon delivery");
    if (draft.walkthrough_notes) drawText(`Walk-through notes: ${draft.walkthrough_notes}`, { size: 8, gap: 3 });
    if (draft.final_charges != null) drawText(`Final actual charges: $${Number(draft.final_charges).toFixed(2)}`, { size: 8, f: bold, gap: 4 });
    await drawSig("Shipper — signature at delivery", draft.dest_shipper_sig, draft.dest_signed_at);
    await drawSig("Carrier representative — signature at delivery", draft.dest_carrier_sig, draft.dest_signed_at);
  }

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer-backed view so the Blob type is unambiguous.
  return new Blob([bytes.slice()], { type: "application/pdf" });
}
