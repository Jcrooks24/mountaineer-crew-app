SYSTEMS INTEGRATION ASSESSMENT

M1 Logistics + Mountaineer Moving Co.

Combined Tools, Workflows, and Integration Gaps — Preparing for the January 1 Transition

## Purpose

This document combines the systems and workflow profiles of M1 Logistics and Mountaineer Moving Co. into a single reference for planning the integration of the two businesses. It identifies where the companies already use the same or similar tools, where systems conflict or duplicate effort, where paid-for capabilities sit unused, and where neither company currently has a system at all. The goal is a defined future-state technology and process stack that the combined company can be running on by January 1.

This is a working document. Several figures (costs, contract terms, user counts) are marked as assumptions or flagged for follow-up where exact data was not yet available at the time of writing.

## Introduction

Mountaineer's original systems audit organized findings around the work itself rather than the tools, on the theory that organizing by tool hides redundancy and gaps. This document keeps that approach, and extends it to a second company. For each core function below, this document profiles what Mountaineer uses, what M1 uses, and what that means for the combined company.

Core functions covered:

- Generate demand and capture leads
- Manage the sales pipeline and convert leads
- Communicate with customers, crew, and partners
- Schedule and dispatch jobs
- Execute the job and capture field data
- Bill, collect, and track payments
- Handle damage claims
- Run payroll and manage HR
- Maintain the fleet
- Stay FMCSA and DOT compliant
- Manage materials and warehouse inventory
- Keep the books
- Measure performance and report
- Manage vendors, IT, and partners

## Combined Systems Overlap Matrix

A fast-reference view of where each company's primary tool sits per function, and whether that represents an overlap (both companies already on the same/similar tool), a conflict (different tools doing the same job, a decision is required), or a one-sided gap (only one company has a system for this job).

| Function | Mountaineer Tool | M1 Tool | Status |
|---|---|---|---|
| Sales / CRM | SmartMoving | None (Google Calendar + msWhse) | CONFLICT — no shared system of record |
| Lead Intake | Yelp, LSA, Gmail, phone | Jotform → Flowsana → Asana (role-assigned subtasks) → msWhse/QuickBooks/Calendar | DIFFERENT MODELS |
| Communications | Google Voice + Gmail | VoIP (3-ext) + Google Workspace email | PARTIAL OVERLAP — both on Google email |
| Scheduling / Dispatch | Google Calendar (heavily customized) | Google Calendar (shared) | OVERLAP — same platform |
| Accounting | QuickBooks (Online or Desktop — confirm) | QuickBooks Online | OVERLAP — same platform, strongest consolidation candidate |
| Payroll | QuickBooks Payroll | Gusto | CONFLICT — decision required |
| Task / Project Mgmt | None formal | Asana + Flowsana (runs the structured project subtask pipeline) | ONE-SIDED — extend to combined co. |
| Field Data / Crew App | Custom Mountaineer Crew App | N/A (no field crew) | ONE-SIDED — Mountaineer asset |
| Warehouse / Inventory | None formal | msWhse (paid, underconfigured) | ONE-SIDED — M1 asset |
| Claims | No standard process (gap) | Google Sheet tracker (informal but functional) | ONE-SIDED — M1 has a model to extend |
| Fleet / DOT Compliance | Crew App (DVIR, RODS, TRALA) | N/A (no fleet) | ONE-SIDED — Mountaineer only |
| Marketing | Global Spex (paid agency) + paid ads | In-house (owner-led), no paid SEM | DIFFERENT MODELS — strategic decision |
| Reporting / BI | Custom Apps Script dashboard (unreliable) | Native QuickBooks BI dashboards (unconfigured) | OVERLAP OPPORTUNITY — QBO native tools underused by both |
| IT / Security | Jacob (informal) | The Connect Group (phones, cameras, PC AV) | GAP — no combined cyber policy |

## Sales and CRM

### Mountaineer Moving

#### SmartMoving

Searchable system of record for customers and leads. Limited customization and integration library. The Dispatch, Customer Service, Marketing, Storage, Accounting, and Smart Insights modules are paid for but largely unused (see Notable Underutilization).

