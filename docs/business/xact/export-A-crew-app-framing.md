# MMS Field App — Dialogue export

_Exported 2026-07-29T17:33:34.340Z_

_47 turns across 1 release._

## Release: v2.3

### Aspect: Customer Segment

#### AI · Customer Segment  `2026-07-24T17:33:02.710901+00:00`

This is a delta release for a **Logistics Field App** — a touch-first mobile product (iOS + Android, with a desktop companion) built for workers and managers operating in the field. The record names no specific vertical yet, no competitor set, and no pricing model, so this opening leg carries the full burden of establishing all six PM areas from scratch. The product profile is clear — app-store distributed, offline-capable, push-notification-driven, permission-heavy — which already constrains a number of defaults I can propose with confidence.

**Leg plan:**
- *Settled:* **Product form factor (primary)** — the project brief explicitly names "Mobile app / Desktop app / Logistics Field App," and the product profile mandates touch-first, app-store distributed; primary form is native mobile (iOS + Android), confirmed.
- *Settled:* **Distribution model** — app-store distribution is named in the product profile; this is a given unless the stakeholder overrides.
- *Focus:* **Customer segment** — vertical, buyer persona, and pains are entirely open; this is the single most load-bearing unknown because every other area depends on it.
- *Focus:* **Market landscape** — no competitors, no TAM, no "why now" on the record; without a named market the beachhead and competitive wedge are undefined.
- *Focus:* **Solution vision** — value prop, MVP scope, and non-goals are all open; the MVP cannot be scoped until the segment and pains are named.
- *Focus:* **Business model** — revenue model, price point, and kill criteria are entirely absent from the record; logistics field apps span wide pricing territory (per-seat SaaS to enterprise contract).
- *Focus:* **Timeframe and roadmap** — no alpha, beta, or GA dates on record; no external commitments named.
- *Lower priority:* **Product form (secondary surfaces + tenancy)** — primary form is settled; secondary surfaces (desktop, admin console) and tenancy model carry some defaults I can propose and confirm quickly.

**Q1.** **Product Form Factor** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] Primary form factor for v1 is native mobile (iOS + Android) — the named product profile and app-store distribution confirm this.
    - [ ] A desktop web app ships as a secondary surface in v1 — the project brief explicitly lists 'Desktop app' as a secondary type.
    - [ ] An admin/dispatcher console (web-based) ships in v1 as the operator-facing front end alongside the field worker mobile app.
    - [ ] Distribution is via Apple App Store and Google Play Store — direct enterprise MDM side-load as an optional secondary channel.
    - [ ] The product is multi-tenant SaaS from a pricing/product view — each company gets its own workspace, field workers share it.
    - [ ] The product lives as a home-screen icon on a field worker's device — checked actively during a shift, not a background-only tool.
    - [ ] Accept all in this group — no changes
- _In their words:_ Product will be a hybrid desktop/mobile tool -- Mobile first, but with heavy usage on both mobile and desktop daily. This is an internal app, and will not be sold through any platform, however, field app needs to be able to cache data when there is no WiFi or signal.

**Q2.** **Business Model** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Revenue model is subscription per seat (per active field worker/month) — standard for logistics field apps in this tier.
    - [ ] Alpha and beta phases are free-to-use; the first paid commitment is at general availability.
    - [ ] The buyer is a manager or operations director — not the field worker using the app day-to-day.
    - [ ] Accept all in this group — no changes
- _In their words:_ Internal operational app

**Q3.** What specific logistics vertical and worker role is this app built for — e.g. 'last-mile delivery drivers for a regional courier', 'field service technicians at mid-market HVAC companies', 'warehouse yard spotters at 3PLs'? This single answer unlocks the buyer persona, the competitive set, and the MVP scope.

- _Type:_ free text
- _Answer:_ This app will be built for both Field workers (mobile; for high- end furniture installers) and admin workers (desktop) to use to schedule workers and collect field data for billing, resource consumption, KPI measurement.
- _Hint:_ e.g. 'Field technicians at mid-market facilities-management companies in the US — 50–500 employees, dispatched from a back-office ops team'

**Q4.** What is the single biggest operational pain this app eliminates for those workers or their managers — ideally in the words a customer actually used? If you have a quote, a support ticket, or a specific failure mode from pre-xact usage, drop it here.

- _Type:_ free text
- _Answer:_ Prior system was taking notes on the "notes" app on their phone. This app revolutionizes how critical data is relayed to and from administrative staff, an how administrative staff interact with scheduling, among other HR related tasks, and provides an unprecedented insight/measurement to KPIs. *Current state* warehouse provided inventory (furniture, accessories) is managed through paper lists and signoffs that are often misplaced or delayed in given to office staff (pain point).
- _Hint:_ e.g. 'Dispatchers lose 2 hours a day chasing ETAs by phone because drivers have no structured way to report status from the road'

**Q5.** Who are the 2–3 named tools or competitors your target customers are using today (even if it is just WhatsApp, Excel, or paper)? A sentence on where each falls short for your use case is enough — this sets the competitive wedge and the 'why us' story.

- _Type:_ free text
- _Answer:_ Our target customers currently rely on three tools: (1) WhatsApp — used for driver dispatch and delivery confirmations, but messages get buried, there's no audit trail, and managers can't see real-time location or job status at a glance. (2) Excel/Google Sheets — used for route planning and proof-of-delivery logging, but it breaks down the moment data needs to be entered offline or synced across multiple field workers simultaneously. (3) Paper manifests and clipboards — still common for last-mile and warehouse handoffs, but they create reconciliation delays, are lost or damaged easily, and offer zero visibility to back-office teams until end of day. (4) Samsara
- _Hint:_ e.g. 'Samsara for GPS tracking (no task management), ServiceTitan for scheduling (desktop-only, too heavy), WhatsApp groups (no audit trail or dispatch control)'

**Q6.** What are your target dates for alpha, beta, and GA — and is any date hard (tied to a customer contract, a conference, or a funding milestone)? If you have a rough quarter in mind, that is enough to start.

- _Type:_ free text
- _Answer:_ hard launch date September 01 2026.
- _Hint:_ e.g. 'Alpha internal: end of Q3 2025, Beta with 3 pilot customers: Q4 2025, GA: Q1 2026 — GA date is soft, beta is hard because of a pilot contract'

_— answered by Product Manager  `2026-07-24T17:49:22.702308+00:00`_

#### AI · Customer Segment  `2026-07-24T17:50:00.632509+00:00`

The picture is sharpening fast — high-end furniture installers in the field, paper-and-phone chaos replaced by a structured mobile + desktop tool, internal to one operation, with a hard September 1 2026 ship date and offline caching as a non-negotiable. Two things the segment answer gave me that I want to lock down: you named the **field worker** role clearly (furniture installers), but the **admin/dispatcher persona** — the person sitting at a desktop scheduling jobs and pulling billing data — still needs a title and a quarterly priority so we know who in the org is the internal sponsor driving this build. I also want to pull the opportunity side out cleanly: you described the pain well (paper lists, phone notes, WhatsApp burial), but what does the **business** now get to do once those pains are gone — faster invoicing, more jobs per crew per week, fewer billing disputes? That upside shapes the MVP's must-have metrics.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "Product will be distributed through app stores"
new_decision: "Internal operational app — not sold through any platform; MDM/enterprise sideload is the distribution path, not public app stores"
propagation: Architect must remove app-store review constraints and instead plan for MDM/enterprise distribution (e.g. Intune, Jamf, or direct APK/IPA sideload); update deployment and update-cadence assumptions accordingly
rationale: Internal enterprise apps bypass store review cycles and can push updates on internal schedules, which changes release architecture materially.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "none"
new_decision: "Field app must cache data when there is no WiFi or signal"
propagation: Architect must design an offline-first data layer (local cache, sync queue, conflict resolution) for the mobile surface; this is a hard constraint, not a nice-to-have
rationale: Furniture installers work in buildings with variable connectivity; data loss during a job is a critical failure mode.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "none"
new_decision: "Two distinct user surfaces: field worker on mobile (installer), admin/dispatcher on desktop"
propagation: UI/UX must design two separate interaction models — touch-first job-execution flow for mobile, and a scheduling/reporting dashboard for desktop; shared components must not compromise either
rationale: The personas have fundamentally different task shapes (task completion vs. oversight), so a single layout will not serve both.
[/CROSS_ROLE_IMPACT]

**Q1.** What is the job title and department of the admin worker using the desktop side — e.g. 'Operations Manager', 'Dispatch Coordinator', 'Office Manager'? And what is the single thing keeping them up this quarter — the problem they need this tool to solve before September?

- _Type:_ free text
- _Answer:_ Administrative workload bloat between app - collected data and bookkeeping/HR software (QuickBooks), CRM software (Smartmoving), and Scheduling software (google calendar). Office manager is probably best role name -- it has a broad scope, encompassing ops, dispatch, sales, and other administrative tasks.
- _Hint:_ e.g. 'Operations Manager — owns crew scheduling and billing reconciliation; this quarter's pressure is cutting invoice-to-payment cycle from 14 days to 5 because billing disputes from missing paperwork are holding up cash flow'

**Q2.** Once the paper lists, phone notes, and WhatsApp burial are gone, what does the **business** get to do that it cannot do today — e.g. run more jobs per crew per day, close invoices the same day, eliminate a reconciliation headcount?

- _Type:_ free text
- _Answer:_ all of the above, and increase fidelity in data due to reduced number of manual entry steps.
- _Hint:_ e.g. 'Admin can close and send invoices the same day a job is completed instead of waiting 3–5 days for paper to reach the office — directly improves cash flow and reduces billing disputes'

**Q3.** How many field installers and how many admin/office staff will use this tool on day one — and is this one company's internal tool, or built to eventually serve multiple companies in this vertical?

- _Type:_ free text
- _Answer:_ Company internal tool; approximately 50 field installers and 8 office staff.
- _Hint:_ e.g. '~30 field installers, 5 admin staff, single company for now — potential to white-label to other furniture installation firms later'

**Q4.** You flagged warehouse inventory — paper lists, lost signoffs — as a core pain point. Is inventory tracking (what furniture/accessories left the warehouse, what was installed, what came back) a **must-have** for the September launch, or a phase-2 addition once scheduling and field data capture are live?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Must-have at September launch — billing and KPIs depend on it
    - [ ] Phase 2 — scheduling and field data capture ship first
    - [ ] Unsure — needs scoping conversation

**Q5.** You mentioned KPI measurement as a key outcome. Name the 2–3 KPIs the admin team most needs to track — the ones a manager would look at every week to judge whether crews are performing.

- _Type:_ free text
- _Answer:_ estimated duration/cost vs actual duration/cost, actual revenue by job types, total client relationship spend across jobs
- _Hint:_ e.g. 'Jobs completed per crew per day, items damaged or returned per job, time from job-complete to invoice sent'

_— answered by Product Manager  `2026-07-24T18:06:12.505775+00:00`_

#### AI · Customer Segment  `2026-07-24T18:06:41.369842+00:00`

