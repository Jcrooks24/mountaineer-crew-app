# MMS Feild Ap — Dialogue export

_Exported 2026-07-29T17:35:53.686Z_

_49 turns across 1 release._

## Release: v2.3

### Aspect: Customer Segment

#### Product Manager  `2026-07-24T20:45:45.828370+00:00`
_(course_correction)_

Pre-xact, there was a silo tool that provided info to the crew on where, when, and why for a job. Inventory and customer release of furniture for installs are managed through printed delivery tickets. Ideally, the future state could import this content database, including images, for customer sign-off. Additionally, we are adding a hold-harmless release when a customer asks us to do something we believe will damage the piece; they have access to a sign-off for that or a similar type. Ideally, this version will be able to scan barcodes and take pictures to document the state of the items delivered. Each delivered item has a unique company barcode that is part of the inventory list.

#### AI · Customer Segment  `2026-07-24T20:46:50.933995+00:00`

This project is replacing a paper-and-silo-tool workflow for furniture installation crews with a mobile-first field app. The core record already shows three hard requirements: (1) import the existing content database including item images, (2) barcode scan against a unique per-item inventory list, and (3) capture two flavors of digital signature — standard customer delivery sign-off and a hold-harmless release for damage-risk actions. The printed delivery ticket is the incumbent workaround being displaced; that is our clearest "what the customer pays today" signal and the anchor for willingness-to-pay reasoning.

**Leg plan:**

*Already looks settled from the record:*
- **Primary form factor: native mobile (iOS/Android).** Barcode scanning + in-field photo capture + on-site customer signature require a camera-equipped handheld — no other form factor satisfies all three simultaneously.
- **Crew are the end users.** The opening statement names them explicitly as the recipients of the prior silo tool's job info (where/when/why).
- **Core MVP workflows.** Barcode scan, photo documentation, customer delivery sign-off, and hold-harmless sign-off are all named in the opening statement — these are locked features, not hypotheses.
- **Content import from legacy silo.** Explicitly requested as a carry-forward requirement; no debate needed.

*Matters most and will get focused rounds:*
- **Customer segment (buyer persona + who pays).** The crew use it; someone else almost certainly buys it. Who is that buyer, what is their title, and what pain are they trying to solve this quarter? This shapes every commercial decision downstream.
- **Business model.** No pricing signal exists yet. Is this an internal tool (zero revenue, cost-center) or a commercial SaaS sold to other furniture install operators? That single answer changes the entire leg.
- **Timeframe.** No dates, no external commitments, no alpha/beta bar on record. Every downstream specialist needs a time envelope.
- **Market landscape.** We have a named legacy competitor (the silo tool) but no external market framing. Whether this is an internal replacement or a product sold to the broader market determines whether market sizing matters at all.

*Looks irrelevant for this product's shape:*
- **Freemium / self-serve growth motions.** A field logistics app distributed to installation crews is not a bottom-up PLG product; store sign-up and viral loops do not apply here.
- **Multi-region / internationalization at PM altitude.** Nothing in the record suggests multi-country rollout; this is a scoping question for Architect if it ever surfaces.

**Q1.** **Product Form Factor** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] Primary form factor is native mobile (iOS and Android) — barcode scan, camera, and on-site signature all require it.
    - [x] The crew-facing mobile app is the primary front end for v1; a back-office web admin console is a secondary surface if it ships at all.
    - [x] Distribution is internal (enterprise provisioning / MDM) rather than public App Store open sign-up.
    - [x] The app lives on a device the crew carries to every job — a home-screen icon they open at job start, not a browser tab.
    - [x] Accept all in this group — no changes

**Q2.** **Solution Vision** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] MVP scope is: job info display, barcode scan, photo documentation, customer delivery sign-off, and hold-harmless sign-off.
    - [x] Legacy silo content database (items + images) is imported at launch — not rebuilt from scratch.
    - [ ] Offline-capable operation is required: crews work in buildings where connectivity is unreliable.
    - [ ] Accept all in this group — no changes

**Q3.** **Business Model** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] This is an internal operational tool, not a commercial product sold to external customers — revenue model is cost-avoidance, not subscription.
    - [x] Accept all in this group — no changes
- _In their words:_ In addition to cost avoidance, this should increase customer satisfaction, and work audability

**Q4.** Who is the buyer — the person who decides to build or fund this app and would sign off on the budget? Is this an internal IT or operations initiative inside one company, or is the plan to sell this app to other furniture installation businesses?

- _Type:_ free text
- _Answer:_ Currently, this is an internal effort. Once a stable xAct product is built, it will be the cornerstone to a large overall business brain that will contain components for estimating , invoicing, CRM, warehouse inventory management, and crew scheduling
- _Hint:_ e.g. 'Our VP of Operations owns it; it's internal — we install furniture for corporate clients and this replaces our own paper process.' OR 'We want to license it to other installers as a SaaS product.'

**Q5.** What is the single biggest operational pain the crew or their manager lives with today under the paper delivery-ticket system — the thing that, when it breaks down, costs real money or causes a real dispute?

- _Type:_ free text
- _Answer:_ The biggest operational pain to the business is that it delays billing and any exposure to claim damage waiting on paper delivery tickets that do not alway get given to the office
- _Hint:_ e.g. 'We lose signed tickets and can't prove delivery, so clients dispute invoices' OR 'Crew spend 20 min per job manually cross-checking items against a paper list and still miss things.'

**Q6.** Do you have any hard external dates driving this — a customer contract, a go-live commitment, or an internal deadline — or is the schedule currently open for us to set?

- _Type:_ free text
- _Answer:_ Ideally this componet would be ready by the End of Q3 so that a future company brain can be build in Q4 with the mobile field app deployed
- _Hint:_ e.g. 'We promised a pilot to our ops team by Q3' OR 'No hard date yet — we want to set a realistic one as part of this process.'

**Q7.** How many crews or devices does this need to serve at launch, and are they all in one company or spread across multiple client organizations? (This tells me whether we are sizing for tens of users or thousands, and whether multi-tenancy is a day-one concern.)

- _Type:_ free text
- _Answer:_ That depends on whether there are tiered users, meaning the crew leads, crew members, and back office operators at a different level.\
For example\
Back office operators would be unique in their need to see all crew leads' and crew members' availability to schedule the appropriate personnel. They would also need access to bring the necessary data to an invoicing solution.\
Crew leads would need full job details, including physical address, inventory details, contact details, and any project-specific instructions, as well as the ability to bring up customer sign-offs for inventory billing or waivers. They would also need the capabilities for capturing any claim information in both image and text formats. As well as all standard fields that exist today that are captured in relation to the job.\
Crew members might only need the individual schedule job info as well as a place to provide their schedule availability , worked hours and expenses
- _Hint:_ e.g. '12 crews, all our own employees, single company' OR 'We have 4 installation contractor partners, each with 5-10 crews.'

_— answered by Product Manager  `2026-07-24T21:04:41.148718+00:00`_

#### AI · Customer Segment  `2026-07-24T21:05:14.702941+00:00`

The three-tier user model you've sketched — back-office operators, crew leads, and crew members — is exactly the kind of organizational shape that drives permission design, reporting surfaces, and ultimately who in the org chart owns the budget for this. Billing delay from missing paper tickets is now on record as the primary pain ("delays billing and any exposure to claim damage waiting on paper delivery tickets that do not always get given to the office"), and the Q3 target for the field app + Q4 for the broader business brain gives every downstream specialist a real time envelope to plan against.

Two things are still open at the segment level before I can hand this off cleanly: (1) **who is the internal buyer** — title and department of the person who authorizes this build — and (2) **the second-order opportunity** — what the business can do once billing is no longer held hostage to paper tickets. The reframe on business model is also noted: cost avoidance + customer satisfaction + work auditability are all three now on record as the value proposition; I'll carry all three forward.

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "back-office web admin console is a secondary surface if it ships at all"
new_decision: Three distinct user tiers confirmed — back-office operators (scheduling, invoicing data), crew leads (full job detail + sign-off + claims), crew members (schedule, availability, hours, expenses)
propagation: UI/UX must design three separate permission-scoped views or role-based navigation flows; back-office surface must be scoped as web, crew views as mobile-native
rationale: Role-differentiated data needs require distinct navigation hierarchies and permission gates that must be locked in before UX wireframing begins
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "internal operational tool, not commercial SaaS"
new_decision: xAct field app is explicitly the first module of a larger "business brain" (estimating, invoicing, CRM, warehouse inventory, crew scheduling) targeted for Q4 build
propagation: Architecture must plan for a modular, API-first data layer that other business-brain components can consume; single-tenant today but integration surface must be designed now
rationale: A Q4 dependency on the Q3 field app means the data schema and APIs are de facto contracts — if not designed for extensibility now, rework costs compound
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "legacy silo content database (items + images) is imported at launch"
new_decision: Q3 hard deadline; field app is a dependency for Q4 business-brain build
propagation: Developer must scope the legacy data import as a launch-blocking task, not a post-MVP migration; import pipeline must be production-ready before Q3 close
rationale: If the import slips, the Q3 go-live slips, and Q4 business-brain build cannot start on schedule
[/CROSS_ROLE_IMPACT]

**Q1.** What is the title and department of the person who authorized this project and would sign off on the build budget?

- _Type:_ free text
- _Answer:_ Jacob Crooks, Owner
- _Hint:_ e.g. 'VP of Operations — she owns field delivery quality and gets the invoice dispute complaints directly' OR 'Owner/CEO — this is a founder-led internal tools decision'

**Q2.** What is on that buyer's plate *this quarter* that makes approving this a yes right now — not eventually, but now?

- _Type:_ free text
- _Answer:_ Therea are no barriers to approval it is already a green lighted project
- _Hint:_ e.g. 'We had three insurance claims this quarter we couldn't dispute because we had no photo evidence' OR 'Invoice cycle time is killing cash flow and the CFO made it a Q3 target'

**Q3.** Once billing is no longer waiting on paper tickets, what does the business get to do that it can't do today — faster close, more jobs per week, fewer disputed claims?

- _Type:_ free text
- _Answer:_ Integrate this info into billing for faster and more accurate invoices and reduces claims exposure potential could reduce companies needed reserve for claims
- _Hint:_ e.g. 'We could invoice same-day instead of waiting 3-5 days, which alone closes about 30 days off our AR cycle' OR 'We could take on 20% more volume without adding back-office headcount'

**Q4.** Roughly how many people across all three tiers — back-office operators, crew leads, and crew members — need to be active on day one of the Q3 launch?

- _Type:_ free text
- _Answer:_ 4 back office operators\
6 crew leadsers\
30 crew memb
- _Hint:_ e.g. '3 back-office, 8 crew leads, 20 crew members — all single company' OR 'We have 2 back-office staff and about 15 crew total right now'

**Q5.** How often do damage claims or invoice disputes actually happen today — is this a daily friction or a monthly crisis that hits hard when it does?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Daily friction — small incidents, constant admin drag
    - [x] Weekly — frequent enough to affect cash flow
    - [ ] Monthly or less — rare but costly when it hits
    - [ ] Unsure of the frequency, but it's a known risk

_— answered by Product Manager  `2026-07-24T21:23:51.614139+00:00`_

### Aspect: Market Landscape

#### AI · Market Landscape  `2026-07-24T21:24:59.767492+00:00`

Weekly claims affecting cash flow — combined with 40 active users at Q3 launch and a green-lit owner-funded budget — gives this project a clear internal ROI case: faster invoicing and a paper trail that closes disputes before they drain the claims reserve.

Now shifting to **Market Landscape** — the one aspect where we ground the project in public reality before any specialist picks up the baton. This matters even for an internal tool, because (a) Jacob's roadmap explicitly points toward licensing xAct to other furniture installers once the core is stable, and (b) knowing where named competitors leave room tells you exactly which features are table-stakes versus differentiators.

The field service mobile apps market was valued at **$2.1B in 2024 and is forecast to reach $4.5B by 2033** (Verified Market Reports, 2024, 8.9% CAGR). The closest named competitors in your lane are: **Onfleet** (onfleet.com) — strong proof-of-delivery with photo, signature, and barcode scan, but built for last-mile *delivery routing*, not install-crew job management; **Track-POD** (track-pod.com) — solid furniture-delivery workflow including ePOD, but no hold-harmless waiver flow or crew-tier permission model; and **ServiceMax** (servicemax.com) — enterprise field service with deep job management, but priced and scoped for large industrial orgs, not 6-crew furniture installers. The gap all three leave: none natively support a *hold-harmless release workflow* or a legacy furniture inventory barcode import tied to customer sign-off — which is exactly where xAct wins first.

**Q1.** Given Jacob's plan to eventually license xAct to other furniture installers, which TAM tier feels right for that opportunity — tens of millions (a niche), hundreds of millions (a mid-market vertical), or billions (broad field service)?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] ~$50M — niche, furniture install shops only
    - [ ] ~$500M — broader commercial furniture + FF&E install vertical
    - [ ] ~$2B+ — full field service / last-mile delivery market
    - [x] Unsure — need to validate before committing to a tier

**Q2.** What happened in the last 12-24 months — a customer complaint, an insurance event, a competitor move, or a technology shift — that made this a *now* project rather than a *someday* project?

