// The Digital Bill of Lading contract clauses (16 CFR §375.505 sections
// 2-14 + digital-adapted 15-16). Kept in its own module so both the PDF
// generator (bolPdf.ts) and the BOL editor UI can import them without
// dragging in pdf-lib.

export type BolContractSection = {
  n: number;
  title: string;
  body: string;
};

// ── Option / label maps for the FMCSA-required BOL fields (ADR 0023) ──────────
// Shared by the BOL editor (the select/radio controls) and the PDF generator so
// the stored value ("cod", "released", ...) renders one consistent human label.

export type BolOption = { value: string; label: string; blurb?: string };

export const FORM_OF_PAYMENT_OPTIONS: BolOption[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "credit_card", label: "Credit card" },
  { value: "cod", label: "Collect on delivery (COD)" },
  { value: "other", label: "Other" },
];

export const ESTIMATE_TYPE_OPTIONS: BolOption[] = [
  { value: "binding", label: "Binding" },
  { value: "non_binding", label: "Non-binding" },
];

export const VALUATION_OPTIONS: BolOption[] = [
  {
    value: "full_value",
    label: "Full Value Protection",
    blurb:
      "The mover is liable for the replacement value of lost or damaged goods for the entire shipment. This is the more protective option and may carry an additional charge.",
  },
  {
    value: "released",
    label: "Released Value (60 cents per pound, per article)",
    blurb:
      "No additional charge, but recovery for a lost or damaged article is limited to 60 cents per pound for that article regardless of its actual value. This is a waiver, made freely and in writing.",
  },
];

/** Human label for a stored option value; falls back to the raw value. */
export function bolOptionLabel(options: BolOption[], value: string | undefined | null): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label || value;
}