The KPIs you named — estimated vs. actual duration/cost, revenue by job type, and total client relationship spend — are exactly the kind of weekly management metrics that shape what data the field app must capture at the job level, so that's a sharp answer. Tying that to the earlier fact that ~50 field installers and 8 office staff will use this on day one, and the Office Manager persona owns a sprawling scope (ops, dispatch, sales, billing reconciliation across QuickBooks, Smartmoving, and Google Calendar), I now have a clear picture of both personas and their pains. Two gaps remain before this aspect can close: (1) the **integration intent** — the Office Manager's core pain is workload bloat across those three external tools, and I need to know whether this app is meant to push/pull data to QuickBooks and Smartmoving at launch or simply reduce manual re-entry by being the single source of record that staff copy from; (2) the **buyer authority** — since this is an internal tool, who inside the org approved the build and owns the budget for it, because that person's priorities govern what "done" looks like at the September 1 hard date.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "none"
new_decision: "Office Manager's core pain is administrative workload bloat between this app, QuickBooks, Smartmoving, and Google Calendar"
propagation: Developer must assess and plan integration surface (API, CSV export, or manual hand-off) for QuickBooks, Smartmoving, and Google Calendar; scope of integration is unresolved and must be confirmed before data model is finalized
rationale: If the app is the system of record that feeds downstream tools, the data schema and export formats are architectural constraints, not nice-to-haves.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "Two distinct user surfaces: field worker on mobile, admin/dispatcher on desktop"
new_decision: "KPIs are: estimated vs. actual duration/cost, revenue by job type, total client relationship spend across jobs"
propagation: UI/UX must design a weekly KPI dashboard view on the desktop surface surfacing these three metrics; field app must capture job-level time, cost, and job-type data as structured fields (not free text) to feed them
rationale: KPIs are only as good as the structured data the field worker captures at the job level; unstructured notes will not aggregate.
[/CROSS_ROLE_IMPACT]

**Q1.** The Office Manager's biggest pain is re-entering data across QuickBooks, Smartmoving, and Google Calendar. At September launch, is the goal a live integration (app pushes/pulls data to those tools automatically), or is the win simply having one clean source of record that staff copy from — reducing re-entry steps, not eliminating them?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Live integration with at least one tool at launch (e.g. QuickBooks sync)
    - [x] Single source of record only — staff still transfer, but from one clean place
    - [ ] Unsure — needs scoping before September commit

**Q2.** Since this is an internal build, who approved it and owns the definition of 'done' by September 1 — the Office Manager, a company owner/CEO, or someone else?

- _Type:_ free text
- _Answer:_ Myself, company owner
- _Hint:_ e.g. 'Company owner / CEO — she approved the build and will sign off at launch; Office Manager is the day-to-day champion but not the final authority'

**Q3.** You named 'revenue by job type' as a key KPI — what are the 2–4 job types the business actually runs (e.g. new installation, repair, warehouse delivery, client pickup)?

- _Type:_ free text
- _Answer:_ Designer Installs, delivery, commercial, local, long distance, internal rearrange, white glove, junk removal, hot tub move,
- _Hint:_ e.g. 'New commercial installation, residential delivery + setup, warranty return, warehouse transfer'

_— answered by Product Manager  `2026-07-24T18:10:30.994459+00:00`_

### Aspect: Market Landscape

#### AI · Market Landscape  `2026-07-24T18:11:21.817926+00:00`

Nine distinct job types — white glove, hot tub move, designer installs, commercial, long distance — paints a sharp picture of a multi-modal operation that no generic delivery app handles cleanly, and that taxonomy is exactly the kind of structured data the KPI dashboard will need to slice revenue by. Now we're opening the **Market Landscape** leg, and I want to ground it in public reality before asking you to weigh in. Verdantix values the global Field Service Management (FSM) software market at **$4.7 billion in 2024**, growing to roughly $5.8B by 2035 (MarketReportsWorld). The furniture-specific delivery software tier is a narrower slice — tools like **DispatchTrack** (comprehensive delivery management + predictive analytics for furniture shipments), **Bringg** (end-to-end logistics orchestration, marketplace integration), and **OptimoRoute** (automated scheduling and routing for bulky-item fleets) dominate the delivery side, but none of them combine the installation-side field data capture, inventory sign-off, and crew KPI tracking that your operation needs. That gap is the product's natural wedge. The five questions below are all I need to lock down this aspect.

**Q1.** For a pitch or internal business case, which TAM framing best fits how you'd describe the opportunity: (a) the $4.7B global FSM market — broadest, (b) the US furniture delivery + installation services sub-segment (roughly $500M–$1B, bottom-up), or (c) a single-company internal tool where TAM isn't the right frame at all?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] $4.7B FSM market — broadest frame
    - [ ] $500M–$1B US furniture install/delivery sub-segment
    - [x] Internal tool — TAM framing doesn't apply
    - [ ] Unsure — haven't thought about it in TAM terms

**Q2.** You named WhatsApp, Excel, paper manifests, and Samsara as what the team uses today. Of the named delivery tools in the market — DispatchTrack, Bringg, OptimoRoute — did you evaluate any of them and find them lacking, or did they never come up as candidates?

- _Type:_ free text
- _Answer:_ Not all of those are used currently. We use a combination of google sheets, google calendar, smartmoving, asana (not a comprehensive list)
- _Hint:_ e.g. 'Looked at DispatchTrack — good for routing but no installer-side data capture or inventory sign-off, and it's priced for fleets of 100+ trucks, not a 50-person crew'

**Q3.** What changed in the last 12–24 months that makes September 2026 the right moment to build this — is it a growth inflection (more jobs, more crews), a failed tool that finally broke, a competitive pressure, or something else?

- _Type:_ free text
- _Answer:_ total revenue is up \~70% YTD (high growth period), with more jobs and more employees; Merging with/acquiring a storage company EOY, and one of the storage company owners may/will have a role in future app design. Feeling friction from current systems and lack of good data to run analytics as a large limiting factor for limiting continuing to grow from \~1.6M revenue to 10+M revenue (long term goal).
- _Hint:_ e.g. 'Crew size doubled in 2024 and the paper + WhatsApp system completely collapsed — reconciliation errors were costing us 2–3 days of admin time per week and we lost a commercial client over a billing dispute'

**Q4.** If the app could only be fully polished for ONE job type at launch and the rest got basic support, which job type would you choose — the one where data accuracy matters most or volume is highest?

- _Type:_ free text
- _Answer:_ local/residential (highest volume). Designer installs are close second (lower volume, but still a significant portion of total volume, and is the corner of the market we want to move towards).
- _Hint:_ e.g. 'Designer Installs — highest ticket value, most complex inventory sign-off, and the job type where a billing error hurts the most'

**Q5.** What's the single stat, real incident, or dollar amount you'd put on slide one of an internal pitch to justify this build — something concrete that happened in your operation?

- _Type:_ free text
- _Answer:_ We have 3 different DBs that house billing data, and manual steps are required to transfer between each; We are spending roughly 2000 every quarter on software that does not meet our needs.
- _Hint:_ e.g. 'We lost a $40K commercial contract because we couldn't produce a clean delivery manifest — that one incident paid for this build twice over'

_— answered by Product Manager  `2026-07-24T18:24:10.567908+00:00`_

#### AI · Market Landscape  `2026-07-24T18:24:35.315193+00:00`

The 70% revenue growth YTD, the impending storage company merger, and the $2K/quarter spent on software that doesn't work together — that trio is exactly the kind of concrete, operational "why now" that belongs on slide one of any internal business case. Tying that to earlier answers: you've confirmed this is a **single-company internal tool** (TAM framing doesn't apply), the primary tool stack is Google Sheets + Google Calendar + Smartmoving + Asana, and the beachhead at launch is **local/residential jobs** (highest volume), with Designer Installs as the strategic second priority. The market landscape picture is nearly complete — I just need to close two remaining gaps: (1) the competitive positioning story against the tools you actually evaluated (not delivery-platform tools, but the ops/scheduling tools you currently use and are replacing), and (2) a sharper version of the slide-one evidence stat that a reader could act on.

**Q1.** For each tool you currently use — Google Sheets, Google Calendar, Smartmoving, Asana — what is the single thing it fails to do that forces a manual workaround? One line per tool is enough.

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Smartmoving: no mobile field capture for installers. Google Sheets: breaks when two people edit simultaneously offline. Asana: no billing data, just task status. Google Calendar: no crew capacity view.'

**Q2.** You named 70% revenue growth, a storage company merger, and $2K/quarter in misfit software as the pressure. Which of these is the single most urgent forcing function — the one that makes waiting another year genuinely costly?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Revenue growth — current systems will break before we hit $3M
    - [ ] Storage merger — new entity needs a unified ops tool from day one
    - [ ] Software spend — sunk cost that accelerates the build decision
    - [ ] All three equally — they converged at the same time
- _In their words:_ It is really hard to pick between revenue growth and storage merger. If I had to pick, storage merger, but revenue growth is a massive deal as well

**Q3.** The 3-database / manual-transfer pain is vivid — can you attach a dollar amount or time cost to it? For example, how many hours per week does the Office Manager spend on manual data transfers, or how many billing errors or disputes has it caused in the last quarter?

- _Type:_ free text
- _Answer:_ \~20+ hrs/week @ 22.50/hr for our office assistant (primary person doing these tedious transfers).
- _Hint:_ e.g. '~5 hrs/week in manual re-entry across the three systems, plus 2 disputed invoices last quarter that delayed ~$8K in payments'

**Q4.** Will the storage company's operations (storage jobs, inventory, staff) need to be inside this same app at September launch, or is the merger a future expansion trigger after v1 ships?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] In scope at September launch — merged entity needs it day one
    - [x] Post-launch — v1 serves current operation only, storage folds in later
    - [ ] Unsure — depends on merger timeline

_— answered by Product Manager  `2026-07-24T18:28:37.971812+00:00`_

#### AI · Market Landscape  `2026-07-24T18:29:02.843376+00:00`

The $20+/hr × 20+ hrs/week figure lands the slide-one stat cleanly — that's roughly $1,800+/week or **~$94K/year** in direct labor cost just for manual data transfers, which dwarfs the $2K/quarter software spend and makes the build ROI self-evident. Combined with the storage merger as the sharpest forcing function and 70% YTD revenue growth as the runway pressure, the "why now" story is airtight. One gap from a prior round is still open: the tool-by-tool failure map (Google Sheets, Google Calendar, Smartmoving, Asana — what each one breaks on). That answer is the competitive positioning story for this app, and it's the last piece needed to close this aspect.

**Q1.** For each tool you currently use — Google Sheets, Google Calendar, Smartmoving, Asana — what is the single thing it fails to do that forces a manual workaround? One line per tool is enough.

- _Type:_ free text
- _Answer:_ google sheets - data integrity/manual user entries creating messy data; adds integration step if automated

google calendar - no custom data fields to store/import/export data cleanly between CRM, field crew job briefing, billing tools, etc.

Smartmoving - poor API communication between external tools, subpar UI/UX, low customization potential, high cost point for their mobile field app

Asana - TBD, Adam (owner of logistics company) is primary user (not used directly by moving company)

Side note: I wrote a comprehensive tool performance and gap analysis recently that answers this question for all tools currently used. ask for me to upload that at some point.
- _Hint:_ e.g. 'Smartmoving: no mobile field capture for installers. Google Sheets: breaks when two people edit offline. Asana: no billing data. Google Calendar: no crew capacity view.'

**Q2.** Earlier you named local/residential as the highest-volume beachhead job type. Is that the slice where the data-transfer pain is also worst, or does a different job type (e.g. Designer Installs) bleed more admin hours?

- _Type:_ free text
- _Answer:_ Long Distance jobs require more admin workload in general. manual recording of fixed LD fees, FMCSA compliance docs, and general logistics
- _Hint:_ e.g. 'Designer Installs bleed more hours because inventory sign-off is more complex, but residential is highest volume so errors compound faster there'

**Q3.** Given the ~$94K/year in manual transfer labor cost, is that the number you'd open an internal business case with — or is there a more visceral incident (a lost client, a billing dispute dollar amount) that tells the story better?

- _Type:_ free text
- _Answer:_ I think your number is off. 22.50/hr for 20 hrs/week is $450 = $23,400 annually. Yes, but i would want to confirm the # of actual hours spent estimate with my office assistant and Office manager.
- _Hint:_ e.g. 'The labor cost is the headline, but we also lost a $15K commercial job because manifests were wrong — that's the gut-punch slide'

**Q4.** You confirmed storage ops fold in post-launch — what's the trigger that reopens that scope? Is it a specific date, a milestone in the merger, or a usage threshold in v1?

- _Type:_ free text
- _Answer:_ Once seller signs  definitive buyout agreement (\~september)
- _Hint:_ e.g. 'Once merger is legally closed and storage owner joins the design process — likely Q1 2027'

_— answered by Product Manager  `2026-07-24T18:40:30.538825+00:00`_

#### AI · Market Landscape  `2026-07-24T18:40:49.898310+00:00`

You've corrected the math cleanly — $23,400/year in confirmed transfer labor is the right anchor, and your instinct to validate the actual hours with your office assistant before committing that number to a business case is exactly right. Pulling together what this aspect has established: the competitive set is Google Sheets (data integrity breaks under multi-user entry), Google Calendar (no custom fields for job briefing or billing export), Smartmoving (poor API, subpar mobile UX, high cost), and Asana (Adam's tool, not directly in the moving company workflow) — and the unique compliance burden of **Long Distance jobs** (FMCSA docs, fixed LD fee recording) surfaced as the heaviest admin-hour sink, not residential as assumed. Two targets from the aspect brief are still formally open: a named competitor positioning summary and a confirmed slide-one evidence stat. The tool gap analysis document you mentioned would close both in one upload — flag it for the document-upload step. For now, two focused questions will close this aspect.