| Pros | Cons |
|---|---|
| Searchable, filterable customer and lead database. | Not very customizable. Limited integration library. Dispatch module adds a manual step with no offsetting benefit. |

#### Communications

Management Gmail (main lead landing pad, integrates with Apps Script tools), Google Voice (shared phone/text line with known reliability issues), Yelp and Yelp Ads (lead source, low/inconsistent quality), Google LSA (lead source, integrates into Voice/Gmail), and Jonas's legacy email (a second inbox working against consolidation).

### M1 Logistics

#### No Formal CRM

M1 has no CRM software. Work is booked directly onto a shared Google Calendar. Client information is also manually entered into msWhse (built primarily for inventory/warehouse purposes — see Warehouse section), creating a second, non-authoritative store of client data.

#### Lead Intake and Project Pipeline

Acquisition is largely direct: a call comes in, fit is confirmed, and the prospect is sent to the M1 website (m1-mt.com, built on WordPress) to complete a project request form (Jotform). Jotform data passes through a Flowsana integration directly into Asana, which creates a structured project with a standing set of role-assigned subtasks. This pipeline was originally designed and documented around ClickUp as the project-management layer; ClickUp has since been superseded by Asana plus the Flowsana integrator, though the underlying subtask structure and assignment logic carried over largely intact.

The standing subtask structure, per project, includes: a Setup Email subtask (assigned to Devnee — sends a templated thank-you/confirmation email, Sidemark instructions, and an msWhse training offer for new clients); an Inventory Verification subtask (Devnee, due 2 weeks before the project date — emails the msWhse inventory report to the client); a Pick subtask (Ian, due 7 business days before the project date — pulls inventory ahead of the job); and a Billing subtask (Devnee/Susan, due 2 days after project completion — requests the install invoice from Mountaineer if not already provided on subcontracted jobs). Due dates on all subtasks shift automatically if the project date changes. In parallel, a Google Calendar appointment is auto-created and assigned to the warehouse@m1.mt.com calendar (title, location, and date mapped from project fields), and the project and its contacts are set up in msWhse and QuickBooks.

#### Communications

VoIP phone system with 3 extensions and an auto-attendant. Company runs on a Google Workspace brand account, including a shared warehouse@m1.mt.com inbox and a shared billing@m1-mt.com inbox.

#### Asana

Asana is doing more real work than its earlier underutilized label suggested: in addition to general employee task tracking, it runs the structured, role-assigned, date-offset subtask pipeline described above for every incoming project, fanning out to msWhse, QuickBooks, and Google Calendar. Ownership's original characterization of Asana as underutilized likely refers to its broader feature set (reporting, goals, automation rules) rather than this core pipeline, which is functioning as designed.

### Reference Artifacts (M1-Provided)

Two internal process documents were provided that exceed the level of detail practical to recreate live in a single working session, and are referenced here rather than redrawn:

- “M1 Outbound Standard Process” (v05192023) — details the warehouse outbound/delivery workflow across four roles (M1 Back Office, Outbound Coordinator, Warehouse Manager, Designer), including the standard path and a less-than-5-business-days exception path. Relevant to the Storage & Moving Operations segment.
- “M1 Project Systems” (v11/25/24) — details the customer project intake pipeline described above. Originally documented against ClickUp; superseded by Asana + Flowsana, with the subtask structure, assignees, and due-date logic carried forward. Relevant to the Customer Acquisition & Sales segment.
Both should be treated as documentation-grade detail — useful as ground truth and as a check against whatever gets sketched live — rather than a template to be matched box-for-box in a 20-minute swimlane segment.

### Combined Considerations

- Neither company has a true CRM. Mountaineer pays for one (SmartMoving) but is dissatisfied with its customization and integration limits; M1 has none at all and relies on Calendar + msWhse + Asana in combination.
- This is the single largest strategic decision in the entire assessment: adopt SmartMoving company-wide, replace it with something else company-wide, or formalize a Calendar/Asana-based approach. Worth evaluating against the volume and complexity of the combined book of business.
- M1's intake pipeline (Jotform → Flowsana → Asana, fanning out to msWhse, QuickBooks, and Calendar, with role-assigned subtasks and automatic due-date shifting) is a more mature, working automated pipeline than Mountaineer's Gmail/SmartMoving-based intake. Worth examining as a model regardless of the eventual CRM decision.
- Client data currently lives in at least three uncoordinated places across the combined company (SmartMoving, msWhse, Calendar/Asana) — a data integrity risk before any migration begins.
- M1's outbound/warehouse workflow (per the Outbound Standard Process document) already spans four distinct roles with branching exception handling — a level of process maturity worth comparing directly against Mountaineer's dispatch/Crew App workflow in a dedicated follow-up session, rather than only at the high level captured in the kickoff meeting.

