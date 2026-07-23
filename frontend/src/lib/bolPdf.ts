/**
 * On-device Bill of Lading PDF generator (pdf-lib).
 *
 * Produces the signed BOL as a PDF Blob entirely in the browser - so the crew
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

import {
  BOL_CONTRACT_SECTIONS,
  type BolContractSection,
  FORM_OF_PAYMENT_OPTIONS,
  ESTIMATE_TYPE_OPTIONS,
  VALUATION_OPTIONS,
  bolOptionLabel,
} from "./bolContract";

// The 16 CFR §375.505 clauses live in ./bolContract so the BOL editor UI
// can render the same text next to the signing card without pulling in
// pdf-lib. Alias kept so the rest of this file reads unchanged.
const SECTIONS: BolContractSection[] = BOL_CONTRACT_SECTIONS;

function fmtDate(iso?: string): string {
  if (!iso) return "";
  // Accept "YYYY-MM-DD" or full ISO - show a readable date.
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
  drawText("Receipt for Household Goods and Contract for Transportation - issued pursuant to 49 CFR Part 375 (Interstate Household Goods). Standalone document, separate from the Contract for Moving Services.", { size: 8, gap: 6 });

  heading("Section 1 - Carrier Information [§375.505(b)(1)]");
  drawText(`${CARRIER.name}\n${CARRIER.address}\n${CARRIER.phone} · ${CARRIER.email}\nU.S. DOT ${CARRIER.dot} · MC ${CARRIER.mc}`, { gap: 6 });

  // ── Shipment / job summary ──
  // These are the FMCSA 49 CFR 375.505 data elements, captured from the crew and
  // printed on the document (not carried from an estimate the crew cannot see -
  // ADR 0023). Origin + destination addresses are load-bearing: a DOT officer at
  // a border crossing asks for the pickup and delivery addresses.
  const paymentLabel = bolOptionLabel(FORM_OF_PAYMENT_OPTIONS, draft.form_of_payment);
  const estimateLabel = bolOptionLabel(ESTIMATE_TYPE_OPTIONS, draft.estimate_type);
  heading("Shipment Summary");
  drawText(
    `Shipment / job reference: ${draft.shipment_number || draft.job_name || "-"}\n` +
      `Bill of Lading issue date: ${fmtDate(draft.job_date) || "-"}\n` +
      `Crew representative: ${draft.crew_rep || "-"}\n` +
      `Shipper (customer): ${draft.shipper_name || "-"}\n` +
      `Shipper phone: ${draft.shipper_phone || "-"}\n` +
      `Shipper address: ${draft.shipper_address || "-"}\n` +
      `Origin (pickup) address: ${draft.origin_address || "-"}\n` +
      `Destination (delivery) address: ${draft.dest_address || "-"}\n` +
      `Agreed pickup: ${draft.agreed_pickup || "-"}\n` +
      `Agreed delivery: ${draft.agreed_delivery || "-"}` +
      (draft.actual_pickup_date ? `\nActual pickup date: ${fmtDate(draft.actual_pickup_date)}` : "") +
      (draft.vehicle ? `\nVehicle: ${draft.vehicle}` : "") +
      `\nForm of payment at delivery: ${paymentLabel || "-"}\n` +
      `Estimate type: ${estimateLabel || "-"}` +
      (draft.form_of_payment === "cod"
        ? `\nCOD - notify: ${draft.cod_notify || "-"}\nCOD - maximum at delivery: ${draft.cod_max || "-"}`
        : "") +
      `\nAdditional carriers: ${draft.additional_carriers || "None"}` +
      `\nThird-party insurance: ${draft.third_party_insurance || "None"}` +
      `\nSpecial / accessorial services: ${draft.accessorial_services || "N/A"}`,
    { gap: 6 },
  );

  // Valuation election - the shipper's legally required liability choice, printed
  // prominently as its own block (375.505(b)(12)).
  heading("Valuation Election [§375.505(b)(12)]");
  const valOpt = VALUATION_OPTIONS.find((o) => o.value === draft.valuation);
  drawText(`Elected: ${valOpt?.label || "NOT ELECTED"}`, { size: 9, f: bold, gap: 2 });
  if (valOpt?.blurb) drawText(valOpt.blurb, { size: 8, gap: 6 });

  // ── Sections 2-11 ──
  for (const s of SECTIONS.filter((x) => x.n <= 11)) {
    heading(`Section ${s.n} - ${s.title}`);
    drawText(s.body, { gap: 5 });
  }

  // ── Declared inventory (Section 11 attachment) ──
  heading("Declared Inventory - Item List (Section 11 Attachment)");
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
    heading(`Section ${s.n} - ${s.title}`);
    drawText(s.body, { gap: 5 });
  }

  // ── Signature blocks ──
  const drawSig = async (label: string, dataUrl?: string, whenIso?: string, printedName?: string) => {
    ensure(104);
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
        /* bad image data - leave the line blank */
      }
    }
    // signature line
    page.drawLine({ start: { x: MARGIN, y: boxTop - boxH }, end: { x: MARGIN + 260, y: boxTop - boxH }, thickness: 0.6, color: rgb(0.4, 0.42, 0.45) });
    y = boxTop - boxH - 2;
    if (printedName) drawText(`Printed name: ${printedName}`, { size: 8, gap: 1, color: rgb(0.1, 0.1, 0.12) });
    drawText(`Signature${whenIso ? "   ·   " + fmtDate(whenIso) : ""}`, { size: 7.5, gap: 6, color: rgb(0.4, 0.42, 0.45) });
  };

  heading("Origin Signing - before loading");
  await drawSig("Shipper - signature at origin", draft.origin_shipper_sig, draft.origin_signed_at, draft.origin_shipper_name);
  await drawSig(`Carrier representative - signature at origin`, draft.origin_carrier_sig, draft.origin_signed_at, draft.crew_rep);

  if (draft.dest_shipper_sig || draft.dest_carrier_sig) {
    heading("Destination Signing - upon delivery");
    if (draft.walkthrough_notes) drawText(`Walk-through notes: ${draft.walkthrough_notes}`, { size: 8, gap: 3 });
    if (draft.final_charges != null) drawText(`Final actual charges: $${Number(draft.final_charges).toFixed(2)}`, { size: 8, f: bold, gap: 4 });
    await drawSig("Shipper - signature at delivery", draft.dest_shipper_sig, draft.dest_signed_at, draft.dest_shipper_name);
    await drawSig(`Carrier representative - signature at delivery`, draft.dest_carrier_sig, draft.dest_signed_at, draft.crew_rep);
  }

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer-backed view so the Blob type is unambiguous.
  return new Blob([bytes.slice()], { type: "application/pdf" });
}