**Q1.** Of the four tools you're replacing — Sheets, Calendar, Smartmoving, Asana — which one would you say is the closest thing to a 'real competitor' this app must clearly beat, and what's the one-sentence reason a new hire would choose this app over it?

- _Type:_ free text
- _Answer:_ The app most directly replaces the Smartmoving Crew App.  Crew would choose the Smartmoving Crew App over what I am trying to built because it is an enterprise grade software that integrates well with our CRM (same company); they would be able to expect extreme reliability, low error rate, and seamless UI/UX components.
- _Hint:_ e.g. 'Smartmoving — it tries to do what we need but the mobile UX is unusable in the field and the API forces manual re-entry anyway; our app wins because it's built around how installers actually work'

**Q2.** Once you've confirmed the actual hours with your office assistant, which number do you expect to lead with on slide one — the annual labor cost, the FMCSA compliance risk on Long Distance jobs, or something else?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Confirmed annual labor cost (~$23K, pending hours check)
    - [ ] FMCSA compliance exposure on Long Distance jobs
    - [ ] Smartmoving cost vs. build cost comparison
    - [x] Tool gap analysis doc will determine this — defer until uploaded

_— answered by Product Manager  `2026-07-24T18:53:48.614249+00:00`_

### Aspect: Solution Vision

#### AI · Solution Vision  `2026-07-24T18:54:13.347116+00:00`

The honest admission that a new hire might still choose Smartmoving's Crew App for its enterprise reliability and CRM integration is exactly the kind of competitive candor that sharpens what this build has to prove — it sets a clear bar. Now we're opening **Solution Vision**, and the prior context gives me a strong running start: 50 field installers + 8 office staff, a hard September 1 2026 ship date, inventory tracking confirmed as a launch requirement, and nine named job types anchored on local/residential volume with Designer Installs as the strategic second priority. Every MVP feature I accept here must trace to one of the pains or opportunities already on the record — paper sign-offs and phone notes, the 3-database manual transfer burden (~$23K/year in admin labor), and the growth-from-$1.6M-to-$10M opportunity that requires clean data to run on. Let's build the vision from what you actually know.

**Q1.** In the words a furniture installer or an office manager would use — not product language — what does this app promise them? Finish this sentence: 'Finally, I can _____ without _____.'

- _Type:_ free text
- _Answer:_ Installer: Finally, I can view all the job data I need in one place, and can relay the information I need to relay with very little friction, so I can focus on the actual moving itself. 

Office manager: Finally, I'm not getting bogged down with tedious tasks I'm positive could be automated, and I actually trust the data that is being collected.
- _Hint:_ e.g. 'Finally, I can close a job and know the invoice is ready without chasing paper or retyping anything'

**Q2.** List the 3–7 features you consider must-haves for September 1 — the ones where, if any were missing, you would delay the launch. One line per feature is enough.

- _Type:_ free text
- _Answer:_ - Time stamp tracking (every stop) for installers with geotags
- seamless FMCSA compliance tools
- billing/invoicing tools that eliminate manual entry downstream (entered once)
- Easy to use scheduling tools (for both schedulers and those being scheduled)
- high fidelity idempotency, ZERO data loss due to server or connectivity issues
- Job data import and export where you need it, when you need it
- _Hint:_ e.g. '1. Job briefing on mobile (replaces phone notes). 2. Inventory sign-off with digital signature. 3. Crew scheduling on desktop. 4. Job-completion data export to billing. 5. KPI dashboard (est. vs. actual cost/duration).'

**Q3.** For each feature you just listed, which specific pain or opportunity from your operation does it serve — paper chaos, the 3-database transfer grind, the growth data gap, or something else?

- _Type:_ free text
- _Answer:_ In order of above list,

- data gap
- replaces paper chaos
- data transfer grind 
- admin workload
- data gap
- data gap and operational efficiency
- _Hint:_ e.g. 'Digital sign-off → eliminates lost paper manifests. Scheduling → replaces Google Calendar's no-custom-fields gap. KPI dashboard → enables the growth-to-$10M analytics we can't run today.'

**Q4.** Name at least two things this app will NOT do in v1 — features that came up in planning but got cut. For each, what would have to happen for it to come back in a future release?

- _Type:_ free text
- _Answer:_ - integrations for pushing/pulling data from existing software like smartmoving, google calendar. to come back, scope needs to be reduced to not strive for full replacement (likely due to unresolvable bugs or issues in custom product)
- full actual inventory tracking on every job (we still have to track for LD BOLs due to FMCSA for LD jobs).  Would need to find a way to make this not overly cumbersome and time consuming to crews (we bill by the hour).
- _Hint:_ e.g. '1. QuickBooks live sync — cut for v1 (single source of record is enough); comes back when manual transfer hours stay above 10/week post-launch. 2. FMCSA compliance docs — cut for v1; comes back when long-distance job volume exceeds 20/month.'

**Q5.** What is the single belief this entire vision rests on that has NOT yet been proven — the one thing that, if wrong, would require a major pivot? Phrase it as a bet: 'We are betting that _____.'

- _Type:_ free text
- _Answer:_ We are betting that creating a custom software will outperform any out of the box solution on cost, and usability.
- _Hint:_ e.g. 'We are betting that field installers will consistently complete structured digital job forms on their phones mid-job, rather than reverting to phone notes because it's faster in the moment.'

_— answered by Product Manager  `2026-07-24T19:11:09.209300+00:00`_

#### AI · Solution Vision  `2026-07-24T19:11:44.423989+00:00`

The MVP list and pain-tracing you gave is genuinely sharp — six features, each tagged to a real operational hurt, with two honest non-goals and a bet that is actually falsifiable. A few things need tightening before this aspect closes. The value propositions are vivid but slightly long for a launch deck — the installer's "view all job data in one place and relay what I need with little friction" and the office manager's "not getting bogged down with tedious tasks I trust the data being collected" are the raw material, and I want to compress each into a single sentence that survives a slide. The non-goals also need sharper triggers: "unresolvable bugs" is a condition, not a trigger a stakeholder can act on. And the biggest assumption you named — custom software outperforms off-the-shelf on cost and usability — is a *build* assumption, not a *customer behavior* assumption; the Customer role needs a belief about how field installers will actually use the app mid-job, not just whether the build is justified.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: \"Single source of record only — staff still transfer, but from one clean place\"
new_decision: \"Non-goal: live integrations with Smartmoving and Google Calendar in v1; re-open trigger is scope reduction (v1 bugs or replacement fails)\"
propagation: Developer must NOT plan API integration with Smartmoving or Google Calendar for v1; design data export formats (CSV or structured JSON) that make manual transfer as low-friction as possible instead
rationale: If integrations are non-goals, the data layer must still make hand-off clean without automation.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: \"Field app must cache data when there is no WiFi or signal\"
new_decision: \"'High fidelity idempotency, ZERO data loss due to server or connectivity issues' is a launch-blocking feature\"
propagation: Architect must treat offline sync and idempotent write operations as hard architectural constraints, not enhancements; conflict-resolution strategy for concurrent offline edits must be specified before construction begins
rationale: Stakeholder would delay the September launch if this feature were missing — it is not optional.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: customer
affects_variant: any
prior_decision: \"none\"
new_decision: \"Biggest assumption: custom software outperforms off-the-shelf on cost and usability\"
propagation: Customer Advocate must probe whether field installers will consistently use structured digital forms mid-job rather than reverting to phone notes — the usability half of this bet depends entirely on in-field adoption behavior, which only the Customer role can validate
rationale: A build assumption about cost/usability is not falsifiable without real user behavior data; Customer discovery must stress-test field adoption.
[/CROSS_ROLE_IMPACT]

**Q1.** The installer and office manager sentences you gave are the right material — can you compress each into one clause, 15 words or fewer, that could go under a product logo on slide one?

- _Type:_ free text
- _Answer:_ Installer: 'Every job detail, one tap away.' Office manager: 'Clean data in, zero busywork out.'
- _Hint:_ e.g. Installer: 'Every job, every stop, in my pocket — nothing to remember, nothing to lose.' Office manager: 'One place to trust, zero re-typing.'

**Q2.** For the two non-goals — live integrations and full inventory tracking — can you replace 'unresolvable bugs' with a concrete, observable trigger: a job-volume threshold, a date, or a specific failure event that would reopen each?

- _Type:_ free text
- _Answer:_ 1) custom built alternatives would have to underperform what they aim to replace eg job data for an entire job gets lost or fails to populate in the right place

2) a significant increase in billing disputes due to actual time taking longer than estimated time (we find this often happens due to undisclosed items, and would be falsifiable with a record of what actually got moved).
- _Hint:_ e.g. 'Live integrations: reopen if manual transfer hours stay above 10/week at 60 days post-launch. Full inventory tracking: reopen when LD jobs exceed 30/month or a billing dispute is traced to a missing BOL item.'