## Accounting

### Mountaineer Moving

QuickBooks is the core accounting platform — reliable, wide feature set, but with an unfriendly UI and underutilized integration capacity. A large block of paid features go unused (sales tax automation, products/services catalog, job costing, budgeting, apps marketplace). A separate Google Sheet tracks invoices, check numbers, and outstanding collections, and a Crew App feature handles receipt logging with photo upload to Drive. Billing data is currently split across three places (Crew App sheet, invoice sheet, QuickBooks) — consolidation is underway but not complete.

### M1 Logistics

QuickBooks Online handles accounting, AR, and AP directly. msWhse generates receiving and storage invoices, which are manually re-entered into QBO — roughly 60–90 invoices per month, plus ad hoc items such as debris disposal. Install and other invoices are entered directly into QBO. The billing@m1-mt.com inbox is not integrated with QBO; it is a manual relay. M1 does not collect deposits on its own jobs; on the rare (and expected to grow) subcontracted-to-Mountaineer install jobs, deposits are tracked on a separate Google/Excel doc.

### Combined Considerations

- Both companies are already on QuickBooks. This is the clearest, lowest-risk consolidation opportunity in the whole assessment — confirm whether Mountaineer is on QuickBooks Online or Desktop, since that materially changes migration effort.
- Both companies separately re-key billing data from a source system into QuickBooks by hand (Mountaineer: Crew App/spreadsheet; M1: msWhse). Both are independently underutilizing QuickBooks's own automation and integration features rather than building more spreadsheets — the fix in both cases is the same: connect the source system to QuickBooks rather than hand-entering.
- CRITICAL RISK: Susan (M1 co-owner) is the primary keeper of M1's QuickBooks knowledge and is departing at the merger. There is no documentation of her processes. A structured knowledge/data transfer from her should be a closing condition, not a post-close task.
- Mountaineer's deposit-tracking gap and M1's lack of a deposit process for its own jobs point to the same underlying need: a standardized deposit-to-invoice linkage in whatever accounting workflow the combined company lands on.

## Payroll and HR

### Mountaineer Moving

QuickBooks Payroll runs payroll and tax filing; some employees have had legitimate direct-deposit setup issues, forcing paper checks. A Google Sheet (with Apps Script) tracks hours, payroll inputs, and employee metadata, and is being phased out in favor of the Crew App, with the Sheet remaining as long-term backend storage. The Crew App itself handles reimbursement requests, an employee roster, a document library (TRALA, contracts, bills of lading), and scheduling availability.

### M1 Logistics