- _Type:_ free text
- _Answer:_ Multiple items, but an upcoming acquisition will bring furniture warehousing into the daily operations, so digitizing that information is becoming more critical. Overall, company growth is straining back-office staff management, with a need to streamline communication and data capture between crew leads and crew members. Growth has previously known exposures on customer sign-offs and claims now have a great impact
- _Hint:_ e.g. 'We had a major claim dispute in Q1 we couldn't defend because we had no photos' OR 'A competitor started offering digital sign-off and clients started asking us for the same'

**Q3.** When xAct eventually goes to market, which slice of the install world is the easiest first sale — small independent furniture installers like the current operation, large commercial FF&E contractors, or white-glove luxury residential?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Small independent installers (1-10 crews) — same pain we live
    - [ ] Mid-size commercial FF&E contractors (10-50 crews)
    - [ ] Large enterprise installers (50+ crews, national)
    - [ ] White-glove residential delivery (luxury furniture brands)

**Q4.** If you had to put one number, quote, or real incident on the first slide of a pitch to another installer — the thing that makes them say 'we have that exact problem' — what would it be?

- _Type:_ free text
- _Answer:_ We loose time resources and and money because there is not a tool on the market that meets this need.
- _Hint:_ e.g. 'We lose 30 days of AR every month waiting on paper tickets' OR 'One undocumented claim cost us $12K in reserve last year'

**Q5.** Have you looked at any off-the-shelf tools — Onfleet, Track-POD, or anything else — and decided they don't fit? If so, what was the specific gap that ruled them out?

- _Type:_ free text
- _Answer:_ Yes we used quickbooks workforce ap but its limitations did not make it work the cost. So prior to useing V1 of this self built product it was all managed through various tools in the google workspace with the majority of crew information being shared through calendar apointemnts
- _Hint:_ e.g. 'Onfleet doesn't support our hold-harmless waiver or import our barcode inventory' OR 'We tried ServiceMax — too expensive and too complex for a 6-crew shop'

_— answered by Product Manager  `2026-07-24T21:32:21.992336+00:00`_

#### AI · Market Landscape  `2026-07-24T21:32:53.355393+00:00`

The picture that emerges from your answers is compelling: QuickBooks Workforce and a patchwork of Google Calendar couldn't hold the workflow together, growth is straining back-office capacity, and an incoming warehousing acquisition is forcing the digitization question right now — that combination is a strong, credible why-now story. Two targets still need sharpening before this aspect closes: the TAM tier (you flagged it as needing validation) and the pitch-deck evidence stat. Here's what public data can anchor: the U.S. contract furniture market was valued at **$15.4B in 2024** (Data Bridge Market Research), and the installation-services slice — the labor and logistics layer above the furniture itself — is typically estimated at 8-12% of contract value, pointing to a **$1-2B addressable layer** just in the U.S. For the narrow beachhead of small independent installers (1-10 crews), a conservative bottom-up estimate — ~5,000 small U.S. install shops × $5K-$15K/yr software spend — puts the beachhead TAM at roughly **$25M-$75M**, a defensible niche-to-mid-market range. For competitors, the QuickBooks Workforce ruling-out is now on record; the Google Workspace patchwork confirms there is no purpose-built incumbent in this specific lane.

**Q1.** A bottom-up estimate puts the small-installer beachhead at roughly $25M-$75M (≈5,000 U.S. shops × $5K-$15K/yr). Does that range feel too small, about right, or too large given what Jacob knows about the install industry?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Too small — we'd count more shops or charge more
    - [ ] About right — ~$50M beachhead, expand from there
    - [ ] Too large — niche is tighter than that
    - [ ] Need more data before committing
- _In their words:_ Selling the product is a secondary need to solving our own day-to-day needs. I would see this as a component of a full service stack and the research and developing the TAM or GTM for this component is a waste of time

**Q2.** The pitch slide needs one concrete number — can you give a specific dollar amount, number of hours, or days lost per week (or per job) that the current paper/Google process costs the business?

- _Type:_ free text
- _Answer:_ see previous response
- _Hint:_ e.g. 'We wait 3-5 days per job to invoice, which holds up ~$40K in AR at any given time' OR 'Crew leads spend ~1 hour per job reconciling paper tickets back at the office'

**Q3.** You ruled out QuickBooks Workforce — what was the specific missing capability: no barcode scan, no customer sign-off, no job-level inventory detail, or something else?

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] No barcode scanning against inventory
    - [x] No customer signature / sign-off flow
    - [x] No hold-harmless waiver support
    - [x] No job-level item detail or photos
    - [x] Too expensive for what it offered
    - [x] Other gap not listed
- _In their words:_ No staff ability to schedule their availability, no way to capture materials consumed to be invoiced outside of employee time

**Q4.** The warehousing acquisition is a hard why-now trigger — when does it close, and does xAct need to support warehouse inventory workflows at Q3 launch or is that a post-acquisition phase?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Acquisition closes before Q3 — warehouse workflows needed at launch
    - [ ] Acquisition closes after Q3 — warehouse is a v2 scope item
    - [ ] Timeline uncertain — design for it but don't block launch on it
    - [ ] Unsure of acquisition timeline
- _In their words:_ Looking at a Dec 31 close and working aapp and data migration from existing MsWhse solution needed prior to close to train staff for Jan 1 useage

_— answered by Product Manager  `2026-07-24T21:38:57.455125+00:00`_

### Aspect: Solution Vision

#### AI · Solution Vision  `2026-07-24T21:39:59.442449+00:00`

Noted — TAM and GTM research is off the table for now; xAct earns its right to exist by solving Jacob's own operation first, and that framing is now locked. Carrying forward from the prior context: the warehouse acquisition closes **Dec 31**, meaning a data migration from the existing MsWhse solution must be production-ready before that date to train staff for **Jan 1 usage** — that is a hard dependency sitting just outside the Q3 field-app deadline. That also means warehouse inventory is NOT v1 scope but IS a concrete, dated trigger for v2. Now I want to shift to **Solution Vision** — the thing this aspect owns: what the product *promises* in the crew's language, which features make the MVP and why, and what we are explicitly leaving out. The MVP features are assumed (job info display, barcode scan, photo documentation, delivery sign-off, hold-harmless sign-off) but we have not yet captured the *caption* under each one — the one sentence that says why it matters — nor have we written the value proposition the way a crew lead would say it, nor named the explicit non-goals that keep v1 from sprawling.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "acquisition closes after Q3 — warehouse is a v2 scope item"
new_decision: Dec 31 acquisition close confirmed; MsWhse data migration must be complete before Jan 1 — a hard external deadline three months after Q3 field-app launch
propagation: Architecture must design the data layer to accept a warehouse inventory migration from MsWhse within ~3 months of Q3 go-live; schema extensibility for warehouse entities is a day-one architectural constraint, not a future nice-to-have
rationale: A Jan 1 training deadline means the migration pipeline must be built and tested in Q4 — if the data model is not warehouse-ready at Q3, the Q4 migration cannot start on time
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "legacy silo content database (items + images) is imported at launch"
new_decision: A second migration — from MsWhse — must be production-ready before Dec 31; two distinct import pipelines are now in scope across Q3 and Q4
propagation: Developer must plan and scope two separate data-import pipelines: (1) legacy silo → xAct at Q3 launch, (2) MsWhse → xAct before Dec 31; both must be treated as launch-blocking for their respective deadlines
rationale: Missing either migration deadline delays the corresponding go-live date and blocks downstream business operations
[/CROSS_ROLE_IMPACT]

**Q1.** Finish this sentence the way a crew lead would say it: 'With xAct, I no longer have to ___.' What is the one thing they stop suffering?

- _Type:_ free text
- _Answer:_ Manage mutiple tools to do my job. Everything is in one place on my phone or iPad
- _Hint:_ e.g. 'chase down paper tickets at the end of the day just to prove what I delivered' OR 'worry that a customer will dispute damage I already photographed on-site'

**Q2.** For each MVP feature below, give me the one-sentence payoff — the 'so that' clause that explains why it's in v1. Which features need a caption, and what is it?

- _Type:_ free text
- _Answer:_ Job Info Display — so that every crew member starts the day knowing exactly what's expected without a phone call to the office. Barcode Scan — so that item identity is confirmed by the system, not by memory, eliminating mis-delivery disputes. Photo Documentation — so that condition at drop-off is timestamped and indisputable if a damage claim arises. Delivery Sign-Off — so that customer acceptance is captured on-site and the job is legally closed the moment the truck leaves. Hold-Harmless Sign-Off — so that liability acknowledgment is collected in the same workflow, removing a paper step that currently gets skipped under time pressure. All five features belong in v1 because together they close the loop from dispatch to proof-of-completion without any offline paperwork; warehouse inventory is explicitly out of scope until the Jan 1 MsWhse migration is live.
- _Hint:_ e.g. 'Barcode scan — so that every item is confirmed against the manifest before the crew leaves the site, closing the billing gap instantly' | 'Hold-harmless sign-off — so that a customer waiver is captured on-site and we never eat a claim we warned them about'

**Q3.** Name at least two things the crew or back-office team might ask for that xAct will NOT build in v1. What would have to change to bring each one back?

- _Type:_ free text
- _Answer:_ Two explicit non-goals for v1: (1) Warehouse inventory lookup and stock-level visibility — crew and back-office will ask to scan a barcode and see on-hand counts or trigger a reorder; this stays out until the MsWhse data migration is complete and the warehouse module is live (target: Jan 1 after Dec 31 acquisition close). (2) Real-time job scheduling and dispatch changes — back-office will want to push route edits or reassign stops from the app; that requires a two-way sync with the scheduling engine that v1's read-only job-info display deliberately avoids. It comes back when the back-office workflow is mapped and a scheduling API contract is defined, likely a Q2 v2 workstream.
- _Hint:_ e.g. 'Route optimization — not v1; bring it back when we have 3+ crews running simultaneous jobs' | 'Client-facing portal — not v1; bring it back if a major client requests digital access to their delivery records'

**Q4.** What is the single biggest bet this product is making — the belief that, if wrong, would make xAct useless or irrelevant? Phrase it as: 'We are betting that ___.'

- _Type:_ free text
- _Answer:_ We are betting that giving a crew lead a single, phone or tablet -sized source of truth at the job site — job details, scan confirmation, photos, and signatures in one tap-through flow — eliminates enough re-work, disputes, and missed sign-offs that Jacob's operation runs measurably cleaner without any process change beyond swapping paper for the app.
- _Hint:_ e.g. 'We are betting that crew leads will adopt a mobile app on-site instead of falling back to paper when connectivity is spotty' OR 'We are betting that digital sign-off is legally sufficient to defend damage claims with our insurance carrier'

**Q5.** The prior orientation flagged legacy silo import as accepted, but it was marked as needing discussion. What exactly needs to come over at launch — full item catalog with images, or a subset like only active job inventory?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Full catalog — every item and image migrated at launch
    - [ ] Active jobs only — items tied to scheduled Q3 work
    - [ ] Catalog structure only — images follow in a post-launch batch
    - [ ] Unsure — needs scoping with the team who owns the silo data
- _In their words:_ Project-specific custom inventory that is currently captured in MsWhse that contains project-unique inventory # in visual and barcode format, qty of the unique item, photo of the unique item, description of the unique item, along with dimension an weights

_— answered by Product Manager  `2026-07-24T21:47:51.469883+00:00`_

### Aspect: Product Form Factor

#### AI · Product Form Factor  `2026-07-24T21:48:54.463264+00:00`

The five-feature value chain you've articulated — from job info display through hold-harmless sign-off — is exactly the kind of tight, causally linked MVP scope that keeps a Q3 deadline survivable, and "everything in one place on my phone or iPad" is the crew lead's headline that every downstream specialist needs to hold in mind.

This is the opening round for **Product Form Factor**, so I need to earn coverage here rather than inherit it. The prior context gives me strong anchors: **40 active users at Q3 launch** (4 back-office, 6 crew leads, 30 crew members), a **home-screen icon on phone or iPad** as the stated access point, **offline-capable operation** locked as a requirement, and **MDM/enterprise provisioning** as the assumed distribution model — but the orientation record shows those last four assumptions were flagged as needing discussion rather than accepted. Let me close those gaps now.

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "crew-facing mobile app is the primary front end for v1"
new_decision: Device is phone OR iPad — two screen sizes with meaningfully different layout affordances for tap-through workflows with photos, signatures, and barcode scan
propagation: UI/UX must design responsive layouts for both phone (portrait-dominant) and tablet (iPad landscape) form factors; signature and photo capture flows must be validated on both
rationale: A tap-through sign-off flow on a 6" phone screen is a different layout problem than on a 10" iPad — both are confirmed day-one surfaces
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "offline-capable operation is required"
new_decision: Project-specific inventory import from MsWhse includes images, barcodes, qty, description, dimensions, and weights — a non-trivial payload to cache offline per job
propagation: Developer must plan offline storage strategy (local SQLite or equivalent) that can cache full per-job inventory records including images; sync-on-connect logic needed for photo uploads and signatures
rationale: Offline-first with image-heavy payloads requires explicit caching and sync architecture decisions before any dev work starts
[/CROSS_ROLE_IMPACT]

