/**
 * On-device PDF for the Annual Driver's Certification of Violations (C4.2).
 *
 * Structured form -> generated PDF (the approach chosen for DQ forms). The legal
 * text is the standard 49 CFR 391.27 certification; the layout is ours. The Blob
 * is uploaded to the driver's DQ file via the normal DQ upload endpoint.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getCompanyInfoCached } from "./companyInfo";

export type Violation = {
  date: string;      // YYYY-MM-DD (conviction date)
  offense: string;
  location: string;
  vehicleType: string;
};

export type CertViolationsData = {
  driverName: string;
  licenseNumber: string;
  licenseState: string;
  noViolations: boolean;
  violations: Violation[];
  signatureDataUrl: string;
  signedDate: string;   // YYYY-MM-DD
};

const PW = 612;
const PH = 792;
const MARGIN = 54;
const MAXW = PW - MARGIN * 2;

const CERT_LIST =
  "I certify that the following is a true and complete list of traffic violations (other than parking violations) for which I have been convicted or have forfeited bond or collateral during the past 12 months.";
const CERT_NONE =
  "I certify that I have not been convicted of, or forfeited bond or collateral on account of, any violation (other than a parking violation) required to be listed during the past 12 months.";

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

export async function generateCertViolationsPdf(data: CertViolationsData): Promise<Blob> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([PW, PH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const carrier = getCompanyInfoCached();

  let y = PH - MARGIN;
  const ensure = (need: number) => {
    if (y - need < MARGIN) {
      page = doc.addPage([PW, PH]);
      y = PH - MARGIN;
    }
  };
  const drawText = (
    str: string,
    opts: { size?: number; f?: PDFFont; indent?: number; gap?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
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

  // Title + carrier
  drawText("Driver's Certificate of Violations", { size: 15, f: bold, gap: 2, color: rgb(0.05, 0.18, 0.23) });
  drawText("Annual certification pursuant to 49 CFR 391.27.", { size: 8, gap: 8 });
  drawText(
    `${carrier.name}\n${carrier.address}\nU.S. DOT ${carrier.dot} · MC ${carrier.mc}`,
    { size: 9, gap: 10 },
  );

  // Driver identity
  drawText(`Driver's name: ${data.driverName || "________________"}`, { f: bold, gap: 2 });
  drawText(
    `Driver's license number: ${data.licenseNumber || "____________"}    State: ${data.licenseState || "____"}`,
    { gap: 10 },
  );

  // Certification
  if (data.noViolations || data.violations.length === 0) {
    drawText(CERT_NONE, { gap: 10 });
  } else {
    drawText(CERT_LIST, { gap: 8 });
    // Table header
    ensure(16);
    drawText("Date of conviction    Offense / violation    Location    Type of vehicle operated", { size: 8, f: bold, gap: 3 });
    data.violations.forEach((v, i) => {
      const row = `${i + 1}.  ${fmtDate(v.date) || "-"}   ${v.offense || "-"}   ${v.location || "-"}   ${v.vehicleType || "-"}`;
      drawText(row, { size: 9, indent: 4, gap: 2 });
    });
    y -= 6;
  }

  // Signature
  ensure(110);
  y -= 6;
  drawText("Driver's signature", { size: 9, f: bold, gap: 3 });
  const boxTop = y;
  const boxH = 54;
  if (data.signatureDataUrl) {
    try {
      const png = await doc.embedPng(data.signatureDataUrl);
      const dims = png.scaleToFit(220, boxH - 6);
      page.drawImage(png, { x: MARGIN + 4, y: boxTop - dims.height, width: dims.width, height: dims.height });
    } catch {
      /* bad image data - leave blank */
    }
  }
  page.drawLine({ start: { x: MARGIN, y: boxTop - boxH }, end: { x: MARGIN + 260, y: boxTop - boxH }, thickness: 0.6, color: rgb(0.4, 0.42, 0.45) });
  y = boxTop - boxH - 2;
  drawText(`Printed name: ${data.driverName || ""}`, { size: 8, gap: 1 });
  drawText(`Date: ${fmtDate(data.signedDate)}`, { size: 8, gap: 6, color: rgb(0.4, 0.42, 0.45) });

  const bytes = await doc.save();
  return new Blob([bytes.slice()], { type: "application/pdf" });
}