Gusto runs payroll, time tracking, and onboarding. M1 has no field staff (all field/warehouse labor questions are Mountaineer's side of the business). Onboarding pairs Gusto with a paper Word-doc job description and an employee handbook.

### Combined Considerations

- Direct conflict: Mountaineer is on QuickBooks Payroll, M1 is on Gusto. A single combined payroll system is a near-term requirement, not optional, once employees are on one entity. Decision should weigh Gusto's stronger time-tracking/onboarding fit for a hybrid office+field workforce against QuickBooks Payroll's tie-in with the now-shared accounting platform.
- Mountaineer's workforce is overwhelmingly field-based (drivers, movers, mechanics) and FMCSA-regulated; M1's three employees plus two partners are office/warehouse-based with no field compliance burden. Any combined HR system needs to support both populations without forcing one model onto the other.
- M1's handbook/job-description process (paper Word doc) is less formalized than Mountaineer's Crew App document library — an opportunity to extend Mountaineer's existing document infrastructure to M1 roles rather than build something new.

## Marketing

### Mountaineer Moving

Global Spex (paid agency) owns core marketing channels, creative, and execution — promising early ROI but high monthly cost, inconsistent quality requiring internal review, and vendor-held knowledge that makes switching costly. Supplemented by Google LSA, Google PPC, Yelp Ads, door knocking (low cost, ~10% historical conversion, hard to scale), and a Global Spex-built website.

### M1 Logistics

No paid SEM and no external marketing vendor. Demand comes from extensive internally-driven SEO/AI work, designer relationships, and word of mouth — ownership reports direct prior professional experience in this space.

### Combined Considerations

- This is close to a mirror-image situation: Mountaineer is vendor-dependent and paying a premium for marketing execution it does not fully control; M1 is self-sufficient with in-house expertise and no paid channel spend.
- Strategic question for the combined company: does M1's owner take over more marketing strategy/execution in-house (reducing or eliminating Global Spex spend), or does Global Spex get evaluated for a combined-company scope? Either direction is a real decision, not a default — Global Spex has shown real ROI, and in-house capacity is currently limited to one person's time.
- Door knocking is a Mountaineer-specific channel tied to its local, high-touch move business; it likely does not translate directly to M1's project/design-relationship-driven model and should be evaluated on its own merits rather than forced into a combined playbook.

## Fleet Maintenance and Warehouse / Inventory

### Mountaineer Moving — Fleet

Crew App DVIR handles required pre/post-trip inspections electronically; drivers' limited mechanical knowledge limits thoroughness, and rollout to existing drivers has been slow. A Google Sheet tracks preventive maintenance schedules, vehicle metadata (VINs, plates, dimensions), and rough maintenance costs by truck — useful but imprecise, due to limited detail in mechanic invoices.

M1 owns no trucks and operates no fleet; all fleet and DOT/FMCSA compliance is exclusively Mountaineer's domain.

### M1 Logistics — Warehouse / Inventory

msWhse (mswhse.com, paid subscription) is M1's system of record for inventory receiving, storage, billing, and delivery paperwork, and is also where client contact information is manually entered — including additional contacts who need automated notification about inventory transactions. msWhse includes a configurable dashboard (customers, transactions, billing, warehouse utilization, inventory trends) that has never been set up or used; M1 currently relies on QuickBooks for KPIs instead.

A custom-built Jotform app handles items received at the warehouse without a known client — it captures data fields and photos, and posts a public list so designers can identify items as their own; once a client is identified, the item is added into msWhse.

### Mountaineer — Materials Inventory (Gap)

Mountaineer's own materials inventory process is informal: periodic visual inspection, reordering at the inspector's judgment, rarely a real problem given ample storage.

### Combined Considerations

- M1's unidentified-item intake app (Jotform → public ID list → designer match → msWhse) is a genuinely distinctive, low-cost workflow. It pairs naturally with Mountaineer's Crew App photo/materials-logging feature — worth scoping whether the same intake pattern could run inside or alongside the Crew App for the combined company.
- msWhse's unused dashboard is the M1-side equivalent of Mountaineer's unused SmartMoving modules: a paid-for capability sitting dormant. Configuring it (planned ownership transition to Ian, M1's warehouse lead) is a low-effort, real-value quick win.
- Fleet and DOT compliance remain entirely Mountaineer's responsibility post-merger; this is not an area where M1 systems or process apply, but the combined entity's compliance exposure does not shrink and should be tracked at the company level, not the M1-legacy or Mountaineer-legacy level.

## Document Management, Estimating, and Claims

### Mountaineer Moving

The Crew App document library serves as the access point for employee-facing resources (TRALA, contracts, bills of lading). Mountaineer has no standard claims process: cases arrive via text, email, Crew App, and phone, are handled case by case, damage documentation is often incomplete, and it is unclear how claims are even categorized in QuickBooks. This is flagged internally as both a financial and liability exposure.

### M1 Logistics

Estimates are built manually in Excel, Numbers, and Google Sheets — there is no estimating software. Signed job-request agreements (from the m1-mt.com new-job-request form) are received as email attachments and a parallel copy in the Jotform database; there is no single document repository. M1 does have a working claims process: a Google Sheet tracking Date of Event, Client, Item #, Photos Available, Coverage, Responsibility, Ability to Repair, Claim Cost, Manager, Comments, and Status — informal, but structured and in active use.

### Combined Considerations

- Claims is the clearest case in this entire assessment of one company having a working model the other completely lacks. M1's claims sheet, even informal, already has the right fields. Extending and formalizing it (rather than building new) is the fastest path to closing Mountaineer's most-flagged gap.
- Neither company has true estimating software — both rely on manual spreadsheet work. This is a shared gap, not a conflict, and a candidate for a single combined-company solution rather than reconciling two systems.
- Document storage is fragmented on both sides: Mountaineer's Crew App library is employee-facing only (not client contracts), and M1's signed agreements live across email and a Jotform database with no central repository. A combined document management approach (e.g., a shared Drive structure or a proper DMS) would address both gaps at once.

## Data Collection, Reporting, and Business Intelligence

### Mountaineer Moving

Crew App Reporting captures clean, near-real-time job data with zero manual entry. The SmartMoving API supplies estimate data but is rate-limited on the current tier and does not cover jobs booked outside SmartMoving. QuickBooks Reports are the only source of accurate accounting data but are difficult to extract for long-term analysis. The custom Statistics Dashboard (Apps Script) is, by Mountaineer's own assessment, the single weakest internal system — buggy, slow, built on messy historic data, and not yet trusted.

### M1 Logistics

M1 relies on QuickBooks Online's native Business Intelligence dashboards (Profitability, Cash Flow, Balance Sheet, Accounts Receivable, Accounts Payable, Revenue, Sales Performance) for KPIs — these are out-of-the-box QBO dashboards, not a custom build. The Sales Performance dashboard has not yet been connected to a data source. msWhse's own dashboard, as noted above, is also unconfigured.

### Combined Considerations

- Mountaineer built a custom reporting tool (Apps Script dashboard) that has not earned trust; M1 is sitting on a native, vendor-supported reporting tool (QuickBooks BI) that is simply not turned on. Once accounting is consolidated onto one QuickBooks instance, extending QBO's native dashboards to the combined entity may outperform investing further in Mountaineer's custom dashboard — worth a direct comparison before committing further engineering time to the Apps Script project.
- The Crew App's clean, structured job-level data (Mountaineer) and QBO's clean, structured financial data (both companies) are the two strongest data assets in the combined company. A future reporting layer should be built on top of these two sources rather than recreating the all-purpose Apps Script approach.

## IT, Vendor Management, and Key-Person Dependencies

### Mountaineer Moving

Jacob is the sole developer and maintainer of the custom Mountaineer Crew App — every dispatch, scheduling, compliance, billing-input, and reimbursement workflow that runs through the app depends on him for fixes and changes. This is flagged repeatedly throughout Mountaineer's own audit as a single point of failure.

### M1 Logistics

The Connect Group manages M1's phone system, security cameras, and antivirus/security for the company's two PC machines (used by Devnee). All other hardware is Apple, managed directly by ownership, with AppleCare on some devices. A Microsoft 365 subscription is in use on some Mac laptops, of uncertain necessity given the company already runs on Google Workspace for email, calendar, and docs. The website is hosted on HostGator, and Google Business Profile accounts were purchased through HostGator as a reseller — an unusual structure worth confirming for actual account ownership and access control.

Recurring paid tools (msWhse, QuickBooks, Gusto, Asana, Flowsana, JotForm, VoIP, website hosting) are believed to be on annual contracts, but this is unconfirmed and flagged for follow-up before any cancellation or migration is scheduled.

### Combined Key-Person Risk Summary

| Person | Company | Systems Dependent on Them | Risk Level | Notes |
|---|---|---|---|---|
| Jacob | Mountaineer | Crew App (dispatch, DVIR/RODS, scheduling, billing inputs, reimbursements) | HIGH | Sole developer/maintainer; ongoing dependency, not a departure risk |
| Susan | M1 | QuickBooks Online (accounting, AR/AP) | HIGH — TIME-SENSITIVE | Departing at merger; no process documentation exists; data/knowledge transfer should be a closing condition |
| Devnee | M1 | QuickBooks data entry; the two Connect Group-managed PCs | MEDIUM | Primary day-to-day QBO operator |
| Ian | M1 | msWhse (planned transition) | LOW–MEDIUM | Ownership intends to hand off warehouse system management to Ian |

### Combined Considerations

- Two single-developer/single-owner dependencies sit at the center of each company's tech stack (Jacob for Mountaineer's Crew App, the owner personally for nearly all of M1's non-accounting systems). Neither is resolved by the merger on its own — if anything, combining the companies increases what each person is responsible for unless deliberately redistributed.
- No combined cybersecurity policy, cyber insurance, or formal data-security practice currently exists on either side. This becomes more material once combined: Mountaineer holds FMCSA-regulated driver data and payment information; M1 holds client/designer contact and inventory data. Worth a baseline review before January 1, even if lightweight.
- M365 (M1) is a likely redundancy candidate against Google Workspace, pending confirmation of what it is actually being used for on those laptops.

## Combined Gaps

| Gap | Mountaineer Status | M1 Status | Combined Assessment |
|---|---|---|---|
| Claims process | No standard process; flagged as a major financial/liability exposure | Informal but structured and functional Google Sheet tracker | Extend M1's model company-wide rather than building new |
| Deposit tracking | Actively painful; deposits collected before the job is on the calendar, deduction relies on memory | No deposits on M1's own jobs; subcontracted-job deposits tracked ad hoc | Needs a standardized deposit-to-invoice link in whatever accounting workflow results |
| CRM / system of record | SmartMoving (limited, not loved) | None (Calendar + msWhse combo) | Top strategic decision for the combined company |
| Estimating software | Not explicitly documented as a standalone tool | Manual in Excel/Numbers/Sheets | Shared gap; candidate for one combined solution |
| Cybersecurity policy / insurance | Not documented | None known | Net-new for the combined company |
| Document repository (contracts) | Crew App library is employee-facing only | Email + Jotform database, no central repository | Shared gap; candidate for one combined solution |
| Material inventory management | Informal visual inspection; low pain | Handled via msWhse (functional) | M1's tool could potentially extend to Mountaineer's materials, pending scope check |

## Summary

### Biggest Overlaps (Consolidation Candidates)

| Area | Why It's a Strong Candidate |
|---|---|
| Accounting platform | Both companies are already on QuickBooks — lowest-risk, highest-confidence consolidation in this entire assessment. |
| Scheduling / Dispatch | Both companies already run primary scheduling through Google Calendar. |
| Email / Workspace | Both companies run on Google Workspace for email; M1's M365 subscription is likely redundant. |
| BI / Reporting | QuickBooks native dashboards are available to both and underused by both, versus Mountaineer's unreliable custom dashboard. |

### Biggest Underperformers (Paid Tools Returning the Least)

| Tool | Company | Why It Underperforms |
|---|---|---|
| Statistics Dashboard (Apps Script) | Mountaineer | Buggy, slow, low trust in findings, by their own assessment likely to be rebuilt elsewhere. |
| SmartMoving Dispatch Module | Mountaineer | Adds manual steps with no offsetting benefit — the only feature in the original audit with no listed pros. |
| Google Voice | Mountaineer | Verified reliability issues (missed calls/texts) on a tool carrying client confirmations and dispatch details. |
| Yelp / Yelp Ads | Mountaineer | Low, inconsistent lead quality; requires responding inside a separate platform. |
| msWhse Dashboard | M1 | Fully available, configurable reporting layer that has simply never been turned on. |
| Microsoft 365 | M1 | Possibly redundant against an already-paid-for Google Workspace; necessity unconfirmed. |

### Most Painful Gaps

- Mountaineer's deposit tracking — real dollars at risk on a recurring basis.
- Mountaineer's claims process — both a financial and liability exposure, with a ready-made fix sitting in M1's existing claims sheet.
- Susan's departure with undocumented QuickBooks knowledge — time-sensitive, must be addressed before close, not after.
- No combined CRM / system of record — underlies several other gaps (fragmented client data, inconsistent lead handling).
- No combined cybersecurity policy — currently absent on both sides; exposure grows as the companies combine.

### Notable Underutilization

- SmartMoving (Mountaineer): Claims, Calendars, full Dispatch, Customer Service, Marketing, Storage, Accounting, and Smart Insights modules are paid for but unused.
- QuickBooks (both): integration capacity, job costing, A/R workflow automation, and the apps marketplace are underused on both sides.
- msWhse (M1): the built-in dashboard (customers, transactions, billing, utilization, inventory trends) has never been configured.
- Asana (M1): the broader feature set (reporting, goals, automation rules beyond the existing Flowsana-driven subtask pipeline) is underused; the core project subtask pipeline itself is functioning as designed and is more mature than initially described.

### Directional Recommendation

The combined company's clearest path is to consolidate around the platforms both companies already pay for — QuickBooks for accounting and reporting, Google Workspace for calendar/email/communication — before evaluating any new CRM or estimating purchase. Mountaineer's Crew App is a genuine, working asset that should be extended (not replaced) to cover more of the combined company's field and claims workflows, while M1's working claims sheet, intake automation, and unidentified-item workflow should be treated the same way. The single highest-priority action ahead of any platform decision is securing Susan's QuickBooks knowledge before the merger closes.

## Recommendations

### Quick Wins (0–90 Days)

| Recommendation | Effort | Value |
|---|---|---|
| Document Susan's QuickBooks processes / arrange formal knowledge transfer before close | Low | Critical — avoids loss of institutional accounting knowledge |
| Confirm contract terms (annual vs. month-to-month) for msWhse, QuickBooks, Gusto, Asana, JotForm, VoIP, hosting | Low | Needed to sequence any migration or cancellation |
| Configure the existing msWhse dashboard (transition to Ian) | Low | Immediate visibility into a paid-for, unused capability |
| Confirm what M365 is actually used for; cancel if redundant with Google Workspace | Low | Direct cost savings, low risk |
| Formalize M1's claims Google Sheet as the interim combined-company claims template | Low | Closes Mountaineer's most-flagged gap with no new tooling |
| Confirm ownership/access of Google Business Profiles purchased through HostGator | Low | Avoids a hidden access risk |

### Mid-Term Opportunities (3–12 Months)

| Recommendation | Effort | Value |
|---|---|---|
| Consolidate accounting onto a single QuickBooks instance for the combined company | Medium | High — removes duplicate bookkeeping, enables combined reporting |
| Decide and migrate to a single payroll system (QuickBooks Payroll vs. Gusto) | Medium | High — required once employees sit under one entity |
| Connect msWhse and/or any successor warehouse tool directly to QuickBooks to remove manual re-entry (60–90 invoices/month) | Medium | Meaningful time savings, reduces data-entry error |
| Stand up a baseline cybersecurity policy covering both PII (client) and FMCSA-regulated driver data | Medium | Risk mitigation; currently a gap on both sides |
| Pilot extending Mountaineer's Crew App materials/photo logging to M1's unidentified-item intake workflow | Medium | Operational efficiency; builds on an existing custom asset |
| Build a standardized deposit-to-invoice tracking process for both legacy businesses | Medium | Direct revenue protection |

### Strategic Initiatives (12+ Months)

| Recommendation | Effort | Value |
|---|---|---|
| Decide on a combined-company CRM / system of record (keep SmartMoving, replace it, or formalize a Calendar/Asana-based model) | High | Transformational — underlies lead handling, reporting, and client data integrity |
| Decide marketing model for the combined company (continue/expand Global Spex vs. bring more in-house using M1 ownership's expertise) | High | High cost and revenue impact |
| Evaluate and potentially adopt a shared estimating tool to replace manual spreadsheet estimating on both sides | High | Efficiency and quoting accuracy across the combined book of business |
| Reduce single-developer dependency on the Crew App by documenting its architecture and/or bringing in a second technical resource | High | Long-term risk mitigation for the combined company's most relied-upon custom system |
| Build a unified reporting layer on top of consolidated QuickBooks data and Crew App field data, replacing the Apps Script dashboard | High | Reliable, trusted KPI reporting across the combined company |

Prepared ahead of the Mountaineer ownership kickoff meeting. Figures and statuses marked above as assumed, unconfirmed, or flagged for follow-up should be validated jointly with Mountaineer leadership and updated as the January 1 transition plan develops.