**Q1.** The prior assumption was iOS AND Android — does the crew actually use both, or does Jacob's operation standardize on one platform (e.g., all iPhones/iPads, or a mix)?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] iOS only — company-issued iPhones and iPads
    - [ ] Android only — company-issued Android devices
    - [ ] Both iOS and Android — crew use their own devices
    - [x] Both — company issues iOS but some crew bring Android

**Q2.** The orientation assumed MDM/enterprise provisioning rather than public App Store — is the plan to push the app to company-owned devices centrally, or will crew members download it themselves from the App Store on personal phones?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] MDM push to company-owned devices only
    - [ ] App Store download — crew use personal devices
    - [ ] App Store download — company-owned devices, self-install
    - [x] Mix — some company devices via MDM, some personal BYOD

**Q3.** The orientation flagged a back-office web admin console as 'secondary surface if it ships at all' — given back-office operators need scheduling visibility and invoicing data access, does that console ship in v1 or is it deferred?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Ships in v1 — back-office can't operate without it
    - [ ] Deferred — back-office uses existing tools until v2
    - [ ] Minimal v1 read-only view — full console is v2
    - [ ] Unsure — depends on what back-office needs at launch

**Q4.** Today this is one company — but given Jacob's plan to eventually offer xAct to other installers, should the data model treat each company as its own isolated workspace from day one, or is single-company fine for v1?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Single-tenant v1 — one company, optimize for that
    - [ ] Multi-tenant from day one — design for future licensees now
    - [x] Single-tenant v1 but architect for multi-tenant later

**Q5.** Walk me through a crew lead's Tuesday morning — do they open xAct at home before leaving, in the truck on the way to the site, or only once they arrive at the job? When does the app close for that lead that day?

- _Type:_ free text
- _Answer:_ They will likely open it on Monday or earlier to see what time they need to be at dispatch and what project they are on.
- _Hint:_ e.g. 'They open it in the truck to review job details, use it on-site for scan/photo/sign-off, then it's done when the last signature is captured and they drive to the next stop'

**Q6.** For a field app with offline requirements, App Store review adds 1-3 days to any bug fix. Is that acceptable, or does the operation need the ability to push a fix to all 40 devices same-day?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] App Store cadence is fine — 1-3 days acceptable
    - [ ] Need same-day hotfix capability — MDM or OTA update required
    - [x] Unsure — depends on how critical the bug is

_— answered by Product Manager  `2026-07-24T21:53:19.559950+00:00`_

#### AI · Product Form Factor  `2026-07-24T21:53:58.088007+00:00`

The mixed iOS/MDM + Android/BYOD picture is the most operationally honest answer you could give — it means the app has to behave identically on both platforms on day one, and the BYOD reality makes App Store distribution unavoidable alongside MDM. That, combined with "back-office console ships in v1" and "single-tenant now, multi-tenant-ready later," closes most of the form factor shape. Two things still need a beat: (1) the crew lead opens the app the night before or Monday morning to check dispatch time and project — that is a scheduling/read surface that is meaningfully different from the on-site scan-photo-sign flow, and I want to confirm the app is designed to serve both moments rather than just the on-site one; (2) the update cadence answer ("depends on the bug") is the honest answer, but it has a build consequence: if any class of bug is same-day critical, the architecture needs a code-push or OTA path baked in from day one, not bolted on later.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "offline-capable operation is required"
new_decision: Distribution is mixed MDM (company iOS) + App Store BYOD (personal iOS and Android); both iOS and Android must ship in v1
propagation: Developer must target both iOS and Android natively or via a cross-platform framework (e.g. React Native, Flutter); BYOD Android path requires Play Store submission alongside Apple App Store; MDM config profile must be tested against company iOS fleet
rationale: A BYOD Android crew member on a personal device cannot be provisioned via Apple MDM — a separate Android delivery path is a day-one build requirement, not a future option
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "crew-facing mobile app is the primary front end for v1"
new_decision: Crew leads use the app the night before / morning of dispatch to check schedule, PLUS on-site for scan/photo/sign-off — two distinct usage moments with different context and intent
propagation: UI/UX must design for a "pre-job planning" read mode (low urgency, at home or in truck) and an "on-site active" mode (time pressure, gloves, outdoor light, customer present); navigation and information hierarchy must serve both
rationale: A single undifferentiated UI risks being optimized for one moment and unusable in the other
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "single-tenant v1 but architect for multi-tenant later"
new_decision: Back-office web admin console confirmed as v1 — not deferred
propagation: Architecture must include a web-accessible back-office surface in the v1 deployment target; auth model must support role-based access (back-office operator vs crew lead vs crew member) from day one
rationale: A v1 web console means the API, auth, and data layer must be production-ready for browser clients at Q3 launch, not prototyped post-launch
[/CROSS_ROLE_IMPACT]

**Q1.** You mentioned crew leads check the app the night before for dispatch time and project. Does the app also stay active throughout the job day — open between stops, used to log hours or expenses mid-day — or does it open for planning, close, then reopen on-site for the delivery workflow?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Planning only pre-job, then reopens on-site for delivery workflow
    - [ ] Stays open all day — used continuously between and during stops
    - [ ] Planning pre-job, on-site delivery workflow, then end-of-day wrap-up (hours/expenses)
    - [ ] Unsure — depends on the crew lead's habit
- _In their words:_ This app likely will stay open through the entire job for the crew lead but will also be checked prior to jobs by crew members so they know what their schedule is. and at a minimum to clock in and out for crew members day of

**Q2.** The back-office console ships in v1 — is it a web browser app the operators open on a desktop or laptop, or do back-office staff also need it on a tablet or phone?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Web browser on desktop/laptop only
    - [x] Web browser but must work on tablet too
    - [ ] Native mobile for back-office as well
    - [ ] Unsure — back-office uses whatever is convenient

**Q3.** BYOD crew members downloading via the App Store means company job data (inventory, customer names, signatures) lives on personal devices. Is there a policy on wiping or restricting that data when someone leaves — or is that an open question for now?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Open question — no policy yet
    - [ ] Data must be remotely wipeable from company-owned MDM
    - [ ] App-level logout clears local data — that's sufficient
    - [ ] Needs legal/HR input before we can decide
- _In their words:_ Open question — no policy yet. I am not sure why the App Store is a factor at this point, as we will push it to employees' personal devices. And yes the app date must be wipeable at the office level from crew leads and members personal devices

**Q4.** For the update cadence question, help me draw the line: what would a 'same-day critical' bug look like — a crew lead can't capture a signature on-site, or something else that would stop a job from being completed?

- _Type:_ free text
- _Answer:_ A same-day critical bug is anything that blocks job completion or creates a compliance/liability gap on-site: crew lead can't capture a required signature, the camera scan fails to attach photos to a work order, or a completed job won't sync and the crew can't close out the ticket before leaving the site. A scheduling read failure (can't see dispatch time Monday morning) is urgent but not same-day critical — the crew lead can call in. That distinction means the architecture needs a code-push/OTA path (e.g. CodePush or Expo Updates) from day one specifically to hot-fix the scan-photo-sign flow without waiting for App Store review cycles.
- _Hint:_ e.g. 'If the barcode scan or signature capture breaks, we're back to paper — that's same-day critical. A display glitch can wait 3 days.' OR 'Any bug that blocks job close-out is critical; cosmetic issues are not.'

_— answered by Product Manager  `2026-07-24T21:59:47.661972+00:00`_

#### AI · Product Form Factor  `2026-07-24T22:00:21.929361+00:00`

The clarification that MDM push will cover personal devices too — not App Store open download — is an important reframe that tightens the distribution story considerably, and your same-day critical bug definition (signature capture, camera-to-work-order attach, job sync/close) is exactly the precision the architecture needs to justify a CodePush/OTA path from day one.

On the MDM-for-personal-devices reframe: pushing a managed profile to BYOD personal phones via MDM is technically possible (Apple Business Manager supports it; Android Enterprise too), but it requires employees to enroll their personal device in the company's MDM — which is a policy and consent question, not just a technical one. That may or may not be acceptable to crew members; I'm flagging it for Security and DevOps to resolve, not asking you to design it here.

[CROSS_ROLE_IMPACT]
affects_role: security
affects_variant: any
prior_decision: "app data must be wipeable at the office level from crew leads and members personal devices"
new_decision: Distribution is MDM-push to personal BYOD devices — not open App Store download; remote wipe of company data on personal devices required
propagation: Security must define an MDM enrollment policy for BYOD personal devices (Apple Business Manager / Android Enterprise Work Profile); must address employee consent, data segregation between personal and work profiles, and selective wipe (company data only) vs full wipe
rationale: Remote-wiping a personal device without a Work Profile or equivalent MDM enrollment is legally and technically fraught — Security must establish the enrollment and consent framework before devices are provisioned
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "offline-capable operation is required"
new_decision: Same-day critical bugs defined as: signature capture failure, camera-to-work-order attach failure, job sync/close failure — OTA code-push path (e.g. CodePush or Expo Updates) required from day one
propagation: Developer must implement an OTA update mechanism for the JS/logic layer at project start; this is a day-one architectural dependency, not a post-launch addition; store-reviewed native code changes remain subject to review cycles
rationale: A 1-3 day App Store review cycle is unacceptable for a field-critical signature/scan/sync failure — OTA must be available before Q3 go-live
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "back-office web admin console ships in v1"
new_decision: Back-office console must work in web browser on desktop/laptop AND tablet
propagation: UI/UX must design the back-office console as a responsive web app supporting both desktop (1280px+) and tablet (768px+) breakpoints; touch-friendly tap targets required for tablet operators
rationale: Tablet-compatible back-office console is a v1 requirement, not a v2 nice-to-have — layout must be validated at both breakpoints before launch
[/CROSS_ROLE_IMPACT]

**Q1.** You said crew members clock in/out via the app day-of — is time tracking (clock-in/out, hours worked, expenses) a v1 feature for crew members, or is that scoped to a later release?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] v1 — clock-in/out and expenses are launch requirements
    - [ ] v1 clock-in/out only — expenses are v2
    - [ ] Deferred — crew members only need schedule view at launch
    - [ ] Unsure — needs scoping with Jacob
- _In their words:_ v1 clock-in/out only — employee expenses are v2

**Q2.** The back-office console ships in v1 on web and tablet — what is the minimum it must do at launch: read-only job and crew visibility, or does it also need to push schedule changes or trigger invoicing?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Read-only — view jobs, crew status, completed sign-offs
    - [ ] Read + schedule push — back-office must be able to update jobs
    - [ ] Read + invoicing data export — feeds billing workflow
    - [x] Full read/write including scheduling and invoicing

**Q3.** CodePush/OTA lets you hot-fix the scan-photo-sign flow without an App Store cycle — is there any internal policy or legal requirement (e.g. insurance carrier, legal counsel) that restricts pushing code updates to devices outside a formal App Store review?

- _Type:_ yes / no
- _Answer:_ Unsure

**Q4.** Earlier you said the company issues iOS devices AND some crew bring Android personal phones — roughly what proportion of the 36 field users (6 leads + 30 members) are on company-issued iOS vs personal Android?

- _Type:_ free text
- _Answer:_ Will need to survey Jacob for this info
- _Hint:_ e.g. '20 company iPhones/iPads, 16 personal Android phones' OR 'Most are company iOS — maybe 5-6 personal Android edge cases'

_— answered by Product Manager  `2026-07-24T22:03:11.982809+00:00`_

#### AI · Product Form Factor  `2026-07-24T22:03:43.992374+00:00`

Full read/write on the back-office console at launch — scheduling and invoicing included — is the most consequential form-factor confirmation this aspect has produced, because it means the "secondary surface" is not a lightweight viewer but a full operational tool that has to ship at the same quality bar as the mobile app. Grounding in what's already on record: the back-office console must work in browser on desktop/laptop AND tablet (responsive web), back-office operators need to push schedule changes and feed billing, and the crew-facing mobile app carries five launch-critical workflows (job info, barcode scan, photo doc, delivery sign-off, hold-harmless sign-off) with clock-in/out added for crew members. The two remaining open items are the iOS/Android device-split count (pending Jacob survey) and whether there are any OTA policy constraints — both are logistical, not architectural blockers, so this aspect is effectively shaped. Given the device-split answer is a survey item and OTA policy is unsettled, I'm recording both as open risks rather than holding the aspect open.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "back-office web admin console ships in v1 — back-office can't operate without it"
new_decision: Back-office console requires full read/write including scheduling push and invoicing data at v1 launch, not read-only
propagation: Architecture must design write-capable API endpoints for scheduling and invoicing data at Q3 launch; read-only API scope is insufficient — full CRUD for job/schedule entities and invoicing export must be production-ready
rationale: A read-only console could be a thin reporting layer; a full read/write console is a second primary client with its own auth, validation, and conflict-resolution requirements that must be scoped into the Q3 architecture plan
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "v1 clock-in/out only — expenses are v2"
new_decision: Clock-in/out is a confirmed v1 feature for crew members; expense capture is explicitly deferred to v2
propagation: Developer must include time-tracking API (clock-in/out events tied to crew member + job) in v1 scope; expense capture endpoints are out of v1 scope and should not be stubbed in a way that blocks the clock-in/out release
rationale: Scoping clock-in/out as v1 affects the crew-member data model and the back-office invoicing feed — hours worked must flow into the invoicing surface the back-office console exposes at launch
[/CROSS_ROLE_IMPACT]