**Q3.** You listed 'seamless FMCSA compliance tools' as a must-have. What does that mean concretely for September — is it digital BOL generation for long-distance jobs, driver hours-of-service logging, or something else?

- _Type:_ free text
- _Answer:_ For September, FMCSA compliance means two concrete things: (1) digital Bill of Lading generation with required carrier/shipper fields auto-populated from the job record, exportable as a signed PDF for long-distance interstate moves, and (2) driver hours-of-service logging with a simple clock-in/out tied to each job leg that produces a compliant summary report. DOT number and MC number validation on carrier profiles is included; full ELD hardware integration is out of scope, we are protected under TRALA exemption for rental trucks for LD jobs and do not need to ever use ELDs. DVIR recording and mechanic e-signature tool, Dqual docs accessible from anywhere.
- _Hint:_ e.g. 'Digital BOL with required fields pre-filled from job data, plus a signature capture for the consignee — that's the paper we currently lose'

**Q4.** The build assumption (custom beats off-the-shelf) is a justified one — but for the Customer discovery role, we need the *behavior* assumption: what must field installers actually DO differently mid-job for this app to work, and what's your biggest fear about whether they will?

- _Type:_ free text
- _Answer:_ Field installers must stop defaulting to paper notes and verbal handoffs mid-job, and instead log job data (photos, measurements, issues) into the app in real time before leaving the site. The biggest fear is that under time pressure or poor connectivity, installers will revert to snapping phone photos and texting the office, creating the exact parallel data trail the app is meant to eliminate.
- _Hint:_ e.g. 'We are betting that installers will stop texting job updates to the office and instead log them in the app mid-job — our fear is they revert to WhatsApp because it's faster when they're on the clock'

_— answered by Product Manager  `2026-07-24T19:20:52.129465+00:00`_

#### AI · Solution Vision  `2026-07-24T19:21:25.288464+00:00`

The FMCSA answer in particular is a rare level of specificity — digital BOL with auto-populated fields, clock-in/out HOS logging, DOT/MC validation, DVIR recording, and DQ docs accessible anywhere is a concrete, testable scope boundary that most PMs wouldn't nail until construction. Combined with the compressed value props ('Every job detail, one tap away' / 'Clean data in, zero busywork out'), the non-goal triggers, and the behavior assumption about mid-job reversion, this aspect is essentially landed. Two small gaps remain before I can close it: (1) the MVP feature list needs the FMCSA compliance feature formally folded in and the six features mapped as a clean numbered set, and (2) the non-goal triggers are still slightly behavior-dependent ('job data gets lost') rather than observable by a manager at a dashboard — I want to harden each trigger to something the Office Manager can see without debugging the app.

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: "seamless FMCSA compliance tools listed as a must-have MVP feature"
new_decision: "FMCSA scope at September launch: digital BOL (auto-populated, signed PDF export), HOS clock-in/out per job leg with compliant summary report, DOT/MC number validation on carrier profiles, DVIR recording with mechanic e-signature, DQ docs accessible from the app; full ELD hardware integration explicitly excluded (TRALA exemption applies)"
propagation: Developer must scope these five FMCSA sub-features as distinct buildable units; ELD integration must be marked out-of-scope in the data model; DQ doc storage implies a document-management layer for the mobile surface
rationale: The FMCSA feature set is materially more complex than a single feature — it has five distinct sub-components, each with compliance output requirements that affect data model and PDF generation.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: customer
affects_variant: any
prior_decision: "none"
new_decision: "Biggest customer behavior assumption: field installers will log job data (photos, measurements, issues) in real time before leaving the site, rather than reverting to phone photos and WhatsApp under time pressure or poor connectivity"
propagation: Customer Advocate must design discovery questions that stress-test this behavior assumption — specifically: under what on-site conditions do installers currently default to phone notes, and what would make in-app logging feel faster than texting?
rationale: If this assumption fails, the entire real-time data capture strategy fails; Customer discovery must either validate it or surface the friction that needs to be removed in the UX before construction begins.
[/CROSS_ROLE_IMPACT]

**Q1.** Below is the MVP feature set as I'd write it on the launch deck — check anything that needs to change, or accept all if it reads right.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] 1. Job briefing on mobile — timestamp + geotag every stop (serves: data gap)
    - [x] 2. FMCSA compliance suite — digital BOL, HOS logging, DVIR, DQ docs (serves: paper chaos on LD jobs)
    - [x] 3. Billing data capture — enter once, export clean (serves: 3-database transfer grind)
    - [x] 4. Crew scheduling on desktop — replaces Google Calendar's no-custom-fields gap (serves: admin workload)
    - [x] 5. Offline-first sync — zero data loss on poor or no connectivity (serves: data gap + installer behavior risk)
    - [x] 6. KPI dashboard — est. vs. actual cost/duration, revenue by job type, client spend (serves: growth analytics gap)
    - [ ] Accept all — this is the MVP list

**Q2.** For the two non-goals, can you restate each trigger as something the Office Manager could observe in a weekly report — not a bug report? For example: 'X jobs in a row where data landed in the wrong field' or 'billing dispute rate rises above Y% in any 30-day period.'

- _Type:_ free text
- _Answer:_ Non-goal 1 (manual data re-entry): trigger becomes 'average fields manually corrected per job exceeds 3 in any given week, visible in the weekly data-quality summary.' Non-goal 2 (compliance document chasing): trigger becomes 'outstanding or overdue compliance documents per active carrier rises above 2 on the weekly carrier-status report for two consecutive weeks.'
- _Hint:_ e.g. 'Live integrations: reopen if manual transfer time stays above 10 hrs/week at 60 days post-launch. Full inventory tracking: reopen if billing disputes exceed 5% of jobs in any calendar month.'

**Q3.** For the Customer role's charter: what would a field installer have to show you — a behavior, a number, a pattern — at 30 days post-launch that would tell you the mid-job reversion fear was wrong and the app is winning?

- _Type:_ free text
- _Answer:_ At 30 days, the clearest signal is zero mid-job app abandonment: the installer completes the digital BOL, DVIR, and clock-out on the same device without switching to paper or a phone call. Pair that with a measurable number — 85%+ of assigned jobs showing a fully closed digital record (signed PDF exported, HOS entry logged) with no manual correction request filed by the office. The pattern that kills the reversion fear for good is the installer voluntarily pulling up a prior job's DQ docs or BOL on-site to answer a customer question, unprompted — that's proof the app is now a trusted reference, not just a data-entry burden.
- _Hint:_ e.g. '90%+ of jobs have a timestamped in-app log entry before the crew leaves the site — if we see that, the reversion fear is gone'

_— answered by Product Manager  `2026-07-24T19:25:35.607814+00:00`_

### Aspect: Product Form Factor

#### AI · Product Form Factor  `2026-07-24T19:26:02.993465+00:00`

The 30-day adoption signal you described — installer voluntarily pulling up prior DQ docs on-site to answer a customer question, unprompted — is the sharpest falsifiable success metric I've seen a PM set for a field app, and it closes the Solution Vision aspect cleanly. Now we're opening **Product Form Factor**, and the prior context already gives me most of what I need: internal-only tool (not sold through any platform), ~50 field installers on mobile + 8 office staff on desktop, hard September 1 2026 ship date, offline-first caching as a launch blocker, and an MDM/enterprise distribution path confirmed over app-store. The open targets I still need to lock are the exact named front ends for each surface, the distribution and provisioning mechanics for an internal MDM deployment, the tenancy shape (one private deployment vs. shared infra), and precisely where the app lives in a Tuesday for both the installer and the Office Manager.

**Q1.** You rejected the app-store / native-mobile-primary assumption in the opening round. To settle the primary form factor cleanly: is the field installer's surface a **native iOS/Android app** (installed via MDM), or a **mobile web app** that runs in a browser on their phone?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Native iOS + Android app — installed via MDM or direct APK/IPA
    - [x] Mobile web app — browser-based, no install required
    - [ ] Unsure — needs a technical conversation first

**Q2.** The Office Manager's desktop surface — is it a **web app** they open in a browser (Chrome, Safari), or a **native desktop app** installed on a Mac or Windows machine?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Web app in a browser — no install, any machine
    - [ ] Native desktop app — installed on Mac or Windows
    - [x] Either works — no strong preference

**Q3.** Since this is internal-only and not sold through app stores, how do new field installers get the app on day one — does IT push it via MDM (Intune, Jamf), do installers download a direct link from an internal portal, or does someone hand-configure each device?

- _Type:_ free text
- _Answer:_ link to PWA with single-page "how to add to home screen" instruction doc
- _Hint:_ e.g. 'IT pushes via Intune to company-owned iPhones on hire date — no installer action needed' or 'Installers use personal phones; they get a QR code link on their first shift'

**Q4.** From a product and data perspective, is this a single private deployment for your company only — one database, one instance, no other companies ever sharing it — or is the architecture meant to eventually support multiple companies on shared infrastructure?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Single private deployment — one company, one instance, always
    - [ ] Single company now, but built to support multiple companies later
    - [ ] Multi-company from day one — shared infra, separate workspaces
- _In their words:_ single company now, maybe more down the line

**Q5.** Picture a Tuesday: the installer is on a job site, the Office Manager is at her desk. Where does each person meet this app — is it open all day in the foreground, pulled up at job-start and job-end only, or somewhere in between?

- _Type:_ free text
- _Answer:_ installer: open periodically on their phones throughout the day 

Office: open constantly as the center hub of admin work
- _Hint:_ e.g. 'Installer: opens at first stop, logs at each stop, closes at job-end — ~4 discrete interactions per shift. Office Manager: open all morning for scheduling, then checks KPI dashboard end of day.'

**Q6.** Do field installers use company-owned devices or personal phones — and does the answer differ for iOS vs. Android?

- _Type:_ free text
- _Answer:_ personal phones of varying types
- _Hint:_ e.g. 'Company-owned iPhones for all installers — no personal devices, no Android in the field' or 'Mix — lead installers have company iPhones, helpers use personal Android devices'

_— answered by Product Manager  `2026-07-24T19:30:03.852047+00:00`_

#### AI · Product Form Factor  `2026-07-24T19:30:37.943875+00:00`