export const BOL_CONTRACT_SECTIONS: BolContractSection[] = [
  { n: 2, title: "Additional Motor Carriers [§375.505(b)(2)]", body: "Any additional motor carriers that will participate in this shipment are recorded on this Bill of Lading (Additional carriers), with their name, address, telephone, and U.S. DOT number when known. Recorded as None if there are none." },
  { n: 3, title: "Shipper (Customer) Information [§375.505(b)(3)]", body: "The individual shipper's name, address, and telephone number are recorded on this Bill of Lading and confirmed by the shipper as accurate and complete at signing." },
  { n: 4, title: "Shipment Details [§375.505(b)(16)]", body: "The shipment / job reference number, the Bill of Lading issue date, and the origin (pickup) and destination (delivery) addresses are recorded on this Bill of Lading and confirmed at signing." },
  { n: 5, title: "Pickup and Delivery Dates [§375.505(b)(6)(8)]", body: "The estimate type (binding or non-binding) and the agreed pickup and delivery dates or windows are recorded on this Bill of Lading. The actual pickup date is recorded at the time of loading (Section 16)." },
  { n: 6, title: "Vehicle Identification [§375.505(b)(9)]", body: "The vehicle unit / plate / company ID used for this shipment is recorded at the time of loading (see origin signing, Section 16)." },
  { n: 7, title: "Valuation [§375.505(b)(12)]", body: "The shipper elects one of two liability options, recorded on this Bill of Lading and chosen freely and in writing as required by federal law. FULL VALUE PROTECTION: the mover is liable for the replacement value of lost or damaged goods for the entire shipment; this option may carry an additional charge. RELEASED VALUE: no additional charge, but recovery for a lost or damaged article is limited to 60 cents per pound for that article regardless of its actual value, as provided by the Surface Transportation Board's Released Rates Order. The shipper's election is shown in the Valuation section of this Bill of Lading." },
  { n: 8, title: "Third-Party Insurance [§375.505(b)(13)]", body: "If the shipper purchased separate liability insurance from an independent insurer for this shipment, the insurer and premium are recorded on this Bill of Lading. Recorded as None if there is none." },
  { n: 9, title: "Services and Charges [§375.505(b)(4)(10)(11)(14)]", body: "The form of payment honored at delivery and any special or accessorial services ordered are recorded on this Bill of Lading. Final charges are based on actual time and materials unless this is a binding estimate. Mountaineer Moving bills from departure from dispatch to return to dispatch, in quarter-hour increments rounded up after 5 minutes; minimum charge 2 hours. For a collect-on-delivery shipment, Mountaineer Moving will not demand more than 110% of a non-binding estimate, or the exact binding estimate amount, at delivery to release the shipment." },
  { n: 10, title: "Delivery Notification Contact [§375.505(b)(5)]", body: "For a shipment transported on a collect-on-delivery basis, the person to be notified about charges prior to delivery is recorded on this Bill of Lading, or is the same as the shipper." },
  { n: 11, title: "Attachments and Reference [§375.505(b)(15)(17)]", body: "The following are incorporated into this Bill of Lading: the estimate (binding or non-binding, as recorded above); the declared inventory / item list (below); the Contract for Moving Services; \"Your Rights and Responsibilities When You Move\" (FMCSA-ESA-03-006); \"Ready to Move?\" (FMCSA-ESA-03-005); and the Arbitration Program Summary (Section 13). This Bill of Lading incorporates by reference all services ordered for this shipment." },
  { n: 12, title: "Loss and Damage Claims", body: "All claims for loss or damage must be submitted in writing to Mountaineer Moving LLC (management@mountaineermoving.com) within 9 months following the date of delivery or the date the shipment should have been delivered, whichever is later. This federal timeframe cannot be shortened by contract. The shipper must participate in a final walk-through before departure and document any damage at that time; failure to identify damage during the walk-through constitutes acceptance of the condition of the goods. Mountaineer Moving is not responsible for damage to the contents of boxes packed by the shipper." },
  { n: 13, title: "Arbitration Program Notice [§375.211]", body: "Mountaineer Moving maintains a neutral arbitration program for loss-and-damage disputes and disputes over additional charges, as required by 49 CFR 375.211 and 49 U.S.C. 14708. Arbitration is OPTIONAL - the shipper retains the right to pursue judicial remedies under 49 U.S.C. 14704. The arbitrator is a neutral third party. A complete written summary is available on request (management@mountaineermoving.com)." },
  { n: 14, title: "Acknowledgment of Required Publications [§375.213]", body: "Federal law requires Mountaineer Moving to provide, before execution of this Bill of Lading: (1) \"Your Rights and Responsibilities When You Move\" (FMCSA-ESA-03-006) and (2) \"Ready to Move?\" (FMCSA-ESA-03-005), both available at www.fmcsa.dot.gov. By signing at origin, the shipper confirms receipt of, or a link to, each publication." },
  { n: 15, title: "Right to Rescind and Delivery of Copies [§375.505(h)]", body: "PRE-SIGNING REQUIREMENT: This Bill of Lading must be in the shipper's possession at least 3 days before the shipment is scheduled to be loaded. Do not sign on moving day unless items or services added that day require an updated estimate, in which case only the charge changes are exempt from the 3-day requirement.\nRIGHT TO RESCIND: The shipper may cancel this Bill of Lading without penalty within 3 days of the date of signing, by notifying Mountaineer Moving in writing (management@mountaineermoving.com) or by calling (406) 201-9580 within that window.\nELECTRONIC COPY PROCEDURE: This Bill of Lading is executed electronically. At the time of each signing, Mountaineer Moving provides the shipper a dated PDF copy of the signed document - downloaded to the shipper's device and/or emailed to the address on file. Mountaineer Moving retains the signed electronic record (the equivalent of the carrier copy) for a minimum of one year from the date of issue. The signed Bill of Lading remains accessible to the crew on the company device throughout transportation, in place of a printed copy carried in the cab." },
  { n: 16, title: "Signatures [§375.505(f)]", body: "This Bill of Lading is signed twice, electronically: once at origin before loading, and once at destination upon delivery. Mountaineer Moving provides the shipper a dated electronic copy at the time of each signing.\nELECTRONIC SIGNATURE CONSENT: By signing electronically below, each party agrees that their electronic signature is legally binding and equivalent to a handwritten signature for the purposes of this Bill of Lading.\nBy signing at origin, the shipper confirms: (a) all information in this Bill of Lading is accurate; (b) the valuation election in Section 7 was made freely with full understanding of both coverage options; (c) the required federal publications in Section 14 were received; and (d) the shipper agrees to the terms and conditions of this Bill of Lading, and acknowledges it has been in their possession at least 3 days prior to signing, or that today is the moving day and only charge adjustments from new or additional services are being made. At destination, by signing the shipper confirms receipt of the shipment and that a final walk-through was completed with the crew; any damage attributable to Mountaineer Moving was identified and documented at that time." },
];