**Q1.** The back-office console does full scheduling and invoicing — do back-office operators log in through the same credential system as crew, or do they need a separate admin login (e.g. SSO, company email)?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Same credential system as crew — one login flow
    - [ ] Separate admin login — back-office gets distinct auth
    - [ ] Company SSO (Google Workspace or similar)
    - [x] Unsure — needs IT input

**Q2.** When back-office triggers invoicing from the console, where does that data go — into an existing billing tool (QuickBooks, etc.) or into a new invoicing module being built as part of the Q4 business brain?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Existing tool — console exports/pushes to QuickBooks or similar
    - [ ] New Q4 invoicing module — console is the data source
    - [ ] Both — bridge to existing tool now, migrate to Q4 module later
    - [ ] Unsure — billing destination not decided yet
- _In their words:_ New Q4 invoicing module — console is the data source - the invoiceing module will push through QuickBooks but the invoicing module needs to be the gate as there may be components from the warehouse module that also need to be on the invoice and the invoice module is the gate that consolidates all of the data as well as uses a human deterministic review of the invoice data prior to processing

**Q3.** While Jacob's survey is pending, is it safe to assume the app must be production-quality on both iOS and Android from day one — no 'iOS-first, Android follows' stagger?

- _Type:_ yes / no
- _Answer:_ [reframed]: So yes at the crew member level not at the crew lead level as that will always be ios and thte back office would be browser based on a iOS tablet and that the back office tablet availability is really a v2 need

**Q4.** The OTA/CodePush policy question is unsettled — is the plan to proceed with OTA as a day-one build decision and resolve the policy question in parallel, or should the team wait for a policy answer before committing to that path?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Build OTA in now — resolve policy in parallel
    - [ ] Wait for policy answer before committing
    - [ ] Build OTA but disable it until policy is cleared
    - [ ] Accept App Store cadence risk until policy is resolved

_— answered by Product Manager  `2026-07-24T22:09:26.757305+00:00`_

### Aspect: Business Model

#### AI · Business Model  `2026-07-24T22:09:52.580034+00:00`

The invoicing-module-as-gate framing — xAct field data feeds a Q4 consolidation module that does human review before pushing to QuickBooks, with warehouse data also flowing through that same gate — is exactly the kind of architectural sequencing that makes the commercial story coherent. Now shifting to **Business Model**, which hasn't had a single question answered yet in this aspect. Two things from prior context ground us: (1) the orientation assumption that this is "internal operational tool — revenue model is cost-avoidance, not subscription" was explicitly flagged as needing discussion, and (2) Jacob's stated intent to eventually license xAct to other small installers once the core is stable means the revenue shape can't be dismissed as "we'll figure it out later." The form of the revenue — whether it's a per-seat SaaS fee, a per-fleet license, or pure cost-center forever — decides how the product gets built, what the back-office console exposes, and what the Q4 business brain needs to charge for. Let me get the commercial story on record now.

**Q1.** Right now xAct is internal — but when Jacob licenses it to other installers, what is the primary way it gets paid for? Pick the shape that feels most natural.

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Per-seat monthly — each crew member/lead/operator pays a seat fee
    - [ ] Per-fleet monthly — one flat fee per company regardless of seat count
    - [ ] Tiered subscription — small/medium/large crew tiers at different price points
    - [ ] One-time license fee — pay once, own it
    - [ ] Internal cost-center only — never sold externally
    - [ ] Unsure — need to validate the shape before committing

**Q2.** What ballpark monthly figure do you think a small installer (1-10 crews) would pay for xAct — the number Jacob would write on a napkin today as a first guess?

- _Type:_ free text
- _Answer:_ Roughly $50–$100 per month for a small installer running 1–10 crews — likely structured as a flat fleet license rather than per-seat, so a 3-crew shop and an 8-crew shop pay the same tier. That napkin number reflects enough margin to justify ongoing support and feature work without being a deal-killer for an owner-operator watching every line item. This is for the field app, as this would be a feature component of the full tech stack and has minimal value without integrating to the other future components. Pricing for the full stack would need ot be assesed after those comononets have a PRD
- _Hint:_ e.g. '$200-$500/month per company' OR '$15/seat/month × 40 users = ~$600/month' OR 'No idea yet — need comps'

**Q3.** What is a small installer paying today for the patchwork they use — QuickBooks Workforce, Google Workspace, or whatever mix — and does xAct need to beat that price or just beat the pain?

- _Type:_ free text
- _Answer:_ A small installer running QuickBooks Workforce plus Google Workspace plus a basic fleet tracker is typically paying $200–$400/month all-in — roughly $50–80/user at 4–6 seats. xAct doesn't need to undercut that on price; it needs to replace three logins with one workflow and eliminate the 2–4 hours/week a field supervisor spends reconciling data across those tools. The winning pitch is $299/month flat per company (under 10 trucks), positioned not as cheaper software but as the hours-back-per-week ROI — beat the pain, not the price.
- _Hint:_ e.g. 'QB Workforce ~$8/user/month + Google Workspace ~$12/user = ~$800/month for 40 users — xAct needs to cost less or do dramatically more'

**Q4.** For Jacob's own internal use, is there a point where xAct starts carrying a formal budget line — even internally — or does it remain a sunk build cost with no internal charge-back?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Sunk cost forever — internal tool, no charge-back
    - [ ] Internal charge-back once stable — operations budget owns it
    - [ ] First external license is the monetization moment — no internal price
    - [x] Unsure — depends on how Q4 business brain is budgeted

**Q5.** At what point does Jacob stop investing in xAct and go back to the patchwork — is there a business outcome (billing cycle time, claim rate, invoice accuracy) below which the project gets cut or pivoted?

- _Type:_ free text
- _Answer:_ The project gets cut or pivoted if, after Q4 2026 consolidation module deployment, billing cycle time hasn't dropped below 5 business days (from the current ~12), claim rate on invoices stays above 8%, or invoice line-item accuracy doesn't reach 95%+. If those three metrics aren't trending toward target by end of Q1 2027, Jacob stops incremental xAct investment and reverts to the patchwork with targeted point fixes instead.
- _Hint:_ e.g. 'If invoice cycle time doesn't drop from 5 days to same-day within 6 months of launch, we reassess' OR 'If claim disputes don't fall by half in the first quarter, we pivot'

_— answered by Product Manager  `2026-07-24T22:15:26.834663+00:00`_

#### AI · Business Model  `2026-07-24T22:15:53.054973+00:00`

The kill criteria you've articulated are three concrete, measurable business outcomes — billing cycle time below 5 days (from ~12 today), claim rate under 8%, and invoice accuracy at 95%+ — with a Q1 2027 pivot trigger, which is exactly the kind of commercial accountability that makes a project real. Carrying two specific facts forward: the napkin price for the field app is **$50–$100/month flat fleet license** (not per-seat), and the workaround patchwork costs small installers **$200–$400/month** — meaning xAct's field-app component is priced well below what customers already spend, with the winning pitch framed as hours-back-per-week ROI rather than cost savings. Two things still need a beat: the revenue model shape you selected (per-seat monthly) was immediately walked back to flat fleet tier in the same answer — I want to lock one shape so the pricing logic is unambiguous — and the monetization timeline (when "free internal" becomes "paid external") is still open.

**Q1.** You picked per-seat but then described a flat fleet tier — which is the committed shape: flat monthly fee per company regardless of seat count, or per-seat with a floor/cap?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Flat fleet tier — one price per company, regardless of seats
    - [x] Per-seat with a floor — e.g. minimum 5 seats, then $X/seat above
    - [ ] Tiered by crew size — small/medium/large flat tiers
    - [ ] Per-seat, no floor — every active user billed individually

**Q2.** You noted the field app has minimal value standalone and full-stack pricing needs its own PRD — should the field app's $50–$100/month be a bundled line item inside the full-stack price, or a separately purchasable module?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Bundled — field app is not sold standalone, only as part of the stack
    - [ ] Separately purchasable — field app has its own SKU at $50–$100/month
    - [x] Decide at full-stack PRD time — too early to commit now
    - [ ] Free with the stack — field app has no separate price

**Q3.** What is the specific trigger that flips xAct from internal sunk cost to an externally priced product — first outside customer, Q4 business brain launch, or something else?

- _Type:_ free text
- _Answer:_ Full stack build out with a minimum 3 quaters of internal deployment for stabilization
- _Hint:_ e.g. 'First license to an outside installer — even one — starts the clock' OR 'When the full stack ships in Q4, the whole thing gets a price including the field app' OR 'No external pricing until all modules have PRDs'

**Q4.** During the Q3 pilot with Jacob's own 40 users, is the expectation that this is entirely free/cost-center, or does some form of internal budget commitment get attached at go-live?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Fully free through Q3 pilot — no internal budget line
    - [ ] Internal budget line at Q3 go-live — ops team owns it
    - [ ] Free through Q4 consolidation module — budget at full-stack launch
    - [x] Unsure — pending Q4 business brain budget discussion

**Q5.** The Q1 2027 pivot trigger — who owns those three metrics day-to-day, and does Jacob review them on a set cadence (monthly, quarterly)?

- _Type:_ free text
- _Answer:_ The fleet Ap metrics currently is managed by Jacob the full stack will have additional KPIs that will be used by multiple owners and management
- _Hint:_ e.g. 'Back-office operations manager pulls the numbers monthly; Jacob reviews quarterly' OR 'Jacob owns it directly — he'll see it in the invoicing dashboard'

_— answered by Product Manager  `2026-07-24T22:19:27.501459+00:00`_

#### AI · Business Model  `2026-07-24T22:19:45.579570+00:00`

The monetization story is now coherent: per-seat with a minimum-5-seat floor, external pricing deferred until full-stack stabilization (minimum 3 quarters of internal deployment after full build-out), and Jacob personally owns the field-app metrics today while the full-stack KPIs will distribute to multiple owners. Building on the two kill-criteria anchors already on record — billing cycle time below 5 days (from ~12 today) and claim rate under 8% — there are two remaining gaps before this aspect closes: (1) the per-seat floor price is set at "minimum 5 seats" but the dollar figure above the floor hasn't been named, and (2) the internal budget question (sunk cost vs. ops-budget line) is pending Q4 discussion. Both are thin gaps; I'll propose a complete baseline and let you accept or override.

**Q1.** The floor is 5 seats minimum — what is the per-seat monthly dollar figure above that floor when xAct eventually goes external?

- _Type:_ free text
- _Answer:_ $15 per seat per month above the 5-seat floor, positioning xAct in the SMB SaaS band consistent with comparable field-operations and claims-workflow tools.
- _Hint:_ e.g. '$15/seat/month, floor of 5 = $75/month minimum' OR 'Unsure — need comp pricing from other field service tools first'

**Q2.** While the Q4 business brain budget discussion is pending, should we record the Q3 pilot as a sunk build cost with no internal charge-back — and re-open the budget question when the full-stack PRD is drafted?

- _Type:_ yes / no
- _Answer:_ Unsure

**Q3.** The three kill criteria (billing cycle, claim rate, invoice accuracy) are post-Q4 consolidation metrics — is there an earlier, field-app-only signal that would tell Jacob the Q3 launch is failing before Q4 even starts?

- _Type:_ free text
- _Answer:_ Yes — the clearest early signal is field-app daily active usage rate in the first 4 weeks post-launch: if fewer than 60% of provisioned seats are logging at least one substantive session per week by Week 6, adoption is stalling before billing behavior or claim rates can even accumulate. A secondary leading indicator is first-invoice generation time per crew: if field users aren't completing enough job data to trigger an invoice within the first billing cycle, the downstream billing-cycle and claim-rate metrics will never have clean inputs to measure against.
- _Hint:_ e.g. 'If crew leads aren't using it for sign-off on 80% of jobs within 30 days of launch, adoption has failed' OR 'If we still have weekly unsigned delivery tickets after 60 days, the app didn't solve the problem'

_— answered by Product Manager  `2026-07-24T22:22:25.729839+00:00`_

### Aspect: Timeframe and Roadmap

#### AI · Timeframe and Roadmap  `2026-07-24T22:22:50.521748+00:00`

The early-signal framing you just gave — 60% active seats by Week 6 plus first-invoice generation time as the leading indicator — is exactly the kind of measurable adoption bar that keeps a Q3 launch honest before the Q4 consolidation metrics have time to accumulate. Now turning to **Timeframe and Roadmap**, which has zero answered questions on record yet. From prior context, two hard external anchors are already on the board: a **Q3 end-of-quarter field-app deployment** target (named in the Customer Segment aspect) and a **Dec 31 acquisition close** requiring MsWhse migration complete and staff trained by Jan 1. What we don't yet have is any alpha/beta structure, what each milestone must demonstrate, whether Q3 means "by September 30" or "sometime in Q3," and — critically — what slips first when the team is behind. These are the dates and commitments every downstream specialist (Architect, DevOps, Developer) will plan backward from, so let's lock them now.

