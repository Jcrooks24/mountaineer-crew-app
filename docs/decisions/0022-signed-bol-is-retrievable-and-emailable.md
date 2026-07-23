# 0022. A signed BOL is retrievable on demand and emailable; the email path is online-only

**Status:** Active. Decided 2026-07-23 after a driver on a long-distance
California job could not produce the signed Bill of Lading at a border crossing.
The DOT officer wanted the actual signed contract showing the origin and
destination addresses; the app could show only that a signature had been
captured, and the addresses were nowhere on the document.

## Context

The Digital BOL (ADR 0018, 0020, 0021) generates the signed PDF on-device at
signing time and hands the shipper a copy, then uploads it to Drive on sync.
Three gaps surfaced at the border:

1. **No retrieval after origin signing.** The on-device PDF was produced once,
   at the moment of signing, and then only re-offered in the `delivered` state.
   Between origin signing and delivery - exactly the long-haul window when a BOL
   gets inspected - there was no button to reproduce it.
2. **No addresses on the BOL.** The PDF's shipment summary carried the job name
   and dates but not the pickup/delivery addresses. A job name is not an address,
   and an interstate BOL is inspected for both endpoints.
3. **No way to send the client a copy** other than the crew's own share sheet at
   signing time.

## Decision

**Add a persistent "Signed Bill of Lading" card (shown whenever the BOL is past
`draft`) that regenerates the signed PDF on-device on demand, print the origin
and destination addresses on the BOL, and let the crew email the client a copy.
The retrieval path is offline-capable; the email path is online-only.**

- **Retrieval is on-device and offline-capable.** The card's "View / download"
  button calls the same `generateBolPdf(draft)` used at signing. Every signature
  and address lives in the local draft, so the driver can produce the signed BOL
  at a border with no signal. This is the load-bearing fix for the incident.

- **Addresses are captured at origin signing (required) and remain editable.**
  They are DOT-required on the printed document, so origin signing is blocked
  until both are entered. They are also editable from the retrieval card, so a
  BOL signed before this feature - or with a typo - can be corrected and
  re-issued without re-signing.

- **Addresses are stored in `shipment_json`, not new columns.** They ride the
  existing flexible blob (same as `actual_pickup_date`, `vehicle`, the printed
  names), so there is no migration. A plain submit now echoes the *entire* known
  shipment (`draftToPayload`), because the server replaces `shipment_json`
  wholesale when `shipment` is present; sending only the addresses would wipe the
  other shipment fields. All shipment fields round-trip through `draftFromServer`,
  so the echo is always complete.

- **The email path is deliberately online-only.** `emailBolToClient` throws if
  offline; the crew sees a clear message and uses View / download (which works
  offline) to hand over a copy instead. Sending mail inherently needs
  connectivity, and queuing a signed-PDF-plus-recipient for later delivery would
  ship a *stale* copy if the BOL changed after enqueue, and duplicate the copy
  the office already stores in Drive. The endpoint (`POST /api/bol/{id}/email`)
  fails honestly - 4xx for a bad address, 502 for a Postmark failure - so the
  caller never reports a false "sent."

## Consequences

- The signed BOL is reproducible at any stage from the device, offline.
- The office Sheet gains `origin_address` / `destination_address` columns
  (appended non-destructively by `_ensure_tab`).
- Email reuses the existing Postmark mailer (`POSTMARK_SERVER_TOKEN` + `SMTP_FROM`);
  no new env var. `send_email` gained an optional `attachments` parameter.

## What would break if you undid this

- **If you make the email path offline-queued** "to match offline-first": you
  reintroduce the stale-copy risk (the queued PDF is a snapshot; the BOL can
  change) and can double-deliver. Offline-first is satisfied by the *retrieval*
  path, which is offline; email is the online-only exception on purpose.
- **If you change `draftToPayload` to send only the addresses** (or any partial
  shipment) on submit: the server's wholesale `shipment_json` replace drops
  `actual_pickup_date`, `vehicle`, and the printed names. Send the whole known
  shipment or none of it.
- **If you drop the origin-signing address requirement:** BOLs leave origin
  without the two fields the DOT officer asked for, which is the exact exposure
  this ADR closes.
