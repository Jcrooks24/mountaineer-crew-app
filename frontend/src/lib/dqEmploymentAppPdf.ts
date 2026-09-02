/**
 * On-device PDF for the Driver's Employment Application (C4.4), 49 CFR 391.21.
 * Driver-filled. Structured form -> generated PDF, same approach as the other
 * DQ forms. Covers the required sections: applicant, 3-year address history,
 * employment history, driving experience, accident record, traffic convictions,
 * licenses, and the applicant certification + signature.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getCompanyInfoCached } from "./companyInfo";
import { toWinAnsi } from "./winAnsi";

export type AddressRow = { address: string; from: string; to: string };
export type EmployerRow = {
  name: string; address: string; position: string; from: string; to: string;
  reasonLeaving: string; subjectFmcsr: boolean; safetySensitive: boolean;
};
export type ExperienceRow = { equipmentClass: string; equipmentType: string; from: string; to: string; approxMiles: string };
export type AccidentRow = { date: string; nature: string; fatalities: string; injuries: string };
export type ConvictionRow = { date: string; offense: string; location: string; penalty: string };
export type LicenseRow = { state: string; number: string; classType: string; expiration: string };

export type EmploymentAppData = {
  name: string;
  address: string;
  dob: string;
  phone: string;
  email: string;
  positionApplied: string;
  dateAvailable: string;
  addresses: AddressRow[];
  employers: EmployerRow[];
  experience: ExperienceRow[];
  accidents: AccidentRow[];
  convictions: ConvictionRow[];
  licenses: LicenseRow[];
  noAccidents: boolean;
  noConvictions: boolean;
  signatureDataUrl: string;
  signedDate: string;
};

const PW = 612;
const PH = 792;
const MARGIN = 50;
const MAXW = PW - MARGIN * 2;

const CERT =
  "This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge. I authorize the motor carrier to make investigations and inquiries into my employment, driving, safety-performance, and criminal-history record as may be necessary.";

// Every drawn string funnels through here, so this is where the WinAnsi guard
// belongs: a pdf-lib standard font THROWS on a character it cannot encode and
// takes the whole document with it. Applicant-typed employers, addresses and
// explanations are the exposure. Same fix as bolPdf - see ADR 0042.
function wrap(raw: string, font: PDFFont, size: number, maxW: number): string[] {
  const str = toWinAnsi(raw || "");
  const out: string[] = [];
  for (const para of str.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

function fmtDate(iso: string): string {
  const s = (iso || "").slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${m}/${d}/${y}` : s;
}

export async function generateEmploymentAppPdf(data: EmploymentAppData): Promise<Blob> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([PW, PH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const carrier = getCompanyInfoCached();
  let y = PH - MARGIN;

  const ensure = (need: number) => { if (y - need < MARGIN) { page = doc.addPage([PW, PH]); y = PH - MARGIN; } };
  const drawText = (
    str: string,
    opts: { size?: number; f?: PDFFont; indent?: number; gap?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = opts.size ?? 9;
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
  const heading = (str: string) => { ensure(18); y -= 3; drawText(str, { size: 10.5, f: bold, gap: 3, color: rgb(0.05, 0.18, 0.23) }); };

  drawText("Driver's Employment Application", { size: 15, f: bold, gap: 2, color: rgb(0.05, 0.18, 0.23) });
  drawText("Pursuant to 49 CFR 391.21.", { size: 8, gap: 8 });
  drawText(`${carrier.name}\n${carrier.address}\nU.S. DOT ${carrier.dot} · MC ${carrier.mc}`, { size: 9, gap: 10 });

  heading("Applicant");
  drawText(`Name: ${data.name || ""}`, { f: bold, gap: 2 });
  drawText(`Current address: ${data.address || ""}`, { gap: 2 });
  drawText(`Date of birth: ${fmtDate(data.dob)}    Phone: ${data.phone || ""}    Email: ${data.email || ""}`, { gap: 2 });
  drawText(`Position applied for: ${data.positionApplied || ""}    Date available: ${fmtDate(data.dateAvailable)}`, { gap: 8 });

  heading("Address history (past 3 years)");
  if (data.addresses.length === 0) drawText("None provided.", { gap: 6 });
  data.addresses.forEach((a) => drawText(`${a.address || "-"}   (${fmtDate(a.from)} to ${fmtDate(a.to)})`, { indent: 4, gap: 2 }));
  if (data.addresses.length) y -= 4;

  heading("Employment history");
  if (data.employers.length === 0) drawText("None provided.", { gap: 6 });
  data.employers.forEach((e) => {
    drawText(`${e.name || "-"} - ${e.position || ""}`, { f: bold, indent: 4, gap: 1 });
    drawText(`${e.address || ""}   (${fmtDate(e.from)} to ${fmtDate(e.to)})`, { size: 8.5, indent: 8, gap: 1 });
    drawText(`Reason for leaving: ${e.reasonLeaving || "-"}. Subject to FMCSRs: ${e.subjectFmcsr ? "Yes" : "No"}. Safety-sensitive function: ${e.safetySensitive ? "Yes" : "No"}.`, { size: 8.5, indent: 8, gap: 4 });
  });

  heading("Driving experience");
  if (data.experience.length === 0) drawText("None provided.", { gap: 6 });
  data.experience.forEach((x) => drawText(`${x.equipmentClass || "-"} / ${x.equipmentType || "-"}   (${fmtDate(x.from)} to ${fmtDate(x.to)})   approx ${x.approxMiles || "-"} miles`, { indent: 4, gap: 2 }));
  if (data.experience.length) y -= 4;

  heading("Accident record (past 3 years)");
  if (data.noAccidents || data.accidents.length === 0) drawText("I certify I have had no accidents in the past 3 years.", { gap: 6 });
  else data.accidents.forEach((a) => drawText(`${fmtDate(a.date)} - ${a.nature || "-"}. Fatalities: ${a.fatalities || "0"}. Injuries: ${a.injuries || "0"}.`, { indent: 4, gap: 2 }));

  heading("Traffic convictions (past 12 months)");
  if (data.noConvictions || data.convictions.length === 0) drawText("I certify I have had no traffic convictions in the past 12 months.", { gap: 6 });
  else data.convictions.forEach((c) => drawText(`${fmtDate(c.date)} - ${c.offense || "-"} (${c.location || "-"}). Penalty: ${c.penalty || "-"}.`, { indent: 4, gap: 2 }));

  heading("Driver's licenses");
  if (data.licenses.length === 0) drawText("None provided.", { gap: 6 });
  data.licenses.forEach((l) => drawText(`${l.state || "-"}   #${l.number || "-"}   ${l.classType || "-"}   exp ${fmtDate(l.expiration)}`, { indent: 4, gap: 2 }));
  if (data.licenses.length) y -= 4;

  heading("Certification");
  drawText(CERT, { gap: 8 });

  ensure(110);
  y -= 4;
  drawText("Applicant's signature", { size: 9, f: bold, gap: 3 });
  const boxTop = y;
  const boxH = 54;
  if (data.signatureDataUrl) {
    try {
      const png = await doc.embedPng(data.signatureDataUrl);
      const dims = png.scaleToFit(220, boxH - 6);
      page.drawImage(png, { x: MARGIN + 4, y: boxTop - dims.height, width: dims.width, height: dims.height });
    } catch { /* leave blank */ }
  }
  page.drawLine({ start: { x: MARGIN, y: boxTop - boxH }, end: { x: MARGIN + 260, y: boxTop - boxH }, thickness: 0.6, color: rgb(0.4, 0.42, 0.45) });
  y = boxTop - boxH - 2;
  drawText(`Printed name: ${data.name || ""}`, { size: 8, gap: 1 });
  drawText(`Date: ${fmtDate(data.signedDate)}`, { size: 8, gap: 6, color: rgb(0.4, 0.42, 0.45) });

  const bytes = await doc.save();
  return new Blob([bytes.slice()], { type: "application/pdf" });
}