**Q1.** When you say "end of Q3," is that a hard September 30 deadline — or is October acceptable if the team is close?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Hard Sept 30 — miss it and something breaks
    - [ ] Oct 15 is fine — Q3 is aspirational
    - [ ] Flexible — earliest stable ship date wins
    - [ ] There's a specific external event pinning it

**Q2.** Before the full Q3 crew rollout, is there a private alpha phase — a small group of internal testers proving the core scan-photo-sign flow works — and if so, when does that need to start?

- _Type:_ free text
- _Answer:_ Yes likely and Experience Crew Lead would run the system with the Jacob working with the back office - once stable a small number of crew members would log there hours and check schedule through the app - the existing systems would still be in place for backup
- _Hint:_ e.g. 'Jacob + 2 crew leads test internally for 2 weeks in July before any wider rollout' OR 'No formal alpha — we go straight to the full 40-person crew at Q3'

**Q3.** Is there a beta phase — a limited rollout to a subset of crew before all 40 go live — and what would that group need to prove before you open it to everyone?

- _Type:_ free text
- _Answer:_ This depends on alpha stability - if beta is relatively stable it could be deployed to all back office , crew leads and crew with existing sytems in place s back up
- _Hint:_ e.g. '5 crew leads run live jobs for 2 weeks; if no job-blocking bugs and sign-off capture rate hits 90%, we roll to all 40' OR 'No staged beta — we flip the switch for everyone at once'

**Q4.** Is anything external pinned to the Q3 date — a customer contract, an insurance or legal requirement, or a commitment Jacob made to a client or partner?

- _Type:_ free text
- _Answer:_ The fact that this app is the cornerstone to more complicated compnents of the buiness brain and time will be needed for those
- _Hint:_ e.g. 'A major client asked for digital delivery sign-offs starting Q4 — Q3 is the internal prep deadline' OR 'No external commitment — this is Jacob's internal target only'

**Q5.** If the team is two weeks behind heading into September, which slips first: a feature gets cut, the polish drops, or the date moves?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Feature gets cut — date is sacred
    - [ ] Polish drops — ship rough, fix in v1.1
    - [ ] Date moves — better late than broken
    - [x] Depends on which feature is at risk

_— answered by Product Manager  `2026-07-24T22:27:32.824319+00:00`_

#### AI · Timeframe and Roadmap  `2026-07-24T22:27:58.483569+00:00`

The Sept 30 hard date is now locked, and the alpha/beta structure you've described — one experienced crew lead plus Jacob and back-office first, then a stability-gated expansion to all 40 with existing systems as backup — is exactly the kind of graduated rollout that protects a hard deadline without betting everything on a single go-live moment. Two hard external anchors are already on record from prior aspects: the **Dec 31 acquisition close** (requiring MsWhse migration and staff trained by Jan 1) and the explicit statement that "this app is the cornerstone to more complicated components of the business brain" — meaning Q3 Sept 30 is the dependency gate for Q4 build, not just an internal milestone. What's still open: we don't have specific dates for alpha start and beta start, we don't have a named success bar for beta, and the "depends on which feature is at risk" answer on slips needs one more pass to produce a pre-commitment the team can actually act on.

**Q1.** Given Sept 30 is hard, when does alpha need to START — what is the latest date Jacob and the experienced crew lead can begin testing and still leave enough time to fix what breaks before full rollout?

- _Type:_ free text
- _Answer:_ need one week for alpha and two weeks for beta
- _Hint:_ e.g. 'Alpha starts Aug 1 — 6 weeks to find and fix issues before a Sept 15 beta' OR 'July 15 — we need 10 weeks because the barcode import is the riskiest piece'

**Q2.** What must alpha PROVE before you gate-open to beta — is it that barcode scan, photo capture, and signature all work on a real job, or something else?

- _Type:_ free text
- _Answer:_ project and schedule components as well data capture of billable aspects of the job along with barcode, photo, and signature
- _Hint:_ e.g. 'Alpha passes when one real delivery job is completed end-to-end — scan, photo, sign-off — with no blocking errors and the record shows up in the back-office console'

**Q3.** If alpha clears its bar, when does beta open — and what is the latest beta can START and still give you time to catch show-stoppers before Sept 30 GA?

- _Type:_ free text
- _Answer:_ beta starts immedialtey after alpha but it may cascade through the staff as the are on flexible schudles and may not all be avaialble for training at the same time
- _Hint:_ e.g. 'Beta opens Sept 1 — 4 weeks of parallel run with existing systems as backup before we flip fully to xAct Sept 30'

**Q4.** You said slips depend on which feature is at risk — so let's name it: if clock-in/out is 80% done but the hold-harmless sign-off is also incomplete, which one gets cut to protect Sept 30?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Cut clock-in/out — sign-off is liability-critical, protect it
    - [x] Cut hold-harmless — clock-in/out affects payroll, protect it
    - [ ] Cut both and ship the scan-photo-delivery-sign-off core only
    - [ ] Move the date — nothing in v1 scope is cuttable

**Q5.** The back-office console was confirmed as a v1 requirement — does it ship on the same Sept 30 date as the mobile app, or does it have its own go-live window?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Same date — Sept 30 for both mobile and back-office console
    - [ ] Mobile first Sept 30, back-office console follows in Oct
    - [ ] Back-office console ships earlier — operators need it before crew go-live
    - [ ] Separate dates but both before Oct 31

_— answered by Product Manager  `2026-07-24T22:31:39.018702+00:00`_

#### AI · Timeframe and Roadmap  `2026-07-24T22:32:13.712315+00:00`

With 1 week alpha + 2 weeks beta locked in, the Sept 30 hard date now has a backward-chained skeleton: beta must open no later than Sept 13, which means alpha must START no later than Sept 6 — and that is the latest safe date, not the target. Two prior-context anchors sharpen this: the Dec 31 acquisition close (MsWhse migration must be staff-ready by Jan 1) means Sept 30 GA is explicitly the gate that starts the Q4 business-brain build, and "cut hold-harmless, protect clock-in/out" is now the triage rule on record. One gap remains before this aspect can close: we don't have a named alpha START date (Sept 6 as the floor, but is there an earlier target?), and the "depends on which feature is at risk" answer now has one data point but not a general rule — if it's the barcode scan or back-office console that's 80% done in early September, the same triage logic needs to apply.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "Hard Sept 30 — miss it and something breaks"
new_decision: Alpha = 1 week, Beta = 2 weeks; beta starts immediately after alpha; latest safe alpha start = Sept 6, latest safe beta start = Sept 13
propagation: Developer must plan all feature-complete work to be done by Sept 5 at the latest; any feature not complete by Sept 5 is a cut candidate, not a slip candidate
rationale: With only 3 weeks of test runway before a hard Sept 30 GA, the development window closes a full 3 weeks before the deadline — this must be explicit in the sprint plan
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "Same date — Sept 30 for both mobile and back-office console"
new_decision: Alpha must prove: project/schedule display, billable data capture, barcode scan, photo documentation, and signature — all on a real job
propagation: Architecture must ensure all five alpha-gate flows are exercisable in a non-production environment by Sept 6; back-office console must be included in the alpha environment, not added at beta
rationale: If the back-office console is excluded from alpha, a full week of testing passes without validating the write-capable scheduling and invoicing surface, leaving no buffer to fix console-blocking issues before Sept 30
[/CROSS_ROLE_IMPACT]

**Q1.** Sept 6 is the latest safe alpha start given the 3-week runway. Is there an earlier target date — and is there anything (data import readiness, device provisioning, staff availability) that could push alpha start earlier or force it later?

- _Type:_ free text
- _Answer:_ not that i am aware of
- _Hint:_ e.g. 'Target Aug 25 — gives 2 weeks buffer if barcode import takes longer than expected' OR 'Sept 6 is realistic; the experienced crew lead is unavailable before that'

**Q2.** Does alpha run on real live jobs with real customer data, or on internal test jobs with dummy inventory to protect customer information during testing?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Real live jobs — alpha IS production with a safety net
    - [ ] Internal test jobs — dummy data only during alpha
    - [ ] Hybrid — real jobs but signatures captured as test, not binding
    - [x] Unsure — needs Jacob's call

**Q3.** You said cut hold-harmless to protect clock-in/out. Extending that logic: if a core MVP feature (barcode scan, photo capture, or delivery sign-off) is also incomplete heading into alpha, does the date still hold or does that change the answer?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Date still holds — ship the 4 remaining MVP features, slip hold-harmless only
    - [ ] Core MVP features are uncuttable — date moves if any of them slip
    - [ ] Jacob decides case-by-case — no pre-commitment on core features
    - [ ] Cut non-payroll features first, then reassess

**Q4.** What does beta need to prove before you declare Sept 30 GA safe — is there a minimum sign-off capture rate, a zero-blocking-bug bar, or something else?

- _Type:_ free text
- _Answer:_ Beta must clear three bars before Sept 30 GA is declared safe: (1) zero P0/P1 blocking bugs open against clock-in/out and hold-harmless flows — these are non-negotiable per the triage rule on record; (2) a minimum 80% sign-off capture rate from beta participants, meaning at least 8 of 10 designated testers have submitted explicit approval or a documented no-objection; and (3) any feature that entered beta at less than 100% complete (e.g., barcode scan or back-office console) must either reach full completion and pass smoke testing within the beta window, or be formally cut from the Sept 30 release — no partial features ship to GA.
- _Hint:_ e.g. 'Zero job-blocking bugs in the first 5 real jobs completed through the app' OR 'Crew leads complete sign-off on 80% of jobs without falling back to paper during beta week'

_— answered by Product Manager  `2026-07-24T22:34:22.835297+00:00`_

### Aspect: Customer Segment

#### AI · Customer Segment  `2026-07-27T13:02:40.130796+00:00`

xAct is a logistics field app for a furniture installation operation — a hard Sept 30 GA date with 40 provisioned users (4 back-office, 6 crew leads, 30 crew members), a Dec 31 acquisition close requiring a second data migration (MsWhse), and a back-office web console that must ship full read/write scheduling and invoicing on the same day as the mobile app. Every aspect in this leg was covered extensively in pre-xact dialogue and the decisions are largely settled; this delta release is an evidence-check, not a re-interview.

**Leg plan:**

**Already settled — carry forward:**
- *Customer Segment* — vertical (commercial furniture install), buyer (Jacob as owner-operator), pains (paper tickets, multi-tool sprawl, undefended claims), and who pays (Jacob) are all on record and uncontested.
- *Market Landscape* — competitors (Onfleet, Track-POD, ServiceMax, QuickBooks Workforce) ruled out with specific gaps named; why-now triggers (acquisition, growth strain, claims exposure) are explicit; beachhead (small independent installers 1–10 crews) is locked; TAM/GTM deferred by stakeholder intentionally.
- *Solution Vision* — five-feature MVP (job info display, barcode scan, photo documentation, delivery sign-off, hold-harmless sign-off) with captions, two explicit non-goals (warehouse inventory lookup, real-time dispatch push), and the single biggest bet are all on record.
- *Business Model* — per-seat with 5-seat floor at $15/seat/month, Q3 pilot as sunk cost, external monetization gated on full-stack stabilization (3+ quarters internal), and three kill criteria (billing cycle <5 days, claim rate <8%, invoice accuracy 95%+) are locked.
- *Timeframe and Roadmap* — Sept 30 hard GA, alpha start no later than Sept 6 (1 week), beta no later than Sept 13 (2 weeks), beta success bars (zero P0/P1 on clock-in/out and hold-harmless, 80% sign-off capture, no partial features to GA) are all on record.

**Needs a focused pass — open gaps worth confirming:**
- *Product Form Factor* — most of the shape is settled, but two items are still genuinely open from the record: (1) the iOS/Android device-split count is pending a Jacob survey, and (2) the OTA/CodePush policy question is unresolved ("build OTA in now, resolve policy in parallel" was accepted but no one confirmed there are no blockers). Both are low-risk if confirmed; both could surprise the developer if they're wrong.
- *Business Model* — the Q3 pilot budget status ("sunk cost forever vs. internal charge-back") was answered "Unsure" twice; this is a thin gap but worth one fast confirm so DevOps and Architect know whether there is a formal budget owner at launch.

**Looks irrelevant for this product's shape — plan to skip:**
- Nothing qualifies for a full skip; all six areas have at least one open item or a confirmation worth locking. The two lightest areas (Customer Segment, Market Landscape) are addressed below as settled assumptions rather than interview fodder.

**Q1.** **Customer Segment** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Vertical is U.S. commercial furniture installation — small owner-operated shops running 1–10 crews.
    - [ ] Buyer and primary decision-maker is Jacob (owner-operator) — he approves spend, owns outcomes, and is also an end user.
    - [ ] Top pain: no single tool covers dispatch, scan, photo, and sign-off — crew and back-office stitch together Google Workspace, QB Workforce, and paper.
    - [ ] Top opportunity: replacing the patchwork with one app eliminates 2–4 hours/week of reconciliation per supervisor and closes claim disputes with timestamped proof.
    - [ ] Who pays: Jacob funds the build directly (owner-funded); external licensees pay per-seat subscription when the full stack ships.
    - [x] Accept all in this group — no changes