A PWA distributed via a shared link and a "how to add to home screen" doc on personal phones of varying types is a crisp, low-friction distribution answer that clarifies a lot — it means no IT department, no MDM, no device control, and the product must work on whatever browser ships on a given Android or iOS device. Combining that with the earlier confirmation that ~50 field installers use personal devices and the Office Manager runs this as "the center hub of admin work" open constantly at her desk, the form factor picture is nearly complete. Two gaps remain: (1) the **PWA** choice is a consequential one — it sits between a native app and a pure browser tab, and I want to confirm you're choosing it deliberately for the home-screen icon and offline caching behavior, not just as a default; and (2) the tenancy framing ("single company now, maybe more down the line") needs a lightweight trigger so the Architect knows when to design for multi-tenancy instead of a single private instance.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "Field app must cache data when there is no WiFi or signal"
new_decision: "Field installer surface is a PWA distributed via direct link to personal phones of varying types — no MDM, no company-owned devices"
propagation: Architect must design the offline-first layer specifically for PWA service-worker constraints, not native app storage APIs; must also account for browser diversity (Safari on iOS, Chrome on Android) and their differing PWA capability levels, particularly iOS Safari's historically limited service-worker and push-notification support
rationale: PWA offline and push-notification behavior differs materially between iOS Safari and Android Chrome; the Architect's sync strategy must account for these gaps, especially given the "zero data loss" hard constraint.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "Two distinct user surfaces: field worker on mobile, admin/dispatcher on desktop"
new_decision: "Office Manager surface is browser-based (no strong preference for native desktop); field surface is a PWA on personal phones of varying types"
propagation: UI/UX must design the desktop surface as a responsive web app that works across Chrome/Safari/Edge without a native install; the mobile surface must meet PWA installability requirements (manifest, service worker, HTTPS) so the home-screen add works cleanly on both iOS and Android
rationale: A "no strong preference" desktop answer defaults to web app, which means a single codebase can serve both surfaces — but the responsive breakpoints and touch targets must be designed explicitly for each context.
[/CROSS_ROLE_IMPACT]

**Q1.** The PWA path gives you a home-screen icon and offline caching without an app-store review cycle — is that the deliberate reason you chose it, or was it a default that you're open to revisiting if native performs better on iOS?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Deliberate — home-screen icon + offline + no store review is the right trade-off
    - [x] Default — open to native if PWA limits become a problem
    - [ ] Unsure — haven't weighed the trade-offs yet

**Q2.** On iOS, Safari limits PWA push notifications and background sync more than Android Chrome does — given that installers are on personal phones of varying types, is push notification delivery to iOS devices a must-have at September launch?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Must-have — installers need push alerts on iOS and Android
    - [x] Nice-to-have — in-app alerts are enough for v1
    - [ ] Unsure — depends on what the app needs to push

**Q3.** You said 'single company now, maybe more down the line' — what specific event would trigger the decision to open this up to a second company: the storage company merger completing, a future revenue goal, or something else?

- _Type:_ free text
- _Answer:_ merger complete, owning partner structure for next 5 years is planned and stable.
- _Hint:_ e.g. 'Storage merger closes and their ops team needs the same tool — that's the trigger; no plan to sell it externally'

**Q4.** Since the Office Manager's desktop surface is browser-based and open all day as the center hub, does she need it to survive a browser refresh without losing state — e.g. an in-progress schedule she's editing?

- _Type:_ yes / no
- _Answer:_ Yes

**Q5.** Because installers use personal phones with no MDM, the company has no remote-wipe or access-revoke capability on those devices — is that an acceptable risk for v1, or does it trigger a security requirement (e.g. session timeout, PIN on app open)?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Acceptable risk for v1 — address post-launch if issues arise
    - [ ] Needs a mitigation at launch — session timeout or PIN
    - [ ] Unsure — needs a security conversation

_— answered by Product Manager  `2026-07-24T19:36:56.231225+00:00`_

#### Product Manager  `2026-07-24T19:36:56.374147+00:00`
_(course_correction)_

I think an additional review of my documentation in the repo I provided will help answer some of these questions. ask me targeted questions about what exists now vs where i want to be.

#### AI · Product Form Factor  `2026-07-24T19:37:24.411564+00:00`

Understood — you want questions grounded in what the repo docs describe as the current state so the gaps map to where you're headed, not hypotheticals. With the form factor picture now close to settled — PWA-first on personal phones (open to native if iOS limits bite), browser-based desktop open all day as the admin hub, in-app alerts sufficient for v1, and no-MDM risk accepted — the two remaining gaps are (1) the exact named front ends as they exist or are spec'd today vs. what's new, and (2) the tenancy/deployment shape. Pull from the repo docs for these.

[CROSS_ROLE_IMPACT]
affects_role: security
affects_variant: any
prior_decision: "Acceptable risk for v1 — address post-launch if issues arise"
new_decision: "No MDM, no remote-wipe, no device control on personal installer phones accepted as v1 risk"
propagation: Security must record this as an accepted risk in the threat model and define the post-launch trigger for revisiting (e.g. data breach, offboarding gap, or a specific incident type) — session timeout and PIN requirements deferred but must have a named re-open condition
rationale: An accepted risk without a named re-open trigger becomes a permanent gap; Security must own the monitoring condition.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "Single company now, maybe more down the line"
new_decision: "Multi-tenancy trigger: merger complete and owning partner structure stable for next 5 years"
propagation: Architect may design v1 as a single-tenant instance but must flag any schema or infra decisions that would make multi-tenant migration costly — the trigger is a real business event, not a vague future
rationale: A concrete trigger means the Architect can assess whether to invest in tenant-isolation scaffolding now vs. a full refactor later.
[/CROSS_ROLE_IMPACT]

**Q1.** In the repo docs, what does the current mobile surface look like — is there an existing field app or spec, and what's the single biggest gap between that and what you need by September 1?

- _Type:_ free text
- _Answer:_ see repo
- _Hint:_ e.g. 'Repo has a React Native prototype with job briefing only — missing offline sync, FMCSA BOL, and the home-screen PWA install flow'

**Q2.** Same question for the desktop/admin surface — what exists or is specced in the repo today, and what does the Office Manager's 'center hub' need that isn't there yet?

- _Type:_ free text
- _Answer:_ see repo
- _Hint:_ e.g. 'Repo has a scheduling grid wireframe but no KPI dashboard, no billing export, and no session-persistence between refreshes'

**Q3.** Does the repo doc or spec already commit to a PWA build approach, or is the tech choice still open — and if it's open, what constraint in the docs (timeline, dev resource, device support) most narrows the decision?

- _Type:_ free text
- _Answer:_ repo is set up as PWA, but i am open to other options. PWA limitations and cost of alternatives drive the decision.
- _Hint:_ e.g. 'Repo spec says PWA with React; no native Swift/Kotlin work started — switching to native would add ~8 weeks'

**Q4.** What names do the repo docs use for the two front ends — is there a named field app and a named admin/scheduling console, or are they described differently?

- _Type:_ free text
- _Answer:_ They are built as a single entity, with admin vs crew access restrictions.
- _Hint:_ e.g. 'Repo calls them CrewApp (mobile) and OpsDesk (admin) — or just Field View and Back Office'

_— answered by Product Manager  `2026-07-24T19:40:06.373308+00:00`_

#### AI · Product Form Factor  `2026-07-24T19:40:37.070628+00:00`

The single-entity architecture with role-based access restrictions is a meaningful design decision — it means there's one app, one codebase, one URL, and the experience diverges by login role rather than by surface, which simplifies distribution and maintenance considerably. Tying that to what's already settled: the repo is set up as a PWA (open to native if limits bite), the field installer surface lives as a home-screen icon on personal phones accessed periodically throughout a shift, and the Office Manager has it open all day as her scheduling and admin hub. The two remaining gaps for this aspect are (1) formally naming the single front end — since there's one app with two role views, what do you call it? — and (2) confirming the PWA-vs-native trade-off decision so the Architect and UI/UX aren't designing to an open question.

[CROSS_ROLE_IMPACT]
affects_role: architect
affects_variant: any
prior_decision: "Two distinct user surfaces: field worker on mobile, admin/dispatcher on desktop"
new_decision: "Both surfaces are a single entity with admin vs. crew access restrictions — one app, one codebase, role-gated views"
propagation: Architect must design a single-app routing and auth model where role determines the view rendered, not separate apps or subdomains; role-based access control must be first-class in the data and session layer
rationale: A single-entity app with role gates is architecturally different from two separate apps — auth, routing, and state management all change.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: ui_ux
affects_variant: any
prior_decision: "Two distinct user surfaces: field worker on mobile, admin/dispatcher on desktop"
new_decision: "Single app, role-gated views — crew vs. admin access restrictions determine which UI the user sees after login"
propagation: UI/UX must design a single shared component library with two distinct role-based layouts (touch-first crew view, data-dense admin view) that share a login entry point; no separate app shells
rationale: A single-entity architecture means the design system must serve both personas from one shell — component contracts and breakpoints must account for this explicitly.
[/CROSS_ROLE_IMPACT]

**Q1.** Since it's one app with two role views, what do you want to call it — is there a working name in the repo, or do you want to establish one here?

- _Type:_ free text
- _Answer:_ Working name: **FieldSync**. One app, two lenses — crew members see their job queue and site tools, office managers see the full scheduling and dispatch hub. The name reflects the core value (keeping field and office in sync) without implying separate products. Use 'FieldSync' in the repo, the PWA manifest display name, and all internal references going forward.  current name is referred to as "Crew App"  but I am not particularly attached to it.
- _Hint:_ e.g. 'MoveDesk' or 'CrewOps' — the name that goes on the home-screen icon and the browser tab

**Q2.** The repo is set up as PWA but you're open to native if limits bite — which specific PWA limitation would make you pull the trigger on native: iOS push notification gaps, offline sync reliability, or home-screen install friction on personal devices?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] iOS push notification gaps
    - [ ] Offline sync reliability on iOS Safari
    - [ ] Home-screen install friction on personal devices
    - [x] Any of these — whichever surfaces first in testing

**Q3.** The app has crew and admin role views — is there a third role at launch, such as a dispatcher, a warehouse supervisor, or a driver-only view, or is crew vs. admin the complete set for September 1?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [x] Crew and admin only — two roles at launch
    - [ ] Three roles — crew, admin, and one more (name it below)
    - [ ] Unsure — needs scoping

**Q4.** Since installers add the PWA to their home screen once and don't visit an app store, how do you plan to push app updates to them — silent background reload, a banner prompting refresh, or a forced reload on next open?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Silent background reload — user notices nothing
    - [ ] Banner prompting refresh — user chooses when
    - [ ] Forced reload on next open — guaranteed version consistency
    - [ ] No strong preference — defer to developer
- _In their words:_ see repo

_— answered by Product Manager  `2026-07-24T19:44:04.767375+00:00`_

### Aspect: Business Model

#### AI · Business Model  `2026-07-24T19:44:30.497513+00:00`

FieldSync is a clean, purposeful name that earns its keep — "keeping field and office in sync" is exactly the kind of product logic that should live in the name. That closes the Product Form Factor aspect with the single-entity, role-gated PWA architecture confirmed, two roles at launch, and the native-vs-PWA decision deferred to first testing friction.

Now opening **Business Model** — and this one is genuinely different from the rest of the dialogue, because FieldSync is an internal operational tool, not a product sold to external customers. That means the standard revenue-model targets (per-seat SaaS, freemium, app-store pricing) don't apply in the conventional sense. But the business model questions still matter: someone is paying for this build, there is a cost the project must justify, and there is a number below which you stop or pivot. You named ~$23,400/year in manual transfer labor and $2K/quarter in misfit software spend as the baseline — those are the workaround costs this app is competing against. The five questions below are the full set I need to close this aspect.

**Q1.** Since FieldSync is an internal tool with no external customer paying a subscription, how would you characterize its revenue model — is it a cost-elimination investment (justified by labor and software savings), a capability-building investment (justified by the growth from $1.6M to $10M), or a hybrid of both?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Cost-elimination — justified by replacing ~$23K/yr labor + $8K/yr software
    - [ ] Capability-building — justified by unlocking the $10M growth path
    - [x] Hybrid — both savings and growth unlock are the return
    - [ ] Neither fits — let me reframe

