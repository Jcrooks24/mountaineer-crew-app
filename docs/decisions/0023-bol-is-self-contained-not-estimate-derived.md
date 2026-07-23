# 0023. The BOL is self-contained and crew-entered, not derived from the estimate

**Status:** Active. Decided 2026-07-23. Extends [ADR 0022](0022-signed-bol-is-retrievable-and-emailable.md)
(retrievable/emailable signed BOL) and [ADR 0018](0018-bol-is-one-document-per-job.md).

## Context

The Digital BOL's contract text (`frontend/src/lib/bolContract.ts`, sections
2-10) repeatedly said each required data element was "carried forward from the
signed estimate and confirmed at signing." It was not. A full trace found that
**no estimate data was ever captured or auto-filled into the BOL** - the prose
was boilerplate with nothing behind it. The crew also cannot open the estimate
in the field. The result was a **weakly compliant** document: it referenced
shipper information, form of payment, estimate type, agreed dates, and - most
seriously - the **valuation election** (the shipper's legally required choice of
liability coverage under 49 CFR 375.505(b)(12)), none of which were anywhere on
the document or in the data.

## Decision

**Capture the FMCSA 49 CFR 375.505 required fields directly from the crew, as
required manual entry, and drop the estimate dependency entirely.** The crew
looks up customer/job details from the Google Calendar job description and types
them in; there is no autofill.

- **Required fields, entered before origin signing** (blocked until filled, in
  `signSession`'s origin branch): shipper name / phone / address (b)(3); origin
  and destination addresses; shipment reference (b)(16); form of payment (b)(4);
  estimate type (b)(15); **valuation election** (b)(12); agreed pickup and
  delivery (b)(6). Actual pickup date (b)(8) and vehicle (b)(9) are captured at
  the origin-signing card as before.
- **Conditional, low-burden, default None/N-A**: COD notify contact + max
  (b)(5),(11), shown only when payment is COD; additional carriers (b)(2);
  third-party insurance (b)(13); accessorial services (b)(14).
- **Valuation is election-only, no dollar entry** (owner's call): the shipper
  picks Full Value Protection or Released Value (60 cents/lb); the electronic
  signature affirms the choice. No declared-value amount is captured.
- **UX mirrors the Job Report tab**: one scroll of small `card` tiles
  (Shipper & shipment, Payment & estimate, Valuation, Agreed dates, Other
  declarations), `*` on required fields, one imperative validation pass at
  signing. The detail cards render only while `status === "draft"`.
- **Storage reuses the ADR 0022 shipment_json pattern - no migration.** Every
  field rides `shipment_json`; `draftToPayload` echoes the whole known shipment
  on submit, and the queued submit runs before the sign, so the fields reach the
  server without touching `BOLSignIn`. The sheet export gained readable columns.
- **The contract text was rewritten** to describe data "recorded on this Bill of
  Lading" instead of "carried forward from the signed estimate."

## Consequences

- The BOL stands on its own: everything a DOT officer or a claim needs is on the
  document, captured in the field.
- The valuation election is finally captured and printed.
- One more compliance follow-on is possible later without rework: a declared
  value amount for Full Value Protection is an additive field.

## What would break if you undid this

- **If you re-introduce "carried forward from the estimate" language** or try to
  auto-populate the BOL from an estimate: the crew cannot see the estimate on
  site, so the fields go blank again and the document is non-compliant. The data
  belongs to the BOL, entered by the crew.
- **If you make the detail fields optional at signing**: BOLs leave origin
  missing federally required elements (this is the exact hole that was closed).
- **If you send a partial `shipment` on submit** (see ADR 0022): the server's
  wholesale `shipment_json` replace drops the other fields. Send the whole known
  shipment or none.