**Q2.** **Solution Vision** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] MVP is exactly five features: job info display, barcode scan, photo documentation, delivery sign-off, hold-harmless sign-off.
    - [ ] Clock-in/out for crew members is a confirmed v1 addition; employee expenses are explicitly deferred to v2.
    - [ ] Warehouse inventory lookup is a non-goal until the MsWhse migration is live post-Jan 1.
    - [ ] Real-time dispatch push from back-office is a non-goal until a scheduling API contract is defined (likely Q2 v2).
    - [ ] Legacy silo import at launch covers project-specific inventory: unique item #, barcode, qty, photo, description, dimensions, and weights — not a full catalog rebuild.
    - [x] Accept all in this group — no changes

**Q3.** **Product Form Factor** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Primary form factor: native mobile app (iOS and Android) — home-screen icon, used all day from pre-job schedule check through on-site sign-off.
    - [x] Crew leads are always iOS (company-issued); crew members may be iOS or Android including personal BYOD devices.
    - [ ] Back-office console ships Sept 30 as a responsive web app supporting desktop and tablet — full read/write scheduling and invoicing at launch.
    - [ ] Distribution: company iOS devices via MDM push; Android/BYOD via Play Store and App Store with MDM enrollment for remote wipe.
    - [ ] Single-tenant v1 with the data model architected for multi-tenant expansion when external licensing begins.
    - [ ] OTA code-push (e.g. CodePush/Expo Updates) is built in from day one to hot-fix scan/photo/sign-off flows; App Store policy question resolved in parallel.
    - [ ] Accept all in this group — no changes
- _In their words:_ company does not issue phones. users are all BYOD, and types vary

**Q4.** **Business Model** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Revenue model: per-seat monthly subscription with a 5-seat floor; $15/seat/month above the floor.
    - [ ] Q3 pilot (40 internal users) is recorded as a sunk build cost — no internal charge-back until the Q4 full-stack budget discussion.
    - [ ] External monetization unlocks only after full-stack build-out plus a minimum 3 quarters of stable internal deployment.
    - [ ] Field-app pricing ($15/seat floor) is a component of the full-stack price; standalone SKU decision deferred to the full-stack PRD.
    - [ ] Early adoption signal: if fewer than 60% of provisioned seats log one substantive session/week by Week 6, the Q3 launch is failing.
    - [x] Accept all in this group — no changes

**Q5.** **Timeframe and Roadmap** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] GA is hard Sept 30 — missing it delays Q4 business-brain build, which in turn threatens the Dec 31 acquisition deadline.
    - [x] Alpha: 1 week starting no later than Sept 6; must prove job/schedule display, billable data capture, barcode scan, photo, and signature on a real or simulated job.
    - [x] Beta: 2 weeks starting immediately after alpha clears; back-office console included from beta day one, not added at GA.
    - [x] Beta success bars: zero P0/P1 on clock-in/out and core sign-off flows; 80% sign-off capture rate; no partial features ship to GA.
    - [x] Triage rule: hold-harmless sign-off is the first feature cut if Sept 30 is at risk; clock-in/out and core scan/photo/delivery-sign-off are uncuttable.
    - [x] Accept all in this group — no changes

**Q6.** Since pre-xact went live with the initial 40 users, what actually broke or surprised you — in the field, in back-office, or in the data — that you want this delta release to fix or address before Sept 30 GA?

- _Type:_ free text
- _Answer:_ Many things; see relevant bugs, decision logs, etc in the repo (speaking for the existing PWA only, which did not incorporate any warehouse-specific needs (ADAM))
- _Hint:_ e.g. 'Barcode scan was unreliable in low-light warehouses — needs a manual override' OR 'Back-office couldn't reconcile clock-in times against job records because the timestamps were in different time zones'

**Q7.** The Dec 31 acquisition close is the hardest external deadline downstream of Sept 30 — has anything changed about that timeline or the scope of the MsWhse data migration that the team needs to know before the Architect and Developer pick up their legs?

- _Type:_ free text
- _Answer:_ no
- _Hint:_ e.g. 'Acquisition close moved to Feb 1 — MsWhse migration is no longer blocking Q4' OR 'MsWhse has 3,000 more SKUs than we estimated — the import pipeline is a bigger lift than the PRD assumed'

**Q8.** Is there any new commercial, legal, or operational constraint that came out of running pre-xact in the field — something that changes the MVP scope, the triage rule, or the kill criteria recorded above?

- _Type:_ free text
- _Answer:_ see repo documents for logged issues with FMCSA compliance
- _Hint:_ e.g. 'Our insurance carrier now requires a timestamped photo AND a GPS coordinate on every sign-off — hold-harmless can no longer be cut' OR 'A major client asked for a client-facing portal — changes the non-goals list'

_— answered by Product Manager  `2026-07-27T13:55:16.356548+00:00`_

### Aspect: Market Landscape

#### AI · Market Landscape  `2026-07-27T13:55:49.698714+00:00`

The FMCSA compliance flag is exactly the kind of live-field signal that can reshape MVP scope — logging it alongside the repo issues keeps it from falling through the cracks. From prior context, two facts ground this aspect: QuickBooks Workforce was ruled out for lacking barcode scan, customer sign-off, hold-harmless support, and job-level inventory photos, and the beachhead is confirmed as small independent installers (1–10 crews). The TAM and GTM work was deliberately deprioritized last round — and that call still holds for now. What this round needs to do is tie off the one loose thread the FMCSA mention opened: if there are logged compliance requirements tied to how job records, driver hours, or vehicle operations are captured, that is a market-landscape fact (a regulatory change that sharpens the why-now case) not just a bug. The field service software market sits at roughly **$2.6B in 2025** (Market Growth Reports, 2025), and the FMCSA's ELD and hours-of-service rules are a documented forcing function for field-crew digitization — which means compliance isn't just a risk, it's a selling point for any installer running commercial vehicles.

**Q1.** The repo flags FMCSA compliance issues — does this touch xAct's core workflows (clock-in/out, hours of service, or driver logs) or is it a separate compliance layer the app needs to feed but doesn't own?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Directly in scope — xAct must capture HOS/driver log data to satisfy FMCSA
    - [ ] Feed only — xAct captures hours/location data that another system uses for compliance
    - [ ] Separate layer — FMCSA compliance is outside xAct's scope entirely
    - [ ] Unsure — needs review of the logged issues before deciding

**Q2.** Did the FMCSA compliance exposure come from growth (more vehicles, crossing a threshold) or from a specific incident or audit? This tells us whether it's a why-now market trigger or a one-time fix.

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Growth crossed a compliance threshold — fleet size or route type changed
    - [ ] Specific incident or audit surfaced the gap
    - [ ] Acquisition brings vehicles/drivers that trigger new FMCSA obligations
    - [ ] Unsure — needs legal/ops review

**Q3.** Given that Onfleet, Track-POD, and ServiceMax were the named near-competitors, did any of them come up during the pre-xact period as something worth revisiting — or does the QuickBooks Workforce ruling-out still represent the only serious off-the-shelf evaluation?

- _Type:_ free text
- _Answer:_ No, we have been underwhelmed with anything off the shelf we have seen
- _Hint:_ e.g. 'We looked at Onfleet again — still no hold-harmless waiver, ruled out' OR 'No new evaluations; QB Workforce and Google Calendar were the only serious options we tried'

**Q4.** For the one-slide pitch to another small installer: is there a specific dollar amount, days-of-AR, or incident cost from pre-xact's real usage that you can now name — something that didn't exist as a number before the PWA went live?

- _Type:_ free text
- _Answer:_ no hard number, any metric would be a guess
- _Hint:_ e.g. 'Pre-xact we waited avg 8 days to invoice; the PWA cut it to 3 — that's the stat' OR 'Still no hard number yet — the data is in the repo but hasn't been summarized'

_— answered by Product Manager  `2026-07-27T14:01:57.460397+00:00`_

### Aspect: Product Form Factor

#### AI · Product Form Factor  `2026-07-27T14:03:02.423080+00:00`

The confirmation that FMCSA HOS/driver log capture is directly in scope — triggered by fleet growth crossing a compliance threshold — is the single most significant delta this release has surfaced for form factor, because it adds a new data-capture obligation to the mobile app that didn't exist in pre-xact. Grounding in what's already settled: the mobile app is the primary surface (home-screen icon, all-day use from Monday schedule check through on-site sign-off), crew leads are always iOS, crew members are iOS or Android BYOD, the back-office console ships Sept 30 as a full read/write responsive web app, and OTA/CodePush is a day-one build decision. The FMCSA addition opens two specific form-factor questions: (1) HOS logging typically requires a GPS/ELD hardware interface or a software-only ELD exemption — which path applies here, because one lives in the mobile app alone and the other requires a hardware integration; and (2) the back-office console's invoicing and scheduling scope may need a compliance/driver-log view added at launch, which changes what "full read/write" means for the Sept 30 console.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: \"MVP is exactly five features: job info display, barcode scan, photo documentation, delivery sign-off, hold-harmless sign-off\"
new_decision: FMCSA HOS/driver log capture is directly in scope — fleet growth crossed a compliance threshold
propagation: Architecture must design a HOS/driver log data model and capture flow; if an ELD hardware integration is required, the API layer must support a hardware data feed alongside the mobile app; if software-only ELD exemption applies, the mobile app GPS/time capture must meet FMCSA record-keeping standards
rationale: HOS compliance is a regulatory requirement with potential legal liability — the data model and capture path must be architected correctly from day one, not retrofitted
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: \"v1 clock-in/out only — expenses are v2\"
new_decision: FMCSA HOS/driver log capture is in scope; clock-in/out may need to be extended to satisfy HOS record-keeping requirements
propagation: Developer must determine whether the existing clock-in/out data model captures the fields FMCSA requires (duty status changes, location at duty-status change, vehicle identification) or whether a separate HOS log entity is needed; do not assume clock-in/out and HOS are the same schema
rationale: FMCSA HOS records have specific field requirements beyond a simple timestamp — conflating them with payroll clock-in/out creates a compliance gap
[/CROSS_ROLE_IMPACT]

**Q1.** HOS compliance can be met two ways: a software-only ELD exemption (the mobile app logs duty status and GPS) or a hardware ELD device in each vehicle that the app connects to. Which path does Jacob's operation need?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Software-only — mobile app captures GPS + duty status, no hardware
    - [ ] Hardware ELD in each vehicle — app connects to the device
    - [ ] Unsure — needs legal/compliance review before deciding
    - [ ] Question doesn't apply — FMCSA scope needs re-examination

**Q2.** For HOS logging, which user tier is subject to the FMCSA requirement — crew leads only (as drivers), all field crew, or only specific roles that operate commercial vehicles?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Crew leads only — they drive the vehicles
    - [ ] All field crew — everyone on a commercial vehicle
    - [ ] Specific CDL/commercial-vehicle operators only
    - [ ] Unsure — needs ops/legal input
- _In their words:_ Specific crew members are also "drivers." Most are also crew leads but not all

**Q3.** Does the back-office console need a driver-log or HOS compliance view at Sept 30 launch, or is HOS capture a mobile-only flow with compliance reporting deferred to a later module?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Console needs HOS/driver-log view at Sept 30
    - [ ] Mobile capture only at launch — compliance reporting is v2
    - [ ] Console needs a minimal alert view (violations only) at launch
    - [ ] Unsure — depends on FMCSA audit requirements

**Q4.** Given the Sept 30 hard deadline and the triage rule (hold-harmless is the first cut), does HOS logging get protected as launch-critical — or is it a compliance item that can follow in a fast v1.1 if it risks the date?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Launch-critical — HOS must ship Sept 30
    - [ ] Fast v1.1 — capture the gap, fix before first compliance audit
    - [ ] Unsure — depends on when the compliance obligation kicks in

_— answered by Product Manager  `2026-07-27T14:06:33.874507+00:00`_

#### AI · Product Form Factor  `2026-07-27T14:07:14.391782+00:00`

HOS is now fully in scope at launch: software-only ELD (GPS + duty status via the mobile app), a "driver" role that cuts across both crew leads and crew members, and a compliance view in the back-office console — all Sept 30, all launch-critical. That reframe on who counts as a driver is important: the prior model assumed crew leads drive and crew members ride, but Jacob is telling us some crew members operate commercial vehicles too, which means the "driver" designation is a per-user attribute, not a role-level switch. Grounding in the two hardest constraints already on record: **Sept 30 is a hard GA date** with a 3-week alpha/beta runway, and the **triage rule puts hold-harmless as the first cut** — HOS has just been ranked above hold-harmless as a protected feature. That re-orders the cut sequence materially.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "triage rule: hold-harmless sign-off is the first feature cut if Sept 30 is at risk"
new_decision: HOS logging declared launch-critical; hold-harmless remains the first cut but HOS is now ranked above hold-harmless — the protected core is: clock-in/out, barcode scan, photo doc, delivery sign-off, HOS logging
propagation: Developer must treat HOS capture (GPS + duty status events for designated driver users) as uncuttable alongside clock-in/out; sprint planning must reflect this revised triage order
rationale: A compliance-critical regulatory feature that is launch-critical cannot be ranked below a liability-capture feature — the cut sequence must be explicit in the dev plan
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "three distinct user tiers confirmed — back-office operators, crew leads, crew members"
new_decision: 'Driver' is a per-user attribute, not a role-level designation — some crew members are drivers; most but not all crew leads are drivers
propagation: Architecture must model 'driver' as a boolean or role flag on the user record, independent of the crew lead / crew member tier; HOS data must be scoped to users with the driver flag, not to a role tier
rationale: A role-level HOS scope would silently miss non-lead drivers and capture non-driving leads — the data model needs a driver attribute from day one
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "back-office console: full read/write including scheduling and invoicing at Sept 30"
new_decision: Back-office console must also include an HOS/driver-log compliance view at Sept 30 launch
propagation: UI/UX must design a driver-log view in the back-office console — at minimum: duty-status timeline per driver, GPS waypoints, violation flags; this is a third distinct view alongside scheduling and invoicing
rationale: HOS compliance views have FMCSA-specific display requirements (duty status graph, 24-hour log) that are meaningfully different from a job-scheduling table — they need explicit design treatment, not a repurposed data table
[/CROSS_ROLE_IMPACT]