**Q2.** What is the total budget approved for this build — is there a dollar figure or a time-and-materials cap that defines how much you're willing to spend before September 1?

- _Type:_ free text
- _Answer:_ no hard cap, current spend is less than $100 in software and 10k in labor cost.
- _Hint:_ e.g. '$40K total build budget, time-and-materials with a single contractor' or 'no hard cap but I'd pause if projected spend exceeded $60K'

**Q3.** After September 1, who owns the ongoing cost of running FieldSync — is it budgeted as an operational expense (like the $2K/quarter software it replaces), and is there a monthly figure you expect it to come in under?

- _Type:_ free text
- _Answer:_ I do, no hard budget
- _Hint:_ e.g. 'Replaces the $667/month Smartmoving + Sheets + Asana stack — needs to cost less than that to run, including hosting and any maintenance contract'

**Q4.** At what point would you stop the project or declare it a failure — is there a specific business outcome (hours saved, billing dispute rate, KPI visibility) below which you'd pull the plug or revert to the old stack?

- _Type:_ free text
- _Answer:_ We'd declare failure if, after 90 days of full adoption, FieldSync recovers less than 50% of the baseline $23,400 annual labor cost (i.e., fewer than \~$11,700/year in measurable time savings) AND the billing dispute rate has not dropped by at least 20% from the pre-launch baseline. Either metric alone improving meaningfully keeps the project alive; both missing the threshold triggers a structured review with a 30-day window to identify a fixable root cause before we revert to the old stack.  Side note: we don't currently track some of these metrics, so being able to see them would be considered a win either way.
- _Hint:_ e.g. 'If manual transfer hours are still above 15/week at 90 days post-launch, or billing disputes haven't dropped by at least 50%, we revisit whether the custom build was worth it'

**Q5.** You mentioned the possibility of opening FieldSync to other companies after the storage merger stabilizes — if that happens, what revenue model would you use: license it per seat, charge a flat monthly fee per company, or something else?

- _Type:_ free text
- _Answer:_ If we open FieldSync to external companies, a per-seat license model makes the most sense — something like $8–12 per active user per month, billed annually. This scales naturally with company size, mirrors the value delivered per field worker or office coordinator, and is easy for customers to justify against their own manual-transfer labor costs, which we know from our own baseline run around $23K/year. A flat monthly fee per company would undercharge large operations and overcharge small ones, so per-seat keeps pricing fair and revenue proportional to usage. I most likely would like to heavily discount it for smaller/local companies, and charge more for larger national companies
- _Hint:_ e.g. 'Per-seat monthly fee, similar to what Smartmoving charges but cheaper — or a flat workspace fee for companies under 100 employees'

_— answered by Product Manager  `2026-07-24T19:52:26.146203+00:00`_

#### AI · Business Model  `2026-07-24T19:52:58.900593+00:00`

The kill criteria you defined is one of the sharpest I've seen — dual-threshold logic (both metrics must miss before you pull the plug, either improving keeps it alive) with a 30-day structured review window before reversion is exactly the kind of nuanced, defensible standard a PM should set. Combined with the earlier baseline of ~$23,400/year in manual transfer labor and $8K/year in misfit software spend, the ROI story for FieldSync is already quantified: at $10K in current build labor and under $100 in software, the payback horizon is well under a year even at the 50% savings threshold. Two things still need locking before this aspect closes: (1) the **willingness-to-pay baseline** for the future external model — you named $8–12/seat/month with tiered discounting for small vs. national companies, but the workaround cost comparison needs one more data point to hold up against scrutiny; and (2) the **monetization timeline** — specifically, at what point after the storage merger stabilizes would you formally evaluate whether to open FieldSync externally, and what that first external commitment would look like.

**Q1.** You pegged future external pricing at $8–12/seat/month partly because you know similar companies carry ~$23K/year in manual labor costs. What are those companies paying today for their closest workaround — Smartmoving's crew app or a comparable tool — that a prospect would compare your price against?

- _Type:_ free text
- _Answer:_ License per seat for smartmoving is roughly $5/seat, but you have to buy their CRM software to use it, which runs about $300/month
- _Hint:_ e.g. 'Smartmoving charges ~$200–400/month flat regardless of crew size — at 30 seats that's $7–13/seat, so $8–12 is competitive and we'd win on UX and fit'

**Q2.** You said you'd discount heavily for small/local companies and charge more for large national ones — what's the rough size boundary you have in mind, and does 'more for national' mean a higher per-seat rate or a platform fee on top?

- _Type:_ free text
- _Answer:_ under 25 seats = billed at cost +10% markup, 100-300 seats = 30% markup + platform fee, 300+ seats = 50% markup + hefty platform fee
- _Hint:_ e.g. 'Under 25 seats = $8/seat; 25–100 seats = $10/seat; 100+ or national = $12/seat plus a $200/month platform fee'

**Q3.** You linked external monetization to the storage merger stabilizing — what specific milestone (merger legally closed, partner structure locked, FieldSync running cleanly for X months) would trigger a formal go/no-go on opening it externally?

- _Type:_ free text
- _Answer:_ fieldsync runs smoothly for 12 months, merger resolved and partner structure locked for at least 6 months.
- _Hint:_ e.g. 'Merger signed + FieldSync at 90-day post-launch with kill criteria both green + storage ops onboarded — probably Q2 2027 at the earliest'

**Q4.** If FieldSync does go external, what does the first paying customer relationship look like — a discounted pilot, a full contract from day one, or a free trial before billing starts?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Paid pilot at discounted rate — proves value before full price
    - [ ] Full contract from day one — no free tier externally
    - [x] Free trial period (e.g. 60–90 days), then billed
    - [ ] Too early to decide — defer until external launch is confirmed

_— answered by Product Manager  `2026-07-24T19:57:08.350061+00:00`_

#### AI · Business Model  `2026-07-24T19:57:29.734133+00:00`

The Smartmoving pricing breakdown is the exact comparator needed — $5/seat plus a mandatory $300/month CRM bundle means a 30-seat operation pays ~$450/month ($15/seat effective), which makes your $8–12/seat standalone pricing genuinely competitive even before the UX advantage. With that comparator locked, the tiered markup structure (cost+10% under 25 seats through cost+50% plus platform fee at 300+), the external go-live trigger (12 months smooth + merger resolved for 6 months), and the 60–90 day free trial shape for first external customers, the future monetization picture is now substantially complete. The one remaining gap the auditor flagged is the **monetization timeline for the internal phase** — specifically, since there's no subscription turning on at GA, what does "first paid commitment" mean for FieldSync v1, and whether there's a cost ceiling that would trigger a stop decision independent of the dual-threshold kill criteria you defined (50% labor savings AND 20% billing dispute reduction at 90 days).

**Q1.** For the internal phase, is there a meaningful 'paid mode turns on' moment — e.g. a contractor invoice, a hosting bill, a maintenance contract — or is the project effectively free-to-run until external monetization kicks in?

- _Type:_ free text
- _Answer:_ internal use product is not monetized
- _Hint:_ e.g. 'Contractor is paid T&M through September; after launch the only recurring cost is hosting — no internal billing event, just OpEx replacing the $2K/quarter software stack'

**Q2.** You set a business-outcome kill threshold (50% labor savings + 20% dispute reduction at 90 days) — is there also a **cost** threshold: a total build spend or monthly run cost that, if exceeded, would trigger a stop or pivot independent of the outcome metrics?

- _Type:_ free text
- _Answer:_ no
- _Hint:_ e.g. 'If total build cost exceeds $50K before September, I pause and re-scope. If monthly run cost exceeds $700/month post-launch, I evaluate switching to an off-the-shelf tool.'

**Q3.** Your tier structure jumps from under-25 to 100–300 — what's the markup for the 25–99 seat band, and is that gap intentional (e.g. targeting a specific company size) or an oversight to fill in?

- _Type:_ free text
- _Answer:_ cost +15%
- _Hint:_ e.g. '25–99 seats = cost+20% — mid-market moving companies with 1–2 crews; intentional sweet spot'

_— answered by Product Manager  `2026-07-24T20:02:53.272180+00:00`_

### Aspect: Timeframe and Roadmap

#### AI · Timeframe and Roadmap  `2026-07-24T20:03:19.644358+00:00`

The business model is now cleanly settled — internal use is not monetized, no cost kill-switch beyond the outcome metrics, and the full external pricing tier (cost+10% / +15% / +30%+platform / +50%+platform) is on the record. Now opening **Timeframe and Roadmap**, the final PM aspect, and the prior context gives me two anchors to build from: you named a **hard September 1, 2026 launch date** in the very first round, and you've since added a storage company merger expected to close around September with the definitive buyout agreement as the trigger. What's entirely open is everything between now and September 1 — whether there's an alpha phase, what a beta looks like with internal users, what "done" means at GA, and critically, what slips first if the team falls behind. For an internal tool with 50 field installers and 8 office staff as the full user base, the alpha/beta structure is different from a public launch, but no less important — it's how you de-risk the September date before it's too late to adjust.

**Q1.** Is there a planned alpha milestone before September 1 — a private build you'd put in front of even 2–3 installers or office staff to prove the core works? If yes, when, and what must it demonstrate to count as a pass?

- _Type:_ free text
- _Answer:_ Yes — we're targeting an alpha build by August 8, 2026, put in front of 2–3 installers and 1 office staff member. To count as a pass it must: (1) successfully generate a job cost estimate end-to-end using real project inputs, (2) allow an office user to review and approve that estimate without a developer present, and (3) complete both flows without a blocking error or manual data-fix. If those three gates aren't met by August 8, we have three weeks to patch before the September 1 GA date becomes at risk.
- _Hint:_ e.g. 'Alpha by June 1 — job briefing, timestamp/geotag, and offline sync working on one real job; if data survives a connectivity drop, we proceed'

**Q2.** Is there a beta phase — a limited rollout to a subset of your crew before full launch — and what is the success bar it must clear before you open it to all 50 installers?

- _Type:_ free text
- _Answer:_ Yes — we plan a 2-week beta starting August 16, 2026 with 8 installers (roughly one per crew lead) plus all 8 office staff. The beta clears the bar and unlocks full rollout when three conditions are met: zero critical job-costing errors (i.e., no mismatched labor or material line items that would cause an incorrect invoice), 80% of beta installers completing their daily field entries without supervisor intervention, and average ticket-close time in the office dropping by at least 15% versus our current baseline. If those three gates are green by August 18, we roll to all 50 installers on August 25 — giving us a one-week buffer before the September 1 hard date.
- _Hint:_ e.g. 'Beta with 5 installers + 1 office staff in July — 85% of jobs showing a fully closed digital record at end of shift, zero data loss incidents over 2 weeks'

**Q3.** Besides the September 1 date itself, are there any external commitments tied to it — a contract with the storage company, a crew-facing promise, a regulator deadline, or a funder milestone — that make it immovable?

- _Type:_ free text
- _Answer:_ storage merger necessitates a unified system, exact date tbd
- _Hint:_ e.g. 'Storage merger definitive agreement expected September — new partner will expect a working tool on day one of combined operations'

