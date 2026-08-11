/**
 * On-device PDFs for the two Road Test documents (C4.3), 49 CFR 391.31.
 * Office-filled (an examiner completes them for a driver). Structured form ->
 * generated PDF, same approach as the certification of violations.
 *
 *   generateRoadTestFormPdf  - the examiner's rated evaluation of the drive.
 *   generateRoadTestCertPdf  - the certificate that the driver passed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getCompanyInfoCached } from "./companyInfo";

// The operations a driver is evaluated on (391.31(b)).
export const ROAD_TEST_OPERATIONS: string[] = [
  "Pre-trip inspection",
  "Coupling and uncoupling combination units (if operated)",
  "Placing the vehicle in operation",
  "Use of vehicle controls and emergency equipment",
  "Operating in traffic and while passing other vehicles",
  "Turning the vehicle",
  "Braking and slowing by means other than braking",
  "Backing and parking the vehicle",
];

export type RoadTestFormData = {
  driverName: string;
  testDate: string;
  vehicleType: string;
  ratings: { operation: string; rating: string }[];
  remarks: string;
  examinerName: string;
  examinerTitle: string;
  signatureDataUrl: string;
  signedDate: string;
};

export type RoadTestCertData = {
  driverName: string;
  licenseNumber: string;
  licenseState: string;
  powerUnitType: string;
  testDate: string;
  miles: string;
  examinerName: string;
  examinerTitle: string;
  signatureDataUrl: string;
  signedDate: string;
};

const PW = 612;
const PH = 792;
const MARGIN = 54;
const MAXW = PW - MARGIN * 2;

function wrap(str: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of (str || "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxW && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
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

type Kit = {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  drawText: (str: string, opts?: { size?: number; f?: PDFFont; indent?: number; gap?: number; color?: ReturnType<typeof rgb> }) => void;
  drawSig: (label: string, dataUrl: string, printedName: string, whenIso: string) => Promise<void>;
};

async function startPdf(title: string, subtitle: string): Promise<Kit> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([PW, PH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const carrier = getCompanyInfoCached();
  let y = PH - MARGIN;

  const ensure = (need: number) => {
    if (y - need < MARGIN) { page = doc.addPage([PW, PH]); y = PH - MARGIN; }
  };
  const drawText: Kit["drawText"] = (str, opts = {}) => {
    const size = opts.size ?? 9.5;
    const f = opts.f ?? font;
    const indent = opts.indent ?? 0;
    const color = opts.color ?? rgb(0.1, 0.1, 0.12);
    const lh = size + 3;
    for (const line of wrap(str, f, size, MAXW - indent)) {
      ensure(lh);
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font: f, color });
      y -= lh;
    }
    y -= opts.gap ?? 5;
  };
  const drawSig: Kit["drawSig"] = async (label, dataUrl, printedName, whenIso) => {
    ensure(110);
    y -= 6;
    drawText(label, { size: 9, f: bold, gap: 3 });
    const boxTop = y;
    const boxH = 54;
    if (dataUrl) {
      try {
        const png = await doc.embedPng(dataUrl);
        const dims = png.scaleToFit(220, boxH - 6);
        page.drawImage(png, { x: MARGIN + 4, y: boxTop - dims.height, width: dims.width, height: dims.height });
      } catch { /* leave blank */ }
    }
    page.drawLine({ start: { x: MARGIN, y: boxTop - boxH }, end: { x: MARGIN + 260, y: boxTop - boxH }, thickness: 0.6, color: rgb(0.4, 0.42, 0.45) });
    y = boxTop - boxH - 2;
    if (printedName) drawText(`Printed name: ${printedName}`, { size: 8, gap: 1 });
    drawText(`Date: ${fmtDate(whenIso)}`, { size: 8, gap: 6, color: rgb(0.4, 0.42, 0.45) });
  };

  drawText(title, { size: 15, f: bold, gap: 2, color: rgb(0.05, 0.18, 0.23) });
  drawText(subtitle, { size: 8, gap: 8 });
  drawText(`${carrier.name}\n${carrier.address}\nU.S. DOT ${carrier.dot} · MC ${carrier.mc}`, { size: 9, gap: 10 });
  return { doc, font, bold, drawText, drawSig };
}

export async function generateRoadTestFormPdf(data: RoadTestFormData): Promise<Blob> {
  const k = await startPdf("Driver's Road Test", "Road-test evaluation pursuant to 49 CFR 391.31.");
  k.drawText(`Driver's name: ${data.driverName || "________________"}`, { f: k.bold, gap: 2 });
  k.drawText(`Date of test: ${fmtDate(data.testDate)}    Type of vehicle: ${data.vehicleType || "____________"}`, { gap: 10 });

  k.drawText("Operation    Rating", { size: 8, f: k.bold, gap: 3 });
  data.ratings.forEach((r) => {
    k.drawText(`${r.operation}:  ${r.rating || "-"}`, { size: 9, indent: 4, gap: 2 });
  });
  if (data.remarks.trim()) {
    k.drawText(`Remarks: ${data.remarks.trim()}`, { gap: 8 });
  }
  k.drawText(`Examiner: ${data.examinerName || ""}${data.examinerTitle ? `, ${data.examinerTitle}` : ""}`, { gap: 6 });

  await k.drawSig("Examiner's signature", data.signatureDataUrl, data.examinerName, data.signedDate);
  const bytes = await k.doc.save();
  return new Blob([bytes.slice()], { type: "application/pdf" });
}

export async function generateRoadTestCertPdf(data: RoadTestCertData): Promise<Blob> {
  const k = await startPdf("Driver's Road Test Certificate", "Certification pursuant to 49 CFR 391.31.");
  k.drawText(`Driver's name: ${data.driverName || "________________"}`, { f: k.bold, gap: 2 });
  k.drawText(`Driver's license number: ${data.licenseNumber || "____________"}    State: ${data.licenseState || "____"}`, { gap: 2 });
  k.drawText(`Type of power unit: ${data.powerUnitType || "____________"}`, { gap: 10 });

  k.drawText(
    `This is to certify that the above-named driver was given a road test under my supervision on ${fmtDate(data.testDate) || "____________"}, consisting of approximately ${data.miles || "____"} miles of driving. It is my considered opinion that this driver possesses sufficient driving skill to operate safely the type of commercial motor vehicle listed above.`,
    { gap: 10 },
  );
  k.drawText(`Examiner: ${data.examinerName || ""}${data.examinerTitle ? `, ${data.examinerTitle}` : ""}`, { gap: 6 });

  await k.drawSig("Examiner's signature", data.signatureDataUrl, data.examinerName, data.signedDate);
  const bytes = await k.doc.save();
  return new Blob([bytes.slice()], { type: "application/pdf" });
}
