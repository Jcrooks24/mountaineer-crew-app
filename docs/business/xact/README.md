# Prior xact product-definition work

xact is a product-definition platform being evaluated to structure the next
phase of this app: harden it, then extend it into the system the combined
company runs on.

Two projects were created in it by accident, from an email-registration
mistake. Both were partially completed. They were then reset in favour of a
single clean project, and these exports exist so that the work already done is
not done twice.

**These files are a record of prior work, not a specification.** Nothing in
them has been ratified. Where they conflict with the SOP, the ADRs, or the
code, those win.

> **Read [CONTRADICTIONS.md](CONTRADICTIONS.md) before either export.** The two
> exports disagree with each other, with this repo, and in places with
> themselves. That file lists all fifteen conflicts, says which need a human
> decision, and ends with the short list of answers that are actually worth
> carrying forward.

## The files

| File | Original name | Turns | Free-text answers |
|---|---|---|---|
| [CONTRADICTIONS.md](CONTRADICTIONS.md) | written here, not exported | | |
| [export-A-crew-app-framing.md](export-A-crew-app-framing.md) | `mms-field-app-dialogue.md` | 47 | 6 |
| [export-B-m1-install-framing.md](export-B-m1-install-framing.md) | `mms-feild-ap-dialogue.md` | 49 | 12 |
| [meeting-notes-2026-07-29.md](meeting-notes-2026-07-29.md) | Gemini notes, Roger and Jacob, 2026-07-29 | | |

Both exports are dated 2026-07-29 and cover release v2.3.

## The important part: the two projects describe different products

They are not two drafts of the same thing, and merging them naively would
produce a specification for an app nobody asked for.

**Export A is framed around this app.** An internal, hybrid mobile and desktop
tool, offline-capable, not sold through any platform. That matches what is in
this repo.

**Export B is framed around M1's furniture-installation workflow.** Per-item
barcodes scanned against a project inventory, printed delivery tickets being
displaced, a hold-harmless release for damage-risk actions, and an import of the
existing msWhse content database including item images. That is real work and it
is where the combined company is heading, but it is a future module, not a
description of the app that exists today.

Export B also carries the merger constraints in the owner's own words: a
December 31 close, with app and data migration off msWhse needed before close so
staff can be trained for January 1 use.

## Why they diverged

The exports were not two attempts at the same brief. The project was
under-specified at the outset and the objective drifted during the interviews:
the stated goal is to **harden the existing field app**, but many answers were
given as though the goal were to **build the unified business brain**. The
platform's AI could not tell those apart, so it kept widening scope, and each
project widened in a different direction.

Compounding it, neither project was told the app already exists and is in daily
field use. Both interviewed from a standing start, so both describe the pre-app
world as the present one and re-specify shipped features as new MVP scope.

[CONTRADICTIONS.md](CONTRADICTIONS.md) works through all of it: invented product
names and launch dates, a native-versus-PWA split that the repo already settles,
a genuine unresolved requirement conflict on remote wipe, a factually wrong
FMCSA rationale, and two full commercial legs that ran after the owner had twice
said go-to-market work was out of scope.

That last one is the clearest argument for the discipline the meeting landed on:
load the reference documents first, and let the AI ask questions second.

## What the reset decided

From the 2026-07-29 meeting with Roger (xact) and Adam (M1):

1. **The field app is the cornerstone.** Harden this app first, then add other
   components to it. Warehouse inventory management is the named next module.
2. **Start one clean project**, importing these exports so prior answers carry
   forward.
3. **Turn the AI off during initial project setup**, so the reference documents
   (this repo, the GitHub link, the SOP) are fully ingested before it starts
   asking questions. This was the direct fix for the AI not picking up
   `ARCHITECTURE.md` and `RUNBOOKS.md` from the repo.
4. **Define team roles before engaging the system**, so questions can be routed
   to the right person and nobody is blocked waiting on someone else's answer.

Open action at the time of writing: these exports still need a cleanup pass to
strip redundancy before import.

## Who is who in these files

- **Jacob Crooks** is the PM role and the author of this repo.
- **Adam DeFanti** is an owner of M1 Logistics, in the customer advocate role.
  Export B is largely his framing.
- **Hailey** is Mountaineer's administrator, in the customer advocate role in
  export A. She appears as "Haley" in the meeting notes.
- **Roger Ruttiman** is xact's CEO.