**Q4.** If the team is two weeks behind in August, what slips first: a feature gets cut, polish gets dropped, or the September 1 date moves?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] A feature gets cut — date is sacred
    - [ ] Polish gets dropped — core features ship rough
    - [ ] The date moves — better late than broken
    - [x] Depends on which feature — some are cuttable, some aren't

**Q5.** The MVP list includes six features, with FMCSA compliance and offline-first sync both marked launch-blocking. If only four of the six could ship by September 1, which two are the first to defer to a v1.1?

- _Type:_ free text
- _Answer:_ KPI dash and billing
- _Hint:_ e.g. 'KPI dashboard and billing export could slip to v1.1 — scheduling and FMCSA compliance are the non-negotiables'

_— answered by Product Manager  `2026-07-24T20:06:49.716453+00:00`_

#### AI · Timeframe and Roadmap  `2026-07-24T20:07:28.174625+00:00`

The alpha/beta structure you laid out — August 8 alpha with three concrete pass gates, a 2-week beta starting August 16, and a deliberate rollout to all 50 by August 25 — is one of the tightest internal launch plans I've seen, and the buffer logic is sound. Two prior facts sharpen the gaps still open here: you named **KPI dashboard and billing export** as the first two to defer to v1.1 if the team is behind (from the prior round), and the "depends on which feature" answer to the slip question tells me you have a mental hierarchy of cuttable vs. non-cuttable — I just need you to name it explicitly so the team isn't making that call under pressure in August.

[CROSS_ROLE_IMPACT]
affects_role: devops
affects_variant: any
prior_decision: \"Hard September 1, 2026 GA date\"
new_decision: \"Alpha: August 8, 2026 (3 users). Beta: August 16–18 pass gate, August 25 full rollout to 50 users. GA: September 1.\"
propagation: DevOps must plan deployment pipeline, environment provisioning, and monitoring readiness to support three distinct release events (alpha, beta, GA) within a 24-day window in August; staging and production environments must be separable by August 1 at the latest
rationale: A three-phase rollout in 24 days requires infra to be ready well before August 8 — DevOps cannot treat this as a single deploy event.
[/CROSS_ROLE_IMPACT]

[CROSS_ROLE_IMPACT]
affects_role: developer
affects_variant: any
prior_decision: \"Six MVP features confirmed: job briefing, FMCSA compliance, billing data capture, crew scheduling, offline-first sync, KPI dashboard\"
new_decision: \"KPI dashboard and billing export are the first two features to defer to v1.1 if schedule pressure forces a cut\"
propagation: Developer must flag these two features as conditionally-scoped in the build plan — architecture should not block v1.1 addition of KPI dashboard and billing export, but they are not on the critical path for September 1
rationale: Formally marking them as deferrable prevents the team from over-engineering dependencies on them during construction.
[/CROSS_ROLE_IMPACT]

**Q1.** You said 'depends on which feature' when asked what slips first. Of the four non-deferrable features — job briefing, FMCSA compliance, crew scheduling, and offline-first sync — if one had to be cut or shipped rough, which one and why?

- _Type:_ free text
- _Answer:_ crew scheduling, we have back up systems that could pick up the slack.
- _Hint:_ e.g. 'Crew scheduling ships rough — the office can tolerate manual workarounds for 2 weeks post-launch; FMCSA compliance is non-negotiable because we'd be out of compliance on the first LD job'

**Q2.** If the August 8 alpha misses its three pass gates, which lever do you pull first: cut a feature to recover time, or move the September 1 date?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Cut a feature — September 1 is immovable
    - [x] Move the date — ship broken is worse than ship late
    - [ ] Cut polish first, then features, then date as last resort

**Q3.** The storage merger date is TBD but expected around September — if the merger closes before September 1, does that pull the GA date earlier, or does September 1 hold regardless?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] September 1 holds — merger timing doesn't change the launch date
    - [ ] Merger closing early could pull launch earlier if the build is ready
    - [x] Merger delay past September 1 would push GA to match it

**Q4.** KPI dashboard and billing export are deferred to v1.1 — is there a target date or trigger for v1.1, or is it 'after GA once we see how v1 lands'?

- _Type:_ free text
- _Answer:_ after GA to see how V1 goes
- _Hint:_ e.g. '60 days post-launch if manual transfer hours are still above 10/week — roughly November 1, 2026' or 'no date yet, depends on post-launch feedback'

_— answered by Product Manager  `2026-07-24T20:09:52.371276+00:00`_

#### Product Manager  `2026-07-24T20:15:31.768103+00:00`
_(course_correction)_

the crew does not use WhatsApp, usually just SMS.

post launch monetization is a maybe, not a concrete plan

### Aspect: The friction this app removes

#### AI · The friction this app removes  `2026-07-24T20:44:09.137181+00:00`

We're here to get specific about the daily frustrations FieldSync removes — not from a business perspective, but from the lived experience of the people actually doing the work on the ground and at the desk.

**Building on what's already established:**
- The installer's core friction is already named in sharp terms: "prior system was taking notes on the 'notes' app on their phone," and the biggest fear is that "under time pressure or poor connectivity, installers will revert to snapping phone photos and texting the office" — creating the exact parallel data trail the app is meant to eliminate.
- The Office Manager's pain is "administrative workload bloat" across Google Sheets, Google Calendar, Smartmoving, and Asana — costing ~20+ hrs/week of manual data transfer at $22.50/hr (~$23,400/year in confirmed admin labor).
- Nine distinct job types exist (white glove, hot tub move, designer installs, long distance, etc.), with long-distance jobs carrying the heaviest admin burden: manual FMCSA compliance docs, fixed LD fee recording, and paper BOLs that frequently go missing.
- The 30-day adoption signal the PM named: an installer voluntarily pulling up prior DQ docs on-site — unprompted — to answer a customer question is proof the app is a trusted reference, not just a data-entry burden.

**What I still need to learn for The friction this app removes:**
I need to understand the friction in the installer's and Office Manager's own words — where exactly in a real shift it bites, what it costs them personally, what workarounds they've already tried and where those break down, and what a "good day" would feel like if the friction were gone.

**Q1.** Walk me through the specific moment in a real job — not a hypothetical — when an installer's current way of capturing job data actually fails them. What are they doing, what goes wrong, and what do they do next?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Installer finishes a white glove job, snaps 12 phone photos, texts them to the group chat, and by the time the office needs them 2 days later they're buried in a thread with 200 messages and half are the wrong job'

**Q2.** How often does that breakdown happen — is it every single job, a few times a week, or only on specific job types like long-distance or designer installs?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Every job, every shift
    - [ ] Most jobs — a few exceptions
    - [ ] Only on certain job types (e.g. LD, designer installs)
    - [ ] Unpredictable — depends on the crew or site
- _Answer:_ _(not answered)_

**Q3.** Beyond the data getting lost, what does the installer personally feel when this happens — are they getting calls from the office mid-job, blamed for missing info, or doing extra work after hours to reconstruct what happened?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Lead installer gets a call from the office while still on-site asking for a photo they already sent — they feel like their time isn't respected and the office doesn't trust them'

**Q4.** For the Office Manager, what is the single most maddening step in her day right now — the one she'd describe to a new hire as 'the thing I hate most about this job'?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Re-entering the same job details into Smartmoving, then Google Sheets, then QuickBooks — by the third time she's catching her own typos and she knows at least one invoice will have an error she won't find until a client calls'

**Q5.** What workaround has the team already tried to fix the phone-notes and paper-manifest chaos — and where exactly did that workaround break down?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Tried a shared Google Sheet for job notes — broke down when two crews edited the same row offline and one overwrote the other; gave up after a billing dispute traced back to a deleted row'

**Q6.** If FieldSync works perfectly on day one, what would an installer say to a teammate at the end of their first shift — what's the one thing they'd tell them is finally different?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'I finished the job, hit submit, and I know the office has everything — I didn't have to text anyone or remember to send anything after I left the site'

### Aspect: The end user's daily reality

#### Customer Advocate  `2026-07-24T20:47:36.444321+00:00`
_(course_correction)_

I am an administrative user. Give me more specific instructions on where I can get more information on this project. Assume that I have no information about PM scopes submitted.

#### AI · The end user's daily reality  `2026-07-24T20:48:52.533247+00:00`

Welcome — and noted that you're coming in as an administrative user without visibility into the PM scopes already submitted. Here's the orientation: FieldSync is an internal logistics field app built for a high-end furniture moving and installation company. It serves two named daily users — **field installers** (roughly 50 people on personal phones, capturing job data mid-shift) and an **Office Manager** (8 office staff, running the app as their all-day scheduling and admin hub). The hard launch date is **September 1, 2026**, with an alpha gate on August 8 and a beta rollout starting August 16. The core problem: installers currently capture job data in their phone's notes app and via SMS, while the Office Manager manually re-enters the same data across Google Sheets, Smartmoving, and Google Calendar — a cycle that costs ~$23,400/year in confirmed admin labor alone.

**Where to find more information on this project:** The PM has referenced a **repo with supporting documentation** (including a comprehensive tool performance and gap analysis across all current software) that contains specs, current app structure, and additional context. Ask the PM (Jacob Crooks) for access to that repo — it is the single best source of ground truth for what has already been decided and built. Everything captured in the PM dialogue above is the running record of decisions; this Customer Advocate leg builds on top of it.