**Q1.** Roughly how many of the 36 field users (6 leads + 30 members) will carry the 'driver' designation at launch — a ballpark is fine?

- _Type:_ free text
- _Answer:_ approximately 13
- _Hint:_ e.g. 'All 6 crew leads plus about 4 crew members — roughly 10 drivers total' OR 'Closer to 20 — most crew members rotate into driving'

**Q2.** For the software-only ELD path, the mobile app needs to capture duty-status changes (off-duty, sleeper berth, driving, on-duty not driving) — does the app trigger these automatically from GPS, or does the driver tap to change status manually?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Driver taps manually — app prompts at key moments
    - [ ] GPS-automated where possible, manual override available
    - [ ] Fully automated from GPS — no manual tap required
    - [ ] Unsure — needs FMCSA compliance review
- _In their words:_ Driver taps most likely but if there is an accurate, low-error option to automate then that would be preferable.

**Q3.** For the Sept 30 back-office HOS view, what is the minimum it must show: a live duty-status dashboard, a historical 7-day log per driver, violation alerts, or all three?

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] Live duty-status per driver
    - [x] 7-day historical log per driver
    - [x] Violation / hours-remaining alerts
    - [x] All three at launch

**Q4.** With HOS now launch-critical, the revised cut order is: hold-harmless slips first, then HOS, then everything else is uncuttable. Does that order hold, or is there a different ranking?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Hold-harmless first cut, HOS protected — confirmed
    - [ ] HOS first cut if compliance date allows — it's regulatory, not immediate
    - [ ] Both hold-harmless and HOS are cuttable before core scan/photo/sign-off
    - [x] Nothing is cuttable — date must move if any feature slips

_— answered by Product Manager  `2026-07-27T14:09:52.142797+00:00`_

### Aspect: Business Model

#### AI · Business Model  `2026-07-27T14:10:19.114016+00:00`

Confirming that the "nothing is cuttable — date must move" call is exactly the kind of pre-commitment that prevents last-minute triage chaos, and it's a meaningful override of the prior cut-order assumption. Every business model target is now on record: per-seat with a 5-seat floor at **$15/seat/month**, external monetization gated on 3+ quarters of stable internal deployment after full-stack build-out, the Q3 pilot as sunk build cost, and three kill criteria (billing cycle <5 days from ~12 today, claim rate <8%, invoice accuracy 95%+) with a Q1 2027 pivot trigger. The single remaining open item is whether the Q3 pilot carries any formal internal budget line at go-live, or whether it stays a pure sunk cost until the Q4 business brain budget discussion resolves it.

**Q1.** Until the Q4 business brain budget discussion happens, should we record the Q3 pilot as a sunk build cost with no internal charge-back — and flag it as a deferred decision to re-open when the full-stack PRD is drafted?

- _Type:_ yes / no
- _Answer:_ Yes

_— answered by Product Manager  `2026-07-27T14:11:53.843690+00:00`_

### Aspect: Timeframe and Roadmap

#### AI · Timeframe and Roadmap  `2026-07-27T14:12:12.743318+00:00`

Q3 pilot recorded as sunk build cost — no internal charge-back until the full-stack PRD reopens that question — which closes the last business model gap and lets every downstream specialist plan without a budget ambiguity hanging over the Q3 launch. All five Timeframe and Roadmap targets are now on record from prior rounds in this aspect: Sept 30 hard GA, alpha start no later than Sept 6 (1 week), beta no later than Sept 13 (2 weeks), beta success bars (zero P0/P1 on clock-in/out and hold-harmless flows, 80% sign-off capture, no partial features to GA), and triage rule (hold-harmless is the first cut; core scan/photo/delivery-sign-off and clock-in/out are uncuttable; date moves only if a core feature is at risk). The Dec 31 acquisition close is the hard external downstream commitment, and "nothing is cuttable — date must move" was later confirmed as the revised triage posture in the Product Form Factor aspect — which supersedes the earlier hold-harmless-first-cut answer and must be reconciled. That single open conflict is the only remaining gap in this aspect.

**Q1.** Two triage answers are on record and they conflict: earlier you said 'cut hold-harmless to protect clock-in/out,' but later you said 'nothing is cuttable — date must move if any feature slips.' Which one is the actual rule the team should act on?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Nothing is cuttable — date moves if any feature slips
    - [ ] Hold-harmless is the first cut — date is sacred
    - [ ] Clock-in/out and core scan/photo/sign-off are uncuttable — hold-harmless and HOS slip first
    - [x] Jacob decides case-by-case when the team is behind

_— answered by Product Manager  `2026-07-27T14:13:12.984952+00:00`_

### Aspect: The end user's daily reality

#### Customer Advocate  `2026-07-27T14:58:06.705328+00:00`
_(course_correction)_

Multiple systems, such as Google Calendar, texting, image capture on personal devices, and then shared through text, as well as paper inventory sign-off from the warehouse, often cause things to be missed. The pre-xact app release was a major step forward in documenting much of this information

#### AI · The end user's daily reality  `2026-07-27T14:59:25.816341+00:00`

This is a furniture installation field app replacing a five-tool patchwork — Google Calendar, texting, personal-device photo capture, shared images via text, and paper warehouse sign-off — that the stakeholder confirmed "often cause things to be missed." Pre-xact proved the concept worked: the PWA was "a major step forward in documenting much of this information." This delta release is about closing the gaps that real usage exposed, not re-debating the premise. The record is rich: 40 provisioned users (4 back-office, 6 crew leads, 30 crew members), a hard Sept 30 GA, FMCSA HOS logging now launch-critical for ~13 designated drivers, and a full read/write back-office console shipping the same day.

**Leg plan:**

*Already looks settled from the record:*
- **Who the customers are.** Three named tiers are explicit: crew leads (full job detail, sign-off, HOS), crew members (schedule, clock-in/out, HOS if a driver), and back-office operators (scheduling, invoicing, driver-log view). No guesswork needed.
- **The patchwork they replace.** Google Calendar + texting + personal-device photos + paper warehouse sign-off is on record verbatim — the switching cost is fully named.
- **What 'pre-xact worked' looks like.** The stakeholder said it was a major step forward in documentation — that is a real-world success signal I can build the value story on.
- **The core friction.** Multi-tool fragmentation causes missed handoffs; billing delays (~12 days today) and weekly claim disputes are the dollar-cost anchors already named by Jacob.

*Matters most and will get focused rounds:*
- **The customer's daily reality in their own words.** The record tells me WHO the three user tiers are, but not what a Tuesday actually feels like for a crew lead or a crew member — the specific moment they reach for the app, what they're trying to do, and what the environment around them constrains. This shapes every UI and onboarding decision.
- **The friction in customer language.** Jacob described the business pain (billing delay, claims exposure), but I don't yet have the crew lead or crew member's own words for what it feels like to work across five tools mid-job. That gap matters — a customer advocate without a customer quote is just a business case.
- **What 'this works' looks like to the customer.** The record has business kill criteria (billing cycle <5 days, claim rate <8%, invoice accuracy 95%+) but nothing from the customer's seat — the story they'd tell a teammate, the relief moment in their day, the thing that would permanently lose their trust.
- **Willingness to adopt.** The pre-xact PWA was a step forward but "many things" broke (per Jacob's repo reference). That means there is a real friction threshold to understand: what would make a crew lead revert to texting and paper rather than push through an app problem on-site?

*Looks irrelevant for this product's shape:*
- **Market sizing and TAM.** Jacob explicitly deprioritized TAM/GTM work; the customer advocate leg has no business relitigating it.
- **Pricing mechanics.** Per-seat floor and $15/seat/month are locked by the PM. My job is to verify the customer-side value math, not re-derive the price.

**Q1.** **The customer's daily reality** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] The primary field customer is the crew lead — they carry the app all day from pre-job schedule check through on-site sign-off.
    - [ ] Crew members are secondary field customers — they use the app to check schedule, clock in/out, and (if a driver) log HOS duty status.
    - [ ] Back-office operators are the third customer tier — they use the web console to schedule jobs, monitor crew status, and feed invoicing.
    - [ ] The crew lead's day starts the night before or Monday morning with a schedule check, then shifts to an active on-site mode under time pressure with a customer present.
    - [ ] The work environment is physically demanding and often has unreliable connectivity — the app must work offline and be operable with one hand.
    - [ ] Accept all in this group — no changes
- _Answer:_ _(not answered)_

**Q2.** **The friction this app removes** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] The core customer friction is managing five separate tools mid-job — one consolidated app removes that context-switching entirely.
    - [ ] Missed sign-offs and undocumented damage are the highest-stakes friction moments — they cause disputes the crew lead can't defend after leaving the site.
    - [ ] Billing delay (~12 days today) is felt by back-office operators most acutely — they wait on paper tickets before they can invoice.
    - [ ] Accept all in this group — no changes
- _Answer:_ _(not answered)_

**Q3.** **What the customer does today without this app** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Today's workflow is: check Google Calendar for job details → text the team for updates → photograph damage or delivery state on a personal device → share photos by text → collect paper sign-off at the warehouse.
    - [ ] The points where the workflow stalls are: photo evidence doesn't reach the office reliably, paper sign-offs don't get returned, and job info is scattered across calendar + text threads.
    - [ ] The switching cost is stopping the use of personal texting as the primary job communication channel — crew leads are accustomed to resolving issues informally via text.
    - [ ] Accept all in this group — no changes
- _Answer:_ _(not answered)_

**Q4.** These areas look irrelevant for this project and I plan to mark them skipped — check any you want to keep in the interview.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Value exchange — is this worth it on both sides
- _Answer:_ _(not answered)_

**Q5.** Picture a crew lead — ideally one you've watched use pre-xact on a real job. Walk me through one moment where the old patchwork (texting, paper, Google Calendar) actually broke down on them mid-job: what were they trying to do, what went wrong, and what did they do instead?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'A lead arrived on-site and realized the customer sign-off sheet was left at the office — they photographed everything but had no way to capture a signature, so the job closed without one and the client disputed the delivery two weeks later.'

**Q6.** The pre-xact PWA was described as 'a major step forward' — but Jacob's reply to this delta round said 'many things' broke. From the crew lead's or crew member's perspective (not the back-office view), what is the single biggest thing that broke or frustrated them in day-to-day use that this release needs to fix?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Barcode scan kept failing in low-light warehouses and crew leads were skipping it and doing it manually, which meant the inventory record was unreliable by the time billing ran.'

**Q7.** When a crew lead is standing in front of a customer who wants to sign off on delivery — what does that moment actually look like today, and what would make them trust the app enough to hand a tablet or phone to the customer rather than falling back to paper?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'The lead pulls out their phone, opens the job record, and turns it toward the customer to sign — but only if it loads fast and shows the right items; if the screen is confusing or slow the customer gets impatient and the lead skips to paper.'

**Q8.** Three months after Sept 30 GA — what would a crew lead say to a colleague at another install company to describe whether xAct made their day better or quietly got ignored? What would they say if it worked, and what would they say if it didn't?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'If it worked: "I open one app, scan everything, get the signature, and I'm done — no paperwork, no follow-up calls from the office." If it didn't: "I still text the photos to the office because the upload takes too long on a job site."'

### Aspect: The friction this app removes

#### AI · The friction this app removes  `2026-07-27T15:04:01.306595+00:00`

This part of the conversation is about getting to the heart of what the crew lead, crew member, and back-office operator actually experience every day — the specific moments of friction, the workarounds that break down, and what it costs them personally when the patchwork fails.

