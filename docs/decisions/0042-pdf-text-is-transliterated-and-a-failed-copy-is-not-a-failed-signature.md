# 0042 - PDF text is transliterated to WinAnsi, and a failed copy is not a failed signature

Date: 2026-09-02
Status: Accepted

## Context

A crew member filed one bug against the Digital BOL with four symptoms
(`a8c1da24`, 2026-08-31):

1. the Jobs tab showed the BOL signed at **both** origin and destination when
   only the origin had been signed;
2. the BOL never landed in Google Drive;
3. the crew could neither view nor email the signed PDF;
4. the BOL was absent from "Continue an open BOL" and could only be reached by
   starting a new one.

They are one defect and one bad recovery path.

### The defect

`bolPdf.ts` builds the document with pdf-lib's `StandardFonts.Helvetica`, which
is **WinAnsi-encoded**. Handed a character outside that encoding, pdf-lib does
not substitute or drop it - it throws, and the throw takes the whole document:

```
WinAnsi cannot encode "≈" (0x2248)
```

U+2248 is not exotic here. A BOL with no items inherits the job's Actual
Inventory ([ADR 0026](0026-bol-inherits-actual-inventory.md)), and the chow/box
volume estimator writes its result into the item notes as
`≈ 320 cu ft, ≈ 2,240 lbs (8x7x6 ft, medium)`. **Every BOL seeded from a volume
estimate could not produce a PDF**, which is symptom 3 directly, and symptom 2 as
well: the queued `pdf` op regenerates from the same draft on each drain, so the
Drive upload was never reached.

The wider exposure is not the estimator. It is that item names, condition notes
and walk-through notes are free text typed on a phone, two taps from arrows,
maths symbols and emoji, and every one of them was a document-killer.

### The recovery path that turned it into a wrong record

`signSession` captured the signature and then generated the copy **inside one
try block**. So a build failure was reported as:

> Could not complete signing. Your data is saved - try again.

The signature had in fact been captured, persisted and queued. The status was
already `origin_signed`, which means the single signing button had already
changed meaning. A crew member who did as the message said was not re-signing
origin: the second signature was applied to the **destination** phase, and the
BOL went to `delivered` on a truck that had only been loaded.

That is symptoms 1 and 4 in one move. `delivered` is what the Jobs-tab checklist
reads for "BOL signed at destination", and `listOpenBols` filters `delivered`
out of the chooser, so the document also disappeared from the list.

### What made it survivable for weeks

The queue drain classified a generation failure as **transient**. Transient means
keep, back off, retry - and a `pdf` op carries no `failed_at`, so no banner. The
same deterministic failure re-ran every couple of minutes, silently, forever. The
view button said `Could not open the BOL. Try again.` and named nothing, so it
could be neither acted on nor reported ([ADR 0020](0020-bol-durability-and-honest-failures.md)
asks these paths to fail honestly; this one did not).

## Decision

**1. No string reaches pdf-lib without passing through `lib/winAnsi.ts`.**
`toWinAnsi()` passes through everything WinAnsi can encode (accents, `§`, `·`,
curly quotes, en and em dashes - the legal text of the BOL is byte-identical),
transliterates known symbols to their ASCII reading (`≈` to `~`, `≤` to `<=`,
`→` to `->`, `✓` to `[x]`), decomposes what is left (`ō` to `o`), drops
zero-width and formatting characters and emoji, and only then falls back to `?`.

The call sits inside each generator's `wrap()`, which is the single funnel every
drawn string already passes through, and which also measures the text. Sanitizing
there keeps the measured string and the drawn string identical - measuring one
and drawing the other wraps lines in the wrong places.

Applied to all four on-device generators, not just the BOL: `bolPdf`,
`dqCertViolationsPdf`, `dqEmploymentAppPdf`, `dqRoadTestPdf`. They share the
font, the funnel and the exposure to typed text.

**2. Producing the copy is a separate step from signing, and says so.** The
signature is captured, persisted and queued first; the PDF is built in its own
`try`. A build failure now reports what actually happened and what not to do:

> The signed copy could not be produced on this device (...). The signature IS
> recorded - do not sign again. Use "View / download signed BOL" to retry the copy.

The outer catch keeps "try again" for the one case where it is true: the
signature itself could not be saved.

**3. The destination press is confirm-gated.** One button carries both phases and
changes meaning the instant origin is signed, and `delivered` is a one-way door:
it closes the BOL and drops it out of the chooser, with no way back in the app.
Origin signing stays one tap.

**4. A PDF that cannot be BUILT is a permanent failure, not a transient one.**
`BolPdfBuildError` is raised when generation (as opposed to upload) fails, and
the drain marks the op failed so the existing red banner shows it. Retrying a
deterministic failure is not a retry, it is a loop that never ends and never
says anything. Safe to mark because `pdf` is the last op in a BOL's sequence, so
failing it holds nothing behind it ([ADR 0013](0013-rejected-queue-work-is-never-deleted.md)
still applies: it is kept, never deleted).

**5. And a `pdf` op that cannot be UPLOADED gives up being quiet after 8 online
attempts.** Upload failures really are worth retrying, so they keep the backoff -
but a wrong `DRIVE_BOL_FOLDER_ID` or an expired credential returns the same 502
forever, and "retry every two minutes for the life of the install, silently" is
the same defect wearing a different hat. `PDF_MAX_TRANSIENT_ATTEMPTS = 8` is
roughly ten minutes of connectivity: far longer than a Drive hiccup, far shorter
than never.

This is the only capped op in the app, and it should stay that way. `submit` and
`sign` carry signatures, and a marked `submit` blocks the two ops behind it, so a
cap there would strand a signed BOL behind a banner during a bad-signal
afternoon. `pdf` has neither property.

A human Retry now also resets `attempts` and `retry_at`, not just the failure
mark. Pressing Retry means "try it now", and it previously could sit out a
backoff of up to two minutes doing nothing observable.

## Consequences

- The transliteration is lossy on purpose. A crew member who types CJK or an
  emoji into a condition note will not see it on the PDF. That is the correct
  trade against a document that refuses to exist, and the on-screen record keeps
  the original text - only the printed copy is transliterated.
- Do not "fix" a future encoding error by embedding a Unicode TrueType font
  instead. That means shipping a font file (hundreds of KB) into an offline-first
  bundle, and subsetting it per document, to render characters that have no place
  on a DOT form. Add an entry to `TRANSLITERATE` instead.
- Do not move the `toWinAnsi` call out of `wrap()` to a caller. Every caller is
  one edit away from forgetting, and the measurement must see the same string.
- BOLs already marked `delivered` by this bug are wrong records and the app
  cannot walk a status back. Correcting one is a database edit, listed in
  RUNBOOKS.