**Leg plan:**
- *Settled:* **The customer's daily reality** — both named users are established (field installer + Office Manager), their work environments are on the record (personal phones in the field, browser-based desktop open all day), and the triggers for reaching for the app are clear (job start/stop for installers, continuous scheduling and admin work for the Office Manager). No re-interview needed here; I'll confirm carry-forward in one question.
- *Focus:* **The friction this app removes** — the PM named the friction at a business level (paper notes, SMS chaos, $23K/year in manual transfer), but the Customer leg needs it in the installer's and Office Manager's own words: the specific moment it bites, what it costs them personally, what workarounds they've already tried. This is the most pivotal gap because it shapes whether the app's UX actually targets the right moment.
- *Focus:* **What the customer does today without this app** — the step-by-step daily workflow (tools in order, where they stall, what they'd have to stop doing to switch) is still largely uncharted from the customer's seat. Without this, the switching cost is unknown and adoption risk is unquantified.
- *Focus:* **What 'this works' looks like to the customer** — the PM gave one sharp 30-day signal (installer voluntarily pulls up prior DQ docs on-site unprompted), but the full picture — what the installer tells a teammate, what the Office Manager stops doing, what failure would permanently lose their trust — needs to be filled in from lived experience.
- *Lower priority:* **Value exchange / willingness to pay** — since FieldSync is an internal tool with no external price, this area collapses to: what behavior change will the installer and Office Manager tolerate to adopt, what would make them abandon it in the first week, and who is the internal champion whose endorsement unlocks wider crew adoption. Manageable in one focused round.

**Q1.** **The customer's daily reality** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] The field installer is the primary mobile user — a hands-on crew member doing furniture delivery and installation on personal phones throughout their shift.
    - [x] The Office Manager is the primary desktop user — running scheduling, dispatch, and admin tasks with FieldSync open continuously as their main hub.
    - [ ] Installers reach for the app at discrete job moments: job start, each stop, and job completion — not continuously throughout the day.
    - [x] The Office Manager's work is team-facing and internal — she coordinates between field crews, billing, and management, not directly with end customers.
    - [ ] Adjacent users in the installer's orbit include other crew members and a crew lead who may share or hand off job data on the same shift.
    - [ ] Accept all in this group — no changes

**Q2.** **The friction this app removes** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [x] The installer's core friction is capturing job data mid-shift without a structured tool — currently phone notes and SMS, which create a parallel data trail the office cannot use.
    - [ ] The Office Manager's core friction is manually re-entering the same job data across multiple systems — confirmed at ~20+ hrs/week of transfer labor.
    - [ ] Long-distance jobs carry the heaviest per-job admin burden: paper BOLs, FMCSA compliance docs, and fixed LD fee recording that must be done manually today.
    - [ ] The installer hits this friction on most jobs, not just edge cases — the PM confirmed it as a systemic, daily pattern across job types.
    - [ ] Accept all in this group — no changes

**Q3.** **Value exchange and adoption** — check anything you want to override or discuss; anything you leave unchecked is accepted and recorded as an assumption.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Since FieldSync is an internal tool with no per-seat price, 'willingness to pay' translates to: what behavior change will each user tolerate to adopt it.
    - [ ] The company owner (Jacob Crooks) is the internal champion whose endorsement is the primary adoption unlock for both crew and office staff.
    - [ ] The installer cannot adopt unilaterally — the Office Manager must also change her workflow for the data exchange to work; adoption is interdependent.
    - [x] Accept all in this group — no changes

**Q4.** These areas look irrelevant for this project and I plan to mark them skipped — check any you want to keep in the interview.

- _Type:_ multiple choice
- _Options_ (☑ selected):
    - [ ] Value exchange — is this worth it on both sides
- _Answer:_ _(not answered)_

**Q5.** Think of a specific installer — ideally the most experienced crew lead or the one most resistant to change. When they finish a job today, walk me through exactly what they do in the 10 minutes after the work is done: what do they write down, what do they text or call in, and what do they leave for the office to figure out later?

- _Type:_ free text
- _Answer:_ After the job is done, the crew lead would finish the report for the job or make sure that one of the other crew members finishes it and asks if anyone needs any assistance in anything. Goes and talks to the office administrators to talk about the job and etc and check in on other items that they want to discuss with the administrators if able. They would also fill out the DVIR and any tier mover experience checklist.
- _Hint:_ e.g. 'Lead installer snaps 8 photos on his personal phone, texts them to the office group chat, jots the time on a paper slip, and leaves the BOL with the client — the office doesn't see any of it until the next morning when someone asks him to resend the photos'

**Q6.** For the Office Manager: what is the single step in her day she would describe as 'the thing I hate most' — the task that eats her time, requires the most double-checking, or most often produces an error she has to fix later?

- _Type:_ free text
- _Answer:_ Making sure that the payroll numbers are correct, everyone got paid the right amount of hours, and making sure that the hours that the crew submits on the crew app is correct and what they actually worked and what we will bill the clients. If there are any discrepancies, then having to track down the crew and ask about the work flow timeline and what happened during the job.
- _Hint:_ e.g. 'Re-entering job duration and materials into QuickBooks after pulling them out of a text thread — she knows at least one number will be wrong and she won't find it until a client disputes the invoice'

**Q7.** What is the single failure that would make an installer give up on FieldSync and go back to SMS and phone notes — the moment in their shift where the app would have to let them down badly enough that they stop trusting it?

- _Type:_ free text
- _Answer:_ Maybe if the crew app bugs out and stops working for them. Or if it starts to become to slow to update their movements at that current time so they don't know if it was tracked or not.
- _Hint:_ e.g. 'The app loses a job entry when the site has no signal — they filed everything, drove away, and the office never received it; after that happens once, they'll keep a paper backup forever'

**Q8.** When the Office Manager pictures a 'good day' after FieldSync launches — a day where it actually works as promised — what is the one thing she does NOT have to do that she does today? Be as specific as possible about the task and the time it takes.

- _Type:_ free text
- _Answer:_ Not having to check employees availability and check the calendar to make sure that they actually are scheduled or not for a certain day. Long distance moves don't have them marked out of when they are gone. Doesn't take to much time, just sometimes tedious if there are multiple people I am looking into. Additionally, when the app logs receipts correctly and I don't have to try and hunt them down and figure out if they got in-puted or not for our books.
- _Hint:_ e.g. 'She doesn't have to chase down the crew lead for job photos before closing an invoice — the record is already there when she opens the job, and she can send the invoice the same afternoon'

_— answered by Customer Advocate  `2026-07-24T21:09:41.591209+00:00`_

#### AI · The end user's daily reality  `2026-07-24T21:10:14.549358+00:00`

The payroll hours-versus-hours-billed reconciliation pain is exactly the kind of friction that sounds small until you're chasing a crew lead by phone on a Friday afternoon — and the receipt-tracking gap is the same problem from another angle: data that exists somewhere but can't be found when it's needed. Tying these to what's already on record: the PM confirmed ~20+ hrs/week in manual transfer labor at $22.50/hr, and the 30-day adoption signal was an installer voluntarily pulling up prior DQ docs on-site unprompted. What hailey just described adds a critical new layer — the Office Manager's worst daily moment isn't re-entry per se, it's **trust** (are the hours the crew submitted actually what happened?) and **hunting** (where are those receipts?). Two assumptions flagged in the open targets also need resolving: whether the Office Manager is truly internal-facing only, and whether she's the continuous-hub user the PM described. Hailey checked those as items to discuss, so I need to clarify both.

**Q1.** You flagged for discussion whether the Office Manager is purely internal-facing. Does she interact directly with clients at all — fielding calls, sending invoices, handling complaints — or is she fully behind the scenes coordinating crew and billing only?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Directly client-facing — calls, invoices, disputes
    - [ ] Occasionally client-facing — only when something goes wrong
    - [ ] Fully internal — crew, billing, management only
    - [ ] Varies by person on the office team
- _In their words:_ occasionally client facing; most commonly for job confirmations, billing disputes, and payment due reminders

**Q2.** You also flagged the 'FieldSync open continuously as her main hub' assumption for discussion. In reality, is FieldSync her primary screen all day, or is it one of several tools she switches between constantly?

- _Type:_ free text
- _Answer:_ it is main source of data, however, she switches between it and various google sheets, quickbooks, and the job google calendar
- _Hint:_ e.g. 'She's jumping between Smartmoving, Google Calendar, and the crew app all day — none of them is the hub, they're all equally in the way'

**Q3.** On the payroll hours pain: when a crew member's submitted hours don't match what the Office Manager expects, how does she figure out what actually happened — and how long does that typically take per discrepancy?

- _Type:_ free text
- _Answer:_ she sents a text via google voice to clarify with the crew, or corrects it within the app if the appropriate correction is obvious.
- _Hint:_ e.g. 'She texts the crew lead, waits for a reply, cross-references the job notes — easily 20–30 min per dispute, and there are 3–4 per week'

**Q4.** On receipts: when a receipt isn't logged in the app, where is it actually hiding — still on the installer's phone, in a group chat, or just gone — and what does the Office Manager have to do to retrieve it?

- _Type:_ free text
- _Answer:_ photo is lost due to server disconnect bug, or receipt is put in the truck or on physical desk (not ideal; not what we ask our crews to do).
- _Hint:_ e.g. 'Usually a photo buried in the crew SMS thread — she has to scroll back through days of messages to find it, then re-enter it manually into QuickBooks'

**Q5.** The crew lead's post-job routine you described — finishing the report, talking to office admins in person, filling out the DVIR — how often can they actually do the in-person check-in with the office, versus days when they're back-to-back on jobs with no time to stop in?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Most days — they're usually back at the office end of shift
    - [x] Sometimes — depends on how many jobs they have
    - [ ] Rarely — most shifts they go straight home after the last job
    - [ ] Varies by crew lead

**Q6.** You mentioned that long-distance moves don't show crew members as unavailable in the calendar, which forces a manual availability check. How does the Office Manager currently know who is on an LD job — is there any system, or is it purely memory and asking around?

- _Type:_ free text
- _Answer:_ google invitees to a multi-day calendar event
- _Hint:_ e.g. 'She just knows from the original booking — if she didn't schedule it herself, she has to ask someone or dig through Smartmoving to find the job'

_— answered by Customer Advocate  `2026-07-29T16:54:06.481706+00:00`_

### Aspect: The friction this app removes

#### AI · The friction this app removes  `2026-07-29T16:54:58.196143+00:00`

The picture of the Office Manager's day just got sharper and more honest — she's client-facing more than assumed (billing disputes, payment reminders), receipts are genuinely disappearing due to a server disconnect bug in the current app, and the calendar visibility gap for LD crews is a real scheduling blind spot. Tying this to what the PM confirmed: ~20+ hrs/week in manual transfer labor at $22.50/hr, and the open target flagged from orientation is the one assumption that was challenged — the installer's core friction being **phone notes and SMS creating a parallel data trail the office can't use**. Jacob's answers just added a new dimension: the parallel trail isn't just a habit problem, it's partly a **reliability problem** (the current app loses receipts on disconnect), which means installers may already be doing the right thing and still getting burned. That changes the friction story meaningfully — it's not just "installers default to SMS," it's "installers don't trust the app to hold their data." I want to test that and fill in the remaining gaps: the specific moment friction hits the installer mid-job, what it personally costs them, and whether the receipt loss and the hours dispute are the same root problem (unreliable sync) or two separate ones.

**Q1.** You mentioned receipts going missing due to a server disconnect bug in the current app. When that happens to an installer, do they know in the moment that it failed — or do they only find out later when the office asks for it?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] They know immediately — the app shows an error
    - [ ] They don't know — it looks like it submitted fine
    - [ ] Inconsistent — sometimes they know, sometimes they don't
    - [ ] Varies by installer / device
- _Answer:_ _(not answered)_

**Q2.** When an installer's data goes missing — a receipt, a job photo, a time entry — what personally happens to them as a result? Do they get called back, docked hours, or blamed for something that wasn't their fault?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'Crew lead gets a Google Voice text mid-next-job asking them to reconstruct what happened — they feel like they're being accused of working fewer hours than they logged'

**Q3.** How often does the payroll hours reconciliation problem actually come up — is it a daily occurrence, a weekly headache, or occasional enough that it's annoying but not critical?

- _Type:_ single choice
- _Options_ (☑ selected):
    - [ ] Daily — multiple crew members most shifts
    - [ ] A few times per week
    - [ ] Once a week or less
    - [ ] Occasional — mainly around busy periods
- _Answer:_ _(not answered)_

**Q4.** If you had to put the installer's core daily frustration in one sentence — the thing they'd say out loud to a coworker — what would it be? Use their words, not product language.

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'I logged everything, I know I did, and somehow the office still doesn't have it — now I have to prove what I already told them'

**Q5.** Beyond the current app, has the team tried any other workaround to fix the data-capture chaos — a shared group chat, a paper form, a voice memo — and where exactly did that break down?

- _Type:_ free text
- _Answer:_ _(not answered)_
- _Hint:_ e.g. 'SMS group thread was the backup, but messages get buried and there's no way to tie a photo to a specific job record after the fact'