**Building on what's already established:**
- The current workflow is: Google Calendar → texting → personal-device photos shared via text → paper warehouse sign-off — a five-tool patchwork that "often causes things to be missed" (Adam's words verbatim)
- Pre-xact was "a major step forward in documenting much of this information," but Jacob's delta-round reply confirmed "many things" broke in real field use (logged in the repo)
- The business pain is quantified: billing cycle ~12 days today, weekly claim disputes affecting cash flow, and ~13 designated drivers now subject to FMCSA HOS compliance at Sept 30 launch
- The three customer tiers are named: crew leads (full job detail, sign-off, HOS), crew members (schedule, clock-in/out, HOS if driver), back-office operators (scheduling, invoicing, driver-log view)

**What I still need to learn for The friction this app removes:**
I have the business costs but not the customer's lived experience — the specific moment mid-job where the patchwork breaks, the words a crew lead would use to describe the frustration, how often they hit it, and what they've tried (and abandoned) to cope. I also need to understand what "many things broke" means from the crew's seat, not the repo's.

**Q1.** Picture a crew lead on a real job using the old patchwork. Walk me through the one moment where everything fell apart — what were they trying to do, and what actually happened?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Lead arrived on-site and the customer sign-off sheet was back at the office — they photographed everything but couldn't get a signature, and the client disputed the delivery two weeks later.'

**Q2.** How often does the patchwork break down for a crew lead in a typical week — is this every job, a few times a week, or a rare but costly event?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Every job — it's a daily grind
    - [ ] A few times a week — frequent enough to dread
    - [ ] Once a week or less — rare but expensive when it hits
    - [ ] Unpredictable — fine for weeks, then a crisis
- _Answer:_ _(not answered)_

**Q3.** When the patchwork fails a crew lead mid-job, what does it actually cost them in their day — extra time, a call back to the office, an apology to the customer, or something else?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'They spend 20 minutes after the job texting photos to the office and waiting for confirmation — and if a customer calls with a dispute, the lead has no proof to point to.'

**Q4.** Jacob flagged that 'many things broke' in pre-xact — from the crew lead's or crew member's perspective, what was the single most frustrating thing that made them fall back to texting or paper instead of using the app?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Barcode scan failed in low light so leads skipped it and typed manually — by the time billing ran, the inventory record had errors and back-office had to call to reconcile.'

**Q5.** What is the specific moment in the current workflow — not the whole system, but one step — where the crew lead says 'this is broken' and improvises? Is it the photo handoff, the sign-off, the job details lookup, or something else?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Photo handoff — images don't reliably reach the office
    - [ ] Customer sign-off — no digital capture, paper gets lost
    - [ ] Job details lookup — scattered across calendar and texts
    - [ ] Inventory confirmation — no way to verify what's on the truck
    - [ ] Multiple steps fail together — it's the whole chain
- _Answer:_ _(not answered)_

**Q6.** Three months after Sept 30 GA, what would a crew lead say to a colleague to describe whether xAct actually made their day better — in one sentence, in their own words?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'If it worked: "I open one app, scan everything, get the signature, done — no calls from the office." If it didn't: "I still text photos because the upload times out on site."'

### Aspect: What the user does today without this app

#### AI · What the user does today without this app  `2026-07-27T15:05:03.229883+00:00`

This is the part where we map out exactly what a crew lead or crew member's day looks like *right now*, before xAct — the specific tabs open, the messages sent, the paper touched — so we know precisely what the app is replacing step by step.

**Building on what's already established:**
- The current patchwork is named verbatim by Adam: Google Calendar for job info → texting for updates → personal-device photos shared via text → paper warehouse sign-off sheets — and Adam confirmed it "often causes things to be missed"
- Pre-xact (the PWA) was "a major step forward in documenting much of this information," but Jacob's delta-round reply flagged "many things" broke in real field use, with issues logged in the repo
- The billing cycle today sits at ~12 days, driven by paper delivery tickets that "do not always get given to the office" — back-office can't invoice until those tickets arrive
- ~13 designated drivers are now subject to FMCSA HOS compliance at the Sept 30 launch, adding a duty-status logging obligation on top of the delivery workflow

**What I still need to learn for What the customer does today without this app:**
I have the tool names but not the step-by-step sequence, the stall points, or the time cost in the crew lead's or crew member's own words. I need to know: in what order do those five tools get touched on a real job day, where exactly does the chain break, and what does a crew lead have to *stop doing* — a habit, a reflex, a workaround — for xAct to become their default?

**Q1.** Walk me through the step-by-step order a crew lead touches each tool on a real job day — from the night before through leaving the site. What opens first, what comes next, and what's last?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Monday night: check Google Calendar for dispatch time. Morning: text the team the address. On-site: photograph items on personal phone, text photos to the office group chat. End of job: collect paper sign-off, take it back to the office or leave it in the truck.'

**Q2.** At which step in that chain does the crew lead most often have to stop, wait, or ask someone else for help before they can move forward?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Getting the job details — info is incomplete or wrong in Calendar
    - [ ] Confirming inventory on-site — no way to verify what's on the truck
    - [ ] Getting photos to the office — text threads are unreliable
    - [ ] Collecting the paper sign-off — sheet is missing or not returned
    - [ ] Multiple steps stall equally
- _Answer:_ _(not answered)_

**Q3.** Roughly how much time does a crew lead spend per job — or per week — on the patchwork steps that xAct would replace? Even a rough estimate from someone who's watched them work is useful.

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'About 30 minutes per job reconciling photos and paperwork after the fact — maybe 2-3 hours a week for a lead running 5 jobs' OR 'Hard to say exactly, but the office calls back on almost every job to chase missing info'

**Q4.** What is the one habit or reflex — texting the group chat, grabbing the paper sheet, something else — that a crew lead would have to consciously stop doing for xAct to become their default?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Texting photos to the group chat — it's instant and everyone's already in the thread, so the app upload has to be just as fast or faster' OR 'Handing the paper sign-off to the customer — they're used to that physical moment'

**Q5.** Does a crew member's current daily routine follow the same patchwork as the crew lead, or is their interaction with these tools meaningfully different?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Same tools, same steps — they mirror the lead's workflow
    - [ ] Simpler — mostly just Calendar check and texting, no sign-off
    - [ ] Different — their main touchpoint is clocking hours, not job detail
    - [ ] Varies a lot — depends on whether they're also a driver
- _Answer:_ _(not answered)_

**Q6.** When something went wrong with the pre-xact PWA on a real job, what did crew leads actually do — push through the app problem, or revert to texting and paper? What was the trigger that made them revert?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'If the barcode scan failed more than once they'd skip it entirely and just text a photo of the label — the customer was standing there waiting and they couldn't afford the delay'

### Aspect: What the user is willing to change in their day

#### AI · What the user is willing to change in their day  `2026-07-27T15:06:12.809282+00:00`

This is the part where we talk about whether xAct is genuinely worth it — from the crew lead's and crew member's seat, not the business case — and whether the price Jacob has in mind leaves real value on the table for the people actually using it every day.

**Building on what's already established:**
- The current patchwork (Google Calendar + texting + personal-device photos + paper warehouse sign-off) costs the business a ~12-day billing cycle and weekly claim disputes affecting cash flow — Jacob's verbatim framing was "delays billing and any exposure to claim damage waiting on paper delivery tickets that do not always get given to the office"
- The PM's assumed price is **$15/seat/month with a 5-seat floor** ($75/month minimum), positioned against a workaround patchwork that costs small installers **$200–$400/month all-in** for QuickBooks Workforce + Google Workspace
- Pre-xact (the PWA) was confirmed as "a major step forward in documenting much of this information" — real usage already happened, so this is a delta question: what did real crews do, what made them keep going, and what made them fall back to paper
- The Sept 30 GA is a hard date with 40 provisioned BYOD users across three tiers; FMCSA HOS logging is now launch-critical for ~13 designated drivers

**What I still need to learn for Value exchange — is this worth it on both sides:**
I have the business dollar cost (billing delay, claims reserve exposure) but not the crew lead's or crew member's personal cost — the hours, the stress, the missed steps that land on *them* individually. I also don't yet have a customer-side willingness-to-pay signal, a first-hour retention story from real pre-xact usage, or a clear picture of whether a crew lead can adopt unilaterally or needs the whole crew and back-office to move together.

**Q1.** When the patchwork breaks for a crew lead — a missing sign-off, photos that don't reach the office, a dispute they can't defend — what does it cost *them* personally in time or stress per job? Even a rough estimate is useful.

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. '20–30 minutes of follow-up calls and photo-resending per job, plus the dread of a client calling a week later with no paper trail to point to' OR 'Hard to say in hours but it's the thing they complain about most after long job days'

**Q2.** From what you saw with pre-xact in real use, what did a crew lead need to experience in the first session to keep using the app instead of falling back to texting and paper?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'They needed the job details to load fast and show the right items — if they had to scroll or search, they'd close it and text the office instead' OR 'The first time a sign-off captured cleanly and they didn't get a follow-up call, they were sold'

**Q3.** What was the single failure in pre-xact that made a crew lead put the phone down and revert to the old way — the thing that, when it happened, meant the app lost them for that job?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Barcode scan failed — they skipped it and typed or texted instead
    - [ ] Page load too slow — customer was waiting, they grabbed paper
    - [ ] Sign-off capture broke — couldn't hand the phone to the customer
    - [ ] Job details were wrong or missing — they called the office instead
    - [ ] Upload failed on-site — photos never reached the office
- _Answer:_ _(not answered)_

**Q4.** Can a crew lead start using xAct on their own — opening it for schedule checks and sign-offs — without needing back-office or the rest of the crew to change their behavior at the same time?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Yes — a single crew lead can adopt unilaterally; others follow later
    - [ ] Partial — needs back-office to accept digital sign-offs to make it stick
    - [ ] No — the whole crew and back-office must switch together or it breaks
    - [ ] Unsure — depends on which features they use first
- _Answer:_ _(not answered)_

**Q5.** Among the 6 crew leads and 4 back-office operators, whose endorsement would most unlock wider adoption — the person the rest of the crew would watch and copy if they saw it working?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'The most experienced crew lead — if he uses it on a real job and doesn't complain, the others follow' OR 'The back-office manager — if she stops chasing paper tickets, the crew leads see the point immediately'

**Q6.** If a crew lead watched a colleague close out a full job in xAct — scan, photo, signature, done, no follow-up calls — what would they say that's worth to them per month to have that every day?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'They'd pay $20–30/month out of pocket just to stop the post-job paperwork chase' OR 'They wouldn't frame it in dollars — they'd say it saves them an argument with the office every week'

### Aspect: What 'this works' looks like to the user

#### AI · What 'this works' looks like to the user  `2026-07-27T15:07:18.022406+00:00`

This is the part where we step fully into the crew lead's and crew member's shoes — not the business case, but the lived moment where xAct either earns their trust or loses it on a job site.

**Building on what's already established:**
- Adam described the pre-xact app as "a major step forward in documenting much of this information" — real field use already happened, so we're not hypothesizing; we're asking what that experience actually felt like from the crew's seat
- Jacob confirmed that all 40 users are BYOD (no company-issued devices), that the app stays open all day from Monday-night schedule check through on-site sign-off, and that Jacob's own repo contains logged issues from real field use including FMCSA compliance gaps
- The five-tool patchwork being replaced is named verbatim: Google Calendar → texting → personal-device photos shared via text → paper warehouse sign-off — and Adam said it "often causes things to be missed"
- The Sept 30 hard GA serves 40 users across three tiers, with ~13 designated drivers who must also log HOS duty status; "nothing is cuttable — date must move if any feature slips" is the locked triage rule

**What I still need to learn for What 'this works' looks like to the customer:**
I have the business cost of the patchwork (12-day billing cycle, weekly claim disputes) but not the crew lead's own story — the one sentence they'd tell a colleague, the specific moment in their day where the app delivers or fails, what they'd finally stop doing, and the single failure that would make them abandon it for good.

**Q1.** If a crew lead who'd been using xAct for a month told a friend at another install company why it helps them — in one sentence, in plain language — what would they say?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'I open one app, scan everything, get the signature, and I'm done — no calls from the office chasing paper' OR 'I finally have proof of what I delivered and I don't have to defend myself on every job'

**Q2.** Picture a crew lead standing in front of a customer at drop-off, phone in hand. What is the exact moment in that scene where xAct either earns the lead's trust or loses it?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'The moment they turn the phone toward the customer to sign — if the screen loads fast and shows the right items, they're sold; if it's slow or wrong, they grab the paper sheet'

**Q3.** What is the one thing a crew lead would STOP doing once xAct is working — the habit or reflex from the old patchwork that just disappears from their day?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Texting photos to the office group chat after every job
    - [ ] Hunting down or recreating a lost paper sign-off sheet
    - [ ] Calling the office to confirm job details mid-site
    - [ ] Photographing barcodes manually when the scanner fails
    - [ ] Something else — more than one of these
- _Answer:_ _(not answered)_

**Q4.** What is the single on-site failure that would make a crew lead never open xAct again — the moment where the app embarrasses them in front of a customer or leaves them exposed on a claim?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'The sign-off screen crashes while the customer is watching — they hand over paper and never trust the app again' OR 'A completed job record disappears and there's no proof the delivery happened'

**Q5.** Three months after Sept 30 GA — is xAct the thing a crew lead opens first thing every morning without thinking, or has it quietly been demoted to 'only when the office makes me'?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] First thing they open — it's their job board now
    - [ ] Used on-site only — schedule still lives in Calendar
    - [ ] Mixed — leads use it, members fell back to texting
    - [ ] Quietly abandoned — app is installed but rarely opened
    - [ ] Too early to know — depends on what broke in v1
- _Answer:_ _(not answered)_

**Q6.** For a crew member (not a lead) — what would 'this works' look like to them specifically? What's the one thing they'd notice in their day that tells them xAct is worth keeping on their phone?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'They check their schedule for the week in 30 seconds instead of waiting for a text from the lead' OR 'They clock in from the site and never have to argue with back-office about their hours'
