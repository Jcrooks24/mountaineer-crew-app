# Mountaineer Moving Co. - Crew App Reference & Troubleshooting Guide

**Version 2.3**  |  July 2026
**App:** https://mountaineer-crew-app-two.vercel.app
Questions? Text or email Jacob - management@mountaineermoving.com

> Version-controlled copy of the crew reference guide. Verify against the code when features change. The master formatted copy is the shared doc.

The Mountaineer Crew App is the digital backbone of every job day. It replaces paper logs, manual timesheets, and verbal materials tracking with a single app that crew and admin share in real time. This guide covers every feature in depth, explains the correct workflow, and provides solutions for every known failure mode.
### 1.1 How the App Works
The app is a Progressive Web App (PWA): it runs in your phone's browser and can be added to your home screen like a regular app. No app store download required.
APP URL:  mountaineer-crew-app-two.vercel.app
Add this to your home screen from your browser's share / options menu so it opens instantly on job days. All data syncs to a shared Google Sheet that admin uses for billing, compliance, and job review. You never see this sheet directly; just log your events and the app handles the rest.
### 1.2 Two Roles
CREW: All drivers and movers
Log events, DVIR, materials, photos, incidents, actual inventory (long-distance), job report, bill, long distance forms, document library, off-job hours, and expense / reimbursement requests.
ADMIN: Jacob and designated employees
Everything crew can do, plus: activate accounts, mechanic DVIR sign-off (in person or by emailed link), manage patch notes and admin notes, view crew map, job summary review, office hours logging, the incident log, the skills registry and job-types list, the shared furniture catalogue, advanced settings and System Check, and the estimator. Admins (and crew an admin designates as Skill raters) also rate crew skills on the Job Report.
### 1.3 Offline Behavior
Almost everything works without cell signal. The app queues your inputs locally and syncs automatically when signal returns. You will never be told to "go online and try again" mid-job.

| Feature | Works Offline? | What Happens |
|---|---|---|
| Login / Signup / Password reset | No | Requires signal |
| Calendar job picker | No | Use manual entry as fallback |
| Timeline events | Yes | Queued locally, syncs on reconnect |
| Timeline edits (note/time) | Yes | Separate patch queue |
| Photos | Yes | Queued, uploads on reconnect |
| Materials add/remove | Yes | Queued |
| DVIR submission | Yes | Queued |
| Long distance forms | Yes | Queued |
| Digital Bill of Lading | Yes | Draft, inventory, and both signatures all work offline; the signed PDF is generated on-device and handed to the client immediately even with no signal; the record itself syncs to the server on reconnect |
| Job report + bill | Yes | Saved locally, syncs on reconnect |
| Expense / reimbursement requests | Yes | Queued; photos upload on reconnect |
| Incident reporting | Yes | Queued; photos upload on reconnect |
| Actual inventory (long-distance) | Yes | Queued, syncs on reconnect |
| Off-job hours | Yes | Queued, syncs on reconnect |
| Document library download | No | Browse cached list only |
| Estimator item adds | Partial | Item adds queue; metadata autosave needs network |
| Admin office hours | Yes | Queued, syncs on reconnect |
| Admin notes display | Partial | Cached from last fetch |

IMPORTANT: Pick your job from the calendar BEFORE you lose signal. The calendar picker is online-only. If you're heading somewhere with no service, select your job while you're still at dispatch.
## 2. GETTING STARTED: INSTALLATION & ACCOUNTS
This section covers everything a new crew member needs to do once to get set up. Installation takes about 5 minutes and only needs to be done once.
### 2.1 Installing the App
The Mountaineer Crew App is a Progressive Web App (PWA). There is no app store download; you install it directly from your phone browser. The result is a home screen icon that opens the app just like any native app.
iPhone (iOS): MUST USE SAFARI
You MUST use Safari to install on iPhone. Chrome and other browsers on iOS do not support "Add to Home Screen." If you opened this link in Chrome or Gmail's browser, copy the URL and paste it into Safari first.
Open Safari on your iPhone.
Go to mountaineer-crew-app-two.vercel.app
Tap the Share button at the bottom of the screen (box with an arrow pointing up).
Scroll down in the share menu that appears.
Tap "Add to Home Screen."
Tap "Add" in the top right corner.
The app icon will appear on your home screen.
Android: Use Chrome
Open Chrome on your Android phone.
Go to mountaineer-crew-app-two.vercel.app
Tap the three dots in the top right corner.
Tap "Add to Home Screen" or "Install App."
Tap "Install."
The app icon will appear on your home screen.
After Installation
Tap the home screen icon to open the app. You only need to log in once; the app keeps you signed in between job days. No manual updates needed; the app updates itself in the background. You can also force an update any time from the Profile tab (see Section 2.5).
### 2.2 Signing Up
New crew members self-register at the app URL. After submitting the signup form, the account is INACTIVE until an admin activates it.
New Account Checklist
Open the app and tap Sign Up.
Enter your name, email address, and a password.
Tap Create Account.
Immediately text Jacob at (530) 613-5771; you cannot log in until he activates your account.
Once activated, log in and you're set. Your account is saved permanently.
### 2.3 Logging In & Out
Your session stays active until you explicitly log out. You do not need to log in again on the same device between job days unless you've signed out.
Logout: Profile tab → Sign Out.
Sign out all devices: Profile tab → Sign out all devices. This immediately invalidates your session everywhere.
### 2.4 Forgot Password
Tap "Forgot Password" on the login screen, enter your email, and check your inbox for a reset link.
Reset links expire after 15 minutes. "Invalid or expired" means the link timed out or was from a different environment. Request a new link; don't reuse old ones.
### 2.5 Profile
The Profile tab is a landing screen with quick access to your account, app tools, and update status, not just a settings form. Your photo appears as the "created by" avatar on Timeline events so admin can see who logged what.
My Profile
Your name, photo, and email sit in their own card at the top of the Profile tab. Tap it to open the dedicated My Profile screen, where you update your name and photo.
Update App to Latest Version
A prominent "Update app to latest version" button sits near the top of the Profile tab. Tap it any time to force the app to pull the newest build. It will report one of:
"You're on the latest version."
"Update found, reloading…" (the app refreshes itself)
"You're offline, can't check for updates."
You usually won't need to tap this button at all: the app now checks for updates on its own and lets you know when one's ready. See "Automatic Update Alerts" below.
Automatic Update Alerts
The app checks for new builds on its own, periodically while it's open and whenever you switch back to it. When a new version has finished installing in the background, a banner appears at the bottom of the screen: "New version available." Tap Update whenever you're at a safe stopping point; it won't interrupt you mid-job, and ignoring it is safe: the update applies on its own the next time you fully close and reopen the app.
App Version Name
The current app release is Version 2.3. The Profile tab also shows a friendly two-word build name (e.g. "Brave Otter") plus a smaller build ID for the exact build you're running. When reporting a problem to Jacob, include the build name and build ID; they pinpoint exactly which build you're on.
Tools & Resources
The "Tools & Resources" card was removed from the Profile tab in August 2026. Everything that was on it now lives on the Tools tab in the bottom navigation, which is where you should go for any feature that doesn't live on the Timeline tab:
Availability: submit which days you can work. See Section 11. (The overdue warning is now the banner that appears at the top of the app, not a badge on the Profile card.)
Reimbursement: mileage, personal-card reimbursement, or company-card receipts. See Section 10.
Long-distance: Prior On-Duty Hours Statement, Record of Duty Status, and Digital Bill of Lading for interstate jobs. See Section 3.2 and 3.3.
Off-job hours: log hours for work not tied to a customer job (shop work, errands, anything not billed to a move). Enter the date, clock in/out, any break periods, and a note; net hours calculate automatically. Works offline and syncs on reconnect.
Documents: browse and download company reference documents. See Section 9.
DVIR, Report a bug, and Request a feature are on the same Tools tab.
Worked Hours
A "Worked Hours" card on the Profile tab shows your own logged hours by week: regular, overtime, and non-billable, pulled from the Employee Hours entered on job reports plus any off-job hours. It is your personal view of what you have logged; you do not edit it here.

If the office finds a mistake in your reported hours while running payroll, they can correct it. When they do, you get an email before payday listing each change: the day, the job, what was reported, what it was changed to, and why. What you originally submitted is not erased, and the office can still see it. If a correction looks wrong to you, reply to that email or talk to the office before the next pay period closes.
Patch Notes
The bottom of the Profile tab lists what's changed in recent updates. Each note shows a short preview with a "Read more" link, so the Profile tab stays easy to scan even as the list grows.
## 3. FMCSA COMPLIANCE
FMCSA stands for the Federal Motor Carrier Safety Administration, the federal agency that regulates commercial trucking. As a moving company operating commercial vehicles, Mountaineer is required to comply with FMCSA rules on every trip. The app handles all required forms digitally, but crew must understand what they're filing and why.
THESE ARE FEDERAL REQUIREMENTS. DVIR is required by 49 CFR 396.11 on every pre- and post-trip. Long distance forms are required by 49 CFR 395.8 on every interstate trip. Non-compliance is a violation that can fall on both the company and the individual driver.
### 3.1 DVIR: Driver Vehicle Inspection Report
A DVIR is a written record that a driver inspected their vehicle before and after each trip and noted any defects. Required every trip, every driver, no exceptions.
What You're Inspecting
The DVIR checklist covers 25 items including brakes, lights, tires, mirrors, horn, wipers, fuel/oil levels, coupling devices, and emergency equipment. Each item is marked satisfactory or defective.
Pre-Trip DVIR Step by Step
Open the DVIR tab before moving the truck.
Select your vehicle from the unit dropdown. If your truck isn't listed, tell Jacob; vehicles are admin-configured.
Review the previous DVIR for your vehicle. Note any prior defects and whether they were resolved.
Walk through the 25-item checklist. Mark each item satisfactory or defective.
If you found defects: describe them clearly in the notes field.
Sign with your finger in the signature pad and submit.
A clean pre-trip with no defects takes around 2 minutes to complete in the app. Build it into your morning routine before the truck moves.
Post-Trip DVIR
Same process as pre-trip, completed after your last job of the day when you return the truck. If you're running multiple jobs on the same truck in one day, complete only one post-trip at the very end, not between jobs.
What Happens With Defects
If your DVIR notes any defect:
The DVIR enters the mechanic review queue. Admin is notified.
The truck should NOT be driven until a mechanic signs the mechanic review portion.
Once the mechanic portion is signed, the DVIR clears and the truck is good to go.
DEFECT RULE: Do not drive a truck with an open mechanic review. If you're unsure whether a defect has been cleared, check with Jacob before taking the truck out.
How the Mechanic Sign-Off Happens
There are two ways a defective DVIR gets cleared. Both are admin-initiated:
In person: an admin opens the DVIR in DVIR Review and signs the mechanic portion directly on the device.
Remote (emailed link): an admin emails a sign-off link to a mechanic who does not have an app account. The mechanic opens the link, reviews the defect, and signs from their own phone or computer.
See Section 13.3 for the admin side of both paths.
Multi-Job Day DVIR
If you're running the same truck on back-to-back jobs the same day:
One pre-trip in the morning covers all jobs.
One post-trip at the end of your last job covers all jobs.
When the DVIR reminder pops between jobs, select the appropriate multi-job option so the app stops prompting.
"Already pre-tripped for an earlier job today"  Use when the pre-trip prompt fires on your 2nd+ job of the day on the same truck.
"Multiple jobs today, final DVIR at end of last job"  Use when the post-trip prompt fires before your last job is complete.
### 3.2 Long Distance Forms (Interstate Jobs Only)
When a job crosses state lines, additional FMCSA hours-of-service rules apply. Three tools are available under the Long Distance menu in your Profile: the Prior On-Duty Hours Statement, the Record of Duty Status, and the Digital Bill of Lading (Section 3.3).
Prior On-Duty Hours Statement (FMCSA 395.8(j)(2))
Required before departure on any interstate trip, from every driver on the trip. It is filed per driver, not once per trip: on a multi-driver job, each driver files their own statement. You declare how many hours you've worked over the prior 7 days and the prior 24 hours.
Open the Tools tab → Long-distance → Prior On-Duty Hours Statement.
Enter your hours worked for each of the past 7 days and your hours in the last 24.
Sign and submit before the truck leaves.
Record of Duty Status (RODS)
For interstate trips, federal law requires a daily log of your duty status with timestamps for every change. The four duty statuses are: Off Duty, Sleeper Berth, Driving, and On Duty (Not Driving).
Open the Tools tab → Long-distance → Record of Duty Status.
Log each duty status change as it happens throughout the trip day.
Add remarks for notable events (fuel stops, inspections, loading/unloading).
Sign and submit at end of day.
MULTI-DRIVER TRIPS: The Report tab's RODS section auto-creates one sign-off block per driver on the trip, with a roster-typeahead field for adding a driver's name (start typing and pick from the crew list, or type a name not on the roster). Each driver's block shows a "Prior On-Duty Hours Statement filed" checkbox: it checks itself automatically once that driver's statement is on file for the trip, since one Statement covers the whole multi-day trip rather than needing to be refiled each day. If it isn't checked yet, tap "File PODS" to jump straight to that driver's form.
TRALA EXEMPTION (MOVERS EXEMPTION): Some interstate moving jobs qualify for a reduced RODS requirement under the TRALA movers exemption. The app documents this exemption for reference. During a traffic stop, an enforcement officer may request that you produce the TRALA document embedded within the app.
### 3.3 Digital Bill of Lading (BOL)  NEW
A Bill of Lading is the shipping contract and receipt for the shipment: it declares the inventory being carried, its condition, and the terms of carriage, and federal law requires one for every interstate shipment. The app now builds, signs, and delivers this document digitally in the field instead of on paper.
Open the Tools tab → Long-distance → Digital Bill of Lading.
Where It Lives
A BOL is tied to the same job the crew already selected on the Timeline; there's no separate job picker. Opening the BOL tool shows any open (unsigned or partially signed) BOL for that job so a second crew member picks up exactly where the first left off, or lets you start a new one.
Building the Inventory
Search the furniture catalog or use custom entry, same as Materials.
Set quantity per item.
Add condition notes and photos per item as you go.
For anything that's a box, set the pack type: CP (Company Packed: we packed the contents, so the carrier is responsible for loss or damage), PBO (Packed By Owner: the shipper packed it, so the carrier is not liable for the contents inside), or N/A. This distinction matters for FMCSA loss-and-damage liability, so don't skip it on boxes. A one-tap control sets a pack type on every box at once when they are all the same.
Confirm the inventory is a complete record before saving, or explain why it isn't yet (e.g. still loading) in the note field.
On LD+ load/unload days, this same inventory also appears as its own Inventory tab on the Timeline (see below), so it can be built as items are actually carried on and off the truck rather than only from the Long Distance menu.
Filling in the BOL details (required by federal law)
Above the inventory, the BOL now asks for the information a Bill of Lading must legally contain, in short cards you fill in directly. Look these up in the job's Google Calendar description and type them in (the app does not pull them from the estimate). The cards are:
Shipper and shipment: the customer's name and phone; the origin (pickup) and destination (delivery) addresses; and the shipment/job reference (prefilled from the job, editable). The shipper address defaults to the pickup address ("Same as pickup address" is checked by default); uncheck it if the customer's address is different and type it in.
Payment: the form of payment the customer will use at delivery. If you pick Collect on delivery (COD), a couple more fields appear for who to notify and the maximum amount due at delivery. (Estimates are always non-binding, so there is no estimate-type field.)
Valuation: have the customer choose one of two liability options, Full Value Protection or Released Value (60 cents per pound, per article). This is a legally required choice and must be made before signing.
Agreed dates: the pickup and delivery dates or windows agreed with the customer. Pickup defaults to today; change it if needed. A single date or a range is fine.
Other required declarations: additional carriers, third-party insurance, and special/accessorial services. Leave blank if there are none; the BOL records None / N/A.
All of the fields marked with an asterisk are required. If any is missing when you try to sign at origin, the app tells you exactly which card to complete.
Signing: Origin and Destination
The BOL is signed twice, by both the client and a Mountaineer crew representative each time:
Origin Signing (before loading): once the detail cards above are filled in, capture the actual pickup date and the vehicle (unit) for this trip, the client's printed name, both signatures, and check the electronic-signature consent box. Tap "Sign at origin & give copy." The app will not let you sign until every required BOL field is entered, because the finished document must be complete and compliant when a DOT officer inspects it.
Destination Signing (upon delivery): after the origin signature, the BOL shows "Destination Signing - upon delivery." Complete the final walk-through, note any damage (write NONE if there isn't any), enter final actual charges if they changed, then collect both signatures again and tap "Sign at delivery & give copy."
Every signing immediately generates a PDF and hands it to the client (via the phone's share sheet if available, otherwise a download) even if you're offline; the signed record itself syncs to the server and Google Drive on reconnect. Once both signings are complete, the BOL is marked Delivered and the signed PDF is available any time from the BOL screen.
Presenting or sending the signed BOL: as soon as the BOL is signed at origin, a "Signed Bill of Lading" card appears at the top of the BOL screen. "View / download signed BOL" reproduces the signed document on demand so you can show it (for example to a DOT officer at a border) - this works with no signal. You can also correct the origin/destination addresses there and Save them, and email a copy straight to the client by entering their email and tapping "Send to client" (emailing needs signal; if you're offline, use View / download to hand over a copy instead).
Inventory Tab (LD+ Load/Unload Days)
**Field help.** On the job setup form, any field title with a small "?" next to it can be tapped for a one-line explanation of what that field means. It shows for about three seconds and closes itself, or tap it again to dismiss it early. This covers the Bill of Lading details in particular, where several fields (Valuation, Estimate type, Additional carriers) are legal terms that print onto the signed document.

On the Timeline tab, long-distance jobs start with a day-plan prompt: pick whichever of Packing, Loading, Unloading, Unpacking, Internal rearrange, and Driving apply to today (any combination). "Internal rearrange" is for a day spent moving items around inside one home, commonly for a renovation, where nothing is loaded or driven anywhere; pick it instead of Loading so the day is recorded honestly. Selecting Loading or Unloading surfaces a new Inventory tab alongside Timeline, Photos, and Report. It's the same declared inventory as the BOL: items added here compile directly into that job's Bill of Lading, so the crew can build the inventory as they carry items rather than re-entering it later. Log furniture and boxes with their pack type (CP / PBO / N/A), search the shared furniture catalogue as you type, and set a pack type on every box in one tap. For piles of loose miscellaneous items ("chow" - garden tools, hoses, blankets, and the like) an "Estimate chow volume" tool turns a rough pile size into a cubic-foot estimate so it counts toward the load without listing every item. Selecting Driving swaps the normal Start/Arrive/Depart/Finish actions for the RODS duty-status recorder described above.
This feature is new and marked BETA in the app; if anything about the signing flow or inventory sync looks off, tell Jacob.
## 4. JOB DAY WORKFLOW
This section walks through the full job day in order. Follow these steps on every job.
### 4.1 Before Leaving the Yard
Step 1: Pick Your Job (While Online)
Open the app and select your job from the calendar dropdown at the top of the Timeline tab. This step requires an internet connection; do it before you leave dispatch or head somewhere with spotty service.
Why this matters: The calendar picker pulls your job from Google Calendar and assigns a unique ID shared across all crew on the same job. If two crew members pick the same calendar event, their logs automatically merge into one job record.
If you have no signal, use the "Other / Manual entry" option and type the job name. The dropdown now also lists any manual job names other crew have already typed in for that same date, pulled from the server, right alongside the calendar events: pick the matching one instead of retyping it and everyone's logs merge into the same record automatically. Only fall back to typing a brand-new name if nothing already matches.
Step 2: Complete Pre-Trip DVIR
See Section 3.1 for full DVIR instructions. Do not move the truck until this is done.
Step 3: Long Distance Forms (Interstate Only)
If this is an interstate job, complete the Prior On-Duty Hours Statement before departure. See Section 3.2.
### 4.2 On the Road and On the Job
Step 4: Tap START
Tap the START button in the Timeline tab when you pull away from dispatch. This is when billable time begins. Do not tap it before you leave. Do not forget to tap it.
Step 5: Arrive and Depart at Every Stop
Tap Arrive every time you pull up to a location. Tap Depart every time you leave. This applies to every stop throughout the day:
Origin (the customer's pickup address)
Destination (drop-off address)
Storage facilities
Dump sites
Any other intermediate stop
COMMON MISTAKE: Only using Arrive/Depart at the main job site and forgetting intermediate stops. Log every location; admin uses this data to reconcile hours and mileage.
Step 6: Log Materials as You Go
Open the Report tab and log any materials used as the job progresses. Works offline; adds queue and syncs automatically.
Tap the item from the catalog or use the custom entry field.
Set quantity.
Remove an item by swiping or tapping the delete icon; removals also sync to the admin sheet.
Step 7: Take Photos
Use the Photos tab to document the job. Caption your photos when relevant (fragile items, pre-existing damage, company-caused damage).
Photos are automatically compressed before upload.
If a photo appears stuck uploading, you're likely offline. Leave it and it will sync on reconnect. Do not keep retrying.
Photos are stored per-job in Google Drive and visible to all crew and admin on that job once synced.
### 4.3 End of Job
Step 8: Tap FINISH
Tap the FINISH button when you return to dispatch. This ends billable time. Do not forget this step.
Step 9: Complete Post-Trip DVIR
Complete your post-trip inspection after your last job of the day. See Section 3.1. If running multiple jobs, wait until the final job is complete.
Step 10: Submit Job Report (Crew Lead)
The crew lead completes the Job Report before logging off. Fields include:
Job type: pick the tag(s) that describe this job (Local, Long-distance, Packing, etc.) from the list admin configures. See Section 7.5.
Personal vehicles: Count of personal vehicles on site.
Truck fullness: for each truck used, mark how full it ended up on the truck-deck diagram. It shows the fill percentage and the cubic feet at the same time. Each truck also adds a per-hour truck line to the bill (Section 7.1). See Section 7.6.
Dumpster %: Percentage of a full dumpster used (0-100 slider).
Recycling %: Percentage of recycling capacity used (0-100 slider).
Billing method: invoice, cash, etc.
Review candidate: Whether or not we should seek a review from the client. Yes, No, or N/A.
Hours match: Confirm whether the timeline reflects actual hours billed and paid. If not, explain in the text field.
Employee Hours: Per-person hours for everyone on the job, chosen from the roster. See Section 7.4 for the full editor.
Close-out: three optional questions at the bottom of the report - why the job ran differently than quoted (in either direction, tick all that apply), whether the client was ready, and anything added or changed on site. See Section 7.9.
Skill ratings: admins and designated Skill raters rate each mover on the skills a job actually called for. See Section 7.7.
Wrap-up estimator: a projected finish time (your remaining work plus the drive back to the yard) you can pick as an End time, and a drive-time estimate for the trip home. See Section 7.8.
Crew Feedback: Optional general feedback or job-specific feedback to send to the office.
Step 11: Review and Submit the Bill (Crew Lead)
The bill auto-populates from timeline events, materials logged, and dumpster/recycling sliders. Before the report will submit, the crew lead must:
Open the Bill section within the Report tab.
Review all line items for accuracy.
Add or edit any items as needed: custom items, company charges, tips, discounts.
Check the "Reviewed" box.
The Submit button unlocks. Tap Submit.
THE BILL MUST BE REVIEWED BEFORE SUBMIT: The app gates the report submission behind the bill review checkbox. If you can't submit the report, open the Bill section and make sure the reviewed box is checked.
## 5. TIMELINE TAB: IN DEPTH
The Timeline is the core crew tool. Every job event is logged here in chronological order.
### 5.1 Logging Events
Tap the appropriate action button (Start, Arrive, Depart, Break Start, Break End, Finish, etc.) to log an event. Each event captures: timestamp (Mountain time), GPS location, your user identity, and an optional note.
### 5.2 Editing Event Times
If you forgot to tap an event, or your phone clock was wrong, you can correct the time after the fact.
Tap the time displayed on any Timeline event.
Adjust to the correct time.
Save.
LIMITS: You can set a time up to 7 days back from when the event was originally captured, and up to 5 minutes ahead of now.
AUDIT TRAIL: The original capture time is always preserved on the admin side. Editing a time does not erase the original; admin can see both. Use this feature to fix honest mistakes only.
### 5.3 Notes on Events
Every event has a note button. Tap it to add or edit a note on that specific event. Notes sync across devices: a note added on one crew member's phone will appear on all other devices on the same job after a refresh.
### 5.4 Job Notes
Below the Activity list, a separate "Notes" card holds one freeform note for the whole job, different from the per-event notes in Section 5.3. Use it for anything that applies to the job as a whole rather than a single moment (e.g. "customer added a stop we didn't know about"). It autosaves a couple seconds after you stop typing and syncs across devices the same way event notes do, with a status indicator showing Saving…, Saved, or "Saved offline, will sync."
### 5.5 All Times Are Mountain
Every time displayed in the app is Mountain time (Bozeman, MT), regardless of what timezone your phone is set to. This means what you see on your phone matches exactly what admin sees.
### 5.6 Offline Timeline
Timeline events log fully offline. They queue locally and sync when signal returns. The local log retains approximately 14 days of history, capped at 2,000 entries. The Google Sheet is the authoritative long-term record.
### 5.7 Long-Distance Day Plan
On interstate jobs, the Timeline opens with a prompt to mark what today's activities are: any combination of Packing, Loading, Unloading, Unpacking, Internal rearrange, and Driving. This plan decides which tools the Timeline shows: selecting Driving swaps the usual Start/Arrive/Depart/Finish buttons for the RODS duty-status recorder (Section 3.2), and selecting Loading or Unloading adds the Inventory tab that feeds the job's Digital Bill of Lading (Section 3.3). **Weight is always available**, in a "Scale weight" section at the bottom of the RODS recorder on a drive day and in the Actions row otherwise, so a truck loaded one evening can be weighed the next morning before pulling out and still be logged against the job.
## 6. MATERIALS
Log all materials used on a job. Materials feed directly into the Bill as line items.
### 6.1 Adding Materials
Open the Materials tab.
Search the catalog or use custom entry.
Set the quantity.
Tap Add. The item appears immediately (optimistic UI).
### 6.2 Removing Materials
Swipe or tap the remove icon on any material.
Removals sync to the admin sheet; no ghost rows.
A pending add that hasn't yet synced can be removed without it ever hitting the server.
### 6.3 Pricing
Catalog items have a unit price set by admin. Total = qty × unit price. Custom items let you type a cost manually. All materials appear as line items in the bill.
## 7. BILL CALCULATOR
The bill is embedded in the Job Report tab. It auto-seeds from job data and allows the crew lead to finalize charges before submission.
### 7.1 What Auto-Populates
Labor hours: The bill automatically creates one labor line item per crew member at the standard labor rate, kept in sync with whatever is entered in the Employee Hours editor (Section 7.4): change someone's hours there and their labor line updates to match. Edit or remove a labor line by hand at any time; a hand-edited line is preserved rather than overwritten by later Employee Hours changes.
Materials: Every material logged feeds in as a line item.
Dumpster / recycling charges: Driven by the sliders in the report.
Personal vehicles: one line per personal vehicle flagged to bill as crew transport.
Trucks: one "Truck (per hour)" line for each truck recorded in Truck fullness (Section 7.6). Like the labor lines, a hand-edited truck line keeps its qty and rate on later renders.
### 7.2 What You Can Edit
Any line item: label, quantity, rate, unit, per-line discount %.
Add custom line items.
Add company charge items from the built-in catalog (fuel surcharge, Big Sky trip fee, dump fee, overtime, etc.).
Add a Tips line item from the Add line-item menu. It is a flat-amount line you fill in; use it to record cash or card tips on the bill.
Apply a global discount % to the whole bill.
Add bill notes.
### 7.3 Submitting
Check the "Reviewed" checkbox to unlock the report Submit button. The bill cannot be skipped.
### 7.4 Employee Hours
Inside the Job Report, the Employee Hours card lets the crew lead log hours per person for everyone on the job. Type a name (a roster typeahead suggests names from the crew list as you type, but any name can be entered), pick the start and end timeline events for that person, then add any clocked-out periods (lunch, errands, anything that should be subtracted from hours worked) before saving the entry. Repeat for each crew member.
Hours default to the first START and last FINISH on the timeline, but can be overridden manually per person.
Each saved entry shows worked hours rounded to the nearest quarter hour (5+ minutes rounds up) alongside the exact actual hours.
Mark an entry "Non-billable" to keep it visible on the report without adding it to the total man-hours, useful for time that shouldn't be charged to the customer.
Use Edit or Remove on any saved entry to correct it. Need at least two timeline events logged for the job before you can add any entries.
Saving an entry here also updates that person's auto-generated labor line in the Bill (Section 7.1).
### 7.5 Job Type
The Job Report captures the job type: one or more tags (Local, Long-distance, Labor-only, Packing, Unpacking, Commercial, Delivery, Storage) picked from the list admin configures. Tap the tags that apply. This is descriptive data for the office and drives which skills are rated (Section 7.7); collect it on every job.
### 7.6 Truck Fullness
Record how full each truck ended up. Add each truck used (pick from the fleet, or add a rental with a free-text name and its length), then mark the fill on the truck-deck diagram.

The diagram is the deck seen from the side, cab on the left. Tap where the load reaches and it sets both directions at once: how deep it goes from the headboard toward the door, and how high it stacks off the floor. The gridlines are the interior 25% marks the fleet trucks are striped with. The two sliders underneath do the same thing if you would rather fine-tune, or if you are wearing gloves.

Under the diagram you get both numbers at once: the fill percentage and roughly how many cubic feet that is. Read them together for a few jobs and you will start being able to call cubic feet by eye, which is the point.

A rental only shows cubic feet once you have entered its length, since we do not know the box otherwise. Cubic feet are an estimate from the truck's interior dimensions - nothing bills off them.

Each truck you add also creates a "Truck (per hour)" line on the bill (Section 7.1).
### 7.7 Skill Ratings
Admins and anyone an admin designates as a Skill rater can rate each mover on the skills a job actually called for, on a 1-to-5 star scale (1 = held the job up, 5 = seasoned-lead level), or mark a skill N/A when it did not apply. Which skills appear depends on the job type. If you are not a designated rater, the skill rows do not show for you, and the ratings a rater already set are preserved. Ratings are display-only; they never change the hours or the bill.
### 7.8 Wrap-Up Estimator
On the Job Report, tap to calculate a projected job wrap-up time: the drive time from where you are now back to the yard (plus a buffer) added to any billable work still left to do once you are there. You can pick the projected time as an employee's End time in the hours editor. A separate return-trip drive estimate gives the time home. If GPS or signal is unavailable, enter the drive minutes by hand; the estimate still works.
### 7.9 Close-out
Three questions at the bottom of the Job Report. All of them are optional and none of them block Save - if you cannot answer one, skip it.

Did the job run differently than quoted? Tick every reason that applied - you are not limited to one. The list is split into two halves. "Ran longer than quoted" covers underestimated volume, access or stairs, client not ready, crew size or skill, scope added on site, travel or traffic, and damage or repack. "Ran shorter than quoted" covers overestimated volume, easier access than expected, client further along than expected, scope reduced on site, and crew faster than expected. Use the second half. A job that beat its estimate is worth knowing about, and if nobody taps it the office cannot tell "we finished early" from "nobody filled this in". A note box appears once you pick anything, for what the list does not cover. Tap a chip again to clear it.

Was the client ready when you arrived? Fully, mostly, partly, or not ready. If you pick anything other than Fully ready, a second row appears asking what specifically was not ready - tick all that applied. Changing your answer back to Fully ready clears those ticks, so the two answers never contradict each other.

Anything added or changed on site? Add one entry per change. Within an entry, tick every reason that fits it - one conversation on the driveway where the client dropped both the storage unit and the second stop is one change with two reasons, not two changes. Reasons are split into "Added / more work" and "Dropped / less work".

Each entry has an Impact toggle: Added time or Saved time. It sets itself from the first reason you tick, and you can override it. Then enter roughly how many hours the change cost you or gave back - always a plain positive number, the toggle is what makes it add or subtract. The hours are a rough guess so the office can see which kinds of change actually move a day; they are not a bill and they do not feed the invoice. Add as many entries as you need.

None of this changes the bill. It exists so the office can tell why a job went the way it did without having to phone you the next morning.

## 8. PHOTOS
Document jobs with photos. Storage is per-job in Google Drive.
### 8.1 Taking and Uploading Photos
Open the Photos tab.
Tap the camera icon to take a photo, or upload from your gallery.
Add an optional caption (highly recommended for each photo).
Photo is automatically compressed to roughly 600KB and queued for upload.
### 8.2 Offline Photos
Photos taken offline are queued and uploaded automatically when signal returns. If a photo shows a "stuck" upload indicator, you're offline. Do not tap retry repeatedly; the upload will complete on its own when signal returns.
### 8.3 Where Photos Go
Each job's photos go to a dedicated folder in Google Drive: Crew Photos/{job_name}_{job_date}/. Once synced, photos are visible to all crew and admin on that job.
### 8.4 Reporting an Incident
Report damage or an incident (customer property, our equipment, a vehicle, an injury) right from the Photos tab. Tap to start an incident, describe what happened, and attach photos to it the same way you attach job photos. Each incident gets an automatic claim number so the office and any insurer can reference it. Incidents work offline and sync when you are back on signal. File the incident first, then keep attaching photos as you document the scene; the photos link to the incident even if they finish uploading later. Admin reviews every incident, records an estimated cost, and marks it resolved (Section 13.9).
## 9. DOCUMENT LIBRARY
Browse and download company reference documents from your phone: COI, blank contracts, Bills of Lading, estimate templates, policy documents, and more.
Access via the Documents tab.
Crew can browse and download. Admin can upload and delete.
Downloading requires signal. Browsing the cached list works offline.
## 10. EXPENSES & REIMBURSEMENT
The Expenses screen lets crew log mileage, request reimbursement for out-of-pocket purchases, and record company-card purchases. It replaces texting photos of receipts and odometers to Jacob.
### 10.1 Opening the Expenses Screen
Open the Tools tab and tap "Reimbursement".
The screen has two modes, chosen with the toggle at the top:
Mileage: odometer-based mileage reimbursement
Business expense: a purchase, either personal-card or company-card
### 10.2 Mileage Reimbursement
Use this when you drove your own vehicle for company business and should be reimbursed for the miles.
Date of trip:  Defaults to today; change it if you're logging this for a different day.
Start odometer:  The reading at the start of the trip.
End odometer:  The reading at the end of the trip.
Start odometer photo:  A picture of the odometer at the start. Take a new photo or choose one from your library.
End odometer photo:  A picture of the odometer at the end. Take a new photo or choose one from your library.
Notes:  Optional; what the trip was for.
All fields are optional. You can submit a PARTIAL request (for example, just the two odometer photos) and the admin will follow up. The app only blocks: a completely empty form, and an end odometer reading that is lower than the start reading.
### 10.3 Business Expense (Personal or Company Card)
Use this for any purchase made for the company.
Date of expense:  Defaults to today; change it if you're logging this for a different day.
Amount ($):  What was spent.
Category:  Fuel, Supplies / Materials, Tolls & Parking, Meals, Equipment Rental, Vehicle Maintenance, Other.
Vendor:  The store or business where the purchase was made; enter it as it appears on the receipt (e.g. Home Depot, Shell, U-Haul).
Paid with:  Personal card: you paid out of pocket; this REQUESTS reimbursement. Company card: paid on a company card; this is LOG ONLY, no reimbursement owed.
Receipt photo:  A picture of the receipt. Take a new photo or choose one from your library.
Notes:  Optional; what the expense was for.
The button reads "Submit request" for a personal-card expense and "Log expense" for a company-card expense.
### 10.4 Submission Status & History
Every submission appears in the "Your submissions" list at the bottom of the screen, each with a status:
Pending sync:  Saved on your phone, not yet uploaded (you're offline).
Submitted:  Received; awaiting admin review.
Approved:  Admin approved the request.
Rejected:  Admin rejected the request. Check the "Admin: …" note under the entry, then talk to Jacob.
Behind the scenes, photos upload to Google Drive and each submission is written to a Reimbursements worksheet in the shared Google Sheet. The sheet row includes a link to the photo location in Drive.
### 10.5 Offline Behavior
The Expenses screen works fully offline. Submissions are queued on your phone and sync automatically when you're back online; photos upload on reconnect. A submission sitting at "Pending sync" is normal when you have no signal; it will go through on its own.
## 11. SCHEDULING AVAILABILITY
Scheduling Availability is how crew tell the office which days they can work, two weeks at a time. It replaces texting Jacob your availability or hoping the schedule lines up with your calendar. It lives under the Tools tab → Availability.
### 11.1 How It Works
Availability is submitted in rolling 2-week windows. Each day in a window gets one of three statuses:
Available: you can be scheduled this day.
Unavailable: you cannot be scheduled this day.
Conditional: you can be scheduled with some restriction; use the day's note to explain (e.g. "available after 1pm").
Tap a day on the calendar grid to cycle it: available → unavailable → conditional → back to available. Every day in the window must be set before you can submit.
ONCE SUBMITTED, YOU'RE COMMITTED: If you're scheduled on a day you marked available, you're expected to work it, unless you're scheduled with 3 or fewer days' notice. Double check your selections before tapping Submit.
### 11.2 Submitting Your Availability
Open Scheduling Availability from the Profile tab. If you have availability due, the Submit tab opens directly to the next 14-day window that needs filling in.
Quick Fill
Above the calendar, seven day-of-week buttons (Sun–Sat) let you bulk-set both matching days in the window at once. Tap a day-of-week button to cycle its status and apply it to every matching day, for example, tap "Sat" once to mark both Saturdays in the window unavailable. This is the fastest way to fill in a window if your availability follows a weekly pattern.
Calendar Grid
Below Quick Fill, all 14 days display individually. Tap any single day to override it independently of the quick-fill pattern, useful for the one Tuesday you have a doctor's appointment in an otherwise normal week.
Notes
Each day can carry an optional note, useful whenever "available" or "conditional" needs context (e.g. "available after 1pm" or "need Friday off for an appointment"). Tap "+ note" under any day in the Notes card to add one.
Submitting
Once all 14 days are set, the Submit button activates. You'll see a confirmation step reminding you that days inside the next 2 weeks lock once submitted. After submitting, the next window opens automatically here once your submitted horizon drops below 2 weeks out; you don't need to remember to come back on a schedule.
### 11.3 Locked Days & Getting an Unlock
Once a window is submitted, any day inside it that falls within the next 2 weeks locks against further edits on your end; you'll see a lock icon on that day going forward. This protects the schedule the office is actively building around your submission.
Need to change a locked day? Contact the office. Jacob can grant a one-time unlock for a specific 14-day window, which reopens every day in that window for you to edit. Once the office confirms your updated submission, they'll typically revoke the unlock.
When a window has an active unlock, you'll see a banner explaining who granted it and why (if a reason was given), and the window reopens for editing on the Submit tab. Edit it like a normal window and resubmit.
### 11.4 Plan a Future Absence
Know about a vacation, family event, or anything else fixed on your calendar more than 2 weeks out? Use "+ Plan a future absence" at the top of the Submit tab to pre-submit a status for that stretch of dates right now, without waiting for the rolling window to reach it.
Pick a From and To date. The start date must be at least 14 days out; sooner dates go through your regular 2-week submission instead.
Pick the status that applies to every day in the range: available, unavailable, or conditional.
Add an optional note (e.g. "Hawaii vacation") that applies to every day in the range.
Submit. The range is recorded immediately; the office sees it on your calendar today, and you'll see it in your History tab.
Long ranges are capped at 100 days per submission; split anything longer into multiple submissions.
### 11.5 Scheduling Notes
Below the future-absence button, a collapsed "Scheduling notes" card holds one persistent freeform note per person, for ongoing constraints that don't fit neatly into a single day, like "no Saturdays until July" or "mornings only until the 15th." Tap to expand it, type your note, and it autosaves a couple seconds after you stop typing. This note is visible to admin alongside your availability at all times; it's a standing heads-up, separate from any single day's status or note.
### 11.6 History
The History tab shows every window you've already submitted, each as its own 14-day grid matching what you saw at submit time, including any notes. Use it to confirm what you sent in without having to remember it yourself.
### 11.7 Reminder Banner
If your submitted availability horizon drops below 2 weeks out, a banner drops down from the top of the app on every screen (except the Scheduling Availability page itself) reminding you to submit. Tap Open to jump straight to the Submit tab, or dismiss it for the rest of your session with the ✕. It reappears next session if you're still behind.
### 11.8 Offline Behavior
Filling in days, quick-fill, and notes all work offline; your in-progress draft is saved to your phone as you go. Submitting requires a connection. If you lose signal mid-edit, your draft is still there when you reconnect; just tap Submit once you're back online.
### 11.9 Admin: Unlocks & the Month View
Granting an Unlock
From the Employees tab, tap "Unlocks" next to any crew member to open their unlock manager. Pick the window-start date (the first day of the 14-day block you want reopened), optionally add a reason for your own records, and tap "Grant unlock." The crew member can then edit every day in that window regardless of the normal 2-week lock. Existing unlocks for that person are listed below, each with a Revoke button; revoke once they've resubmitted so the window goes back to locked.
Month Schedule View
Also under the Employees tab, the month-wide schedule view lays out every active crew member across the top and every day of the selected month down the side, color-coded by availability status. Use the arrows to move between months. Days where a crew member is actually scheduled on a Jobs-calendar event are called out distinctly, overlaying the availability color so you can see at a glance who's both available and booked, who's booked despite marking unavailable, and where the gaps are. Hovering or tapping a cell with a note shows it. Blank cells mean that crew member hasn't submitted availability for that day.
## 12. ESTIMATOR
The Estimator is an in-app moving estimate builder. Available to admin only.
### 12.1 Building an Estimate
Create a new estimate and enter customer info (name, origin, destination).
Add rooms.
For each room, search the furniture catalog and add items. Each item auto-fills weight and cubic footage.
Adjust quantities as needed.
Add optional photos per estimate.
Totals (lbs, cu ft) calculate live.
AUTOSAVE: The estimator autosaves every field change with a short delay. A status indicator shows Unsaved / Saving / Saved / Save failed. You do not need to tap a Save button.
### 12.2 Catalog Items vs Custom Items
Catalog items: Typeahead search pulls from the furniture catalog. Weight and volume auto-fill.
Custom items: Type any item not in the catalog. Enter weight and volume manually.
Catalog management: Admin can add/edit/delete catalog items.
### 12.3 Offline Estimator
Item adds queue offline and sync when network returns. Customer details and metadata autosave require network connectivity.
## 13. ADMIN FEATURES
Admin users have access to additional tabs and capabilities not visible to crew.
### 13.1 Employees Tab
Activate newly signed-up accounts.
Toggle admin role for users.
Deactivate departed crew.
Admins cannot modify their own record.
Tags: assign free-form labels (e.g. Driver, Has CC, Tier I) per employee. Manage the available tag list from Settings; see Section 13.7.
Skill rater: a per-person toggle that lets this employee rate crew skills on the Job Report (Section 7.7). The crew-lead tag does NOT grant this on its own; set the toggle explicitly. Designate raters before they need to rate a job, or the skill rows and the job-type picker will not appear for them.
Unlocks: grant a crew member a one-time exception to edit a locked Scheduling Availability window. See Section 11.3 and 11.9.
Emails: add alternate email addresses for a crew member, so a Google Calendar invite sent to a personal address still maps back to them in Crew Resources. See Section 13.8.
Month Schedule View: a month-wide grid of every active employee's submitted availability, overlaid with scheduled jobs. See Section 11.9 for details.
Desktop mode: a toggle in the Admin topbar widens every admin screen for easier viewing on a laptop or desktop monitor, useful for the Employees roster and Month Schedule View. Your preference is remembered on that device.
### 13.2 Map Tab
Shows today's geotagged timeline events on a live map. Crew do not see this tab. All crew locations logged during the day are operationally visible to admin.
### 13.3 DVIR Review
Lists all DVIRs with noted defects requiring mechanic sign-off. A "Show pending mechanic review only" filter narrows the list. There are two ways to clear a defective DVIR:
In-Person Sign-Off
Admin opens the DVIR, reviews the defects, and signs the mechanic portion directly on the device. Only admin users see the mechanic sign button. Once signed, the DVIR clears and the truck is cleared for use.
Remote Sign-Off by Emailed Link
When the mechanic isn't on hand, or doesn't have an app account, the admin can email them a sign-off link:
Open the DVIR in DVIR Review.
Enter the mechanic's email address (and optionally their name).
Send the request. The app emails a secure sign-off link scoped to that one DVIR.
The mechanic opens the link on any phone or computer, reviews the defect, and signs; no app account or login needed.
Once they sign, the DVIR clears exactly as an in-person sign-off would.
While a remote request is outstanding, the DVIR shows that a signature was requested and the email address it was sent to. If the email doesn't arrive, the request can be re-sent.
### 13.4 Office Hours Tab
The Office Hours tab is an admin-only panel for logging non-job office or shop time, hours not tied to a customer job.
Logging an Entry
Date:  The day worked.
Clock in:  Start time.
Clock out:  End time.
Breaks / clocked-out time:  Add any number of break periods, each entered as its own start/end pair (tap "+ Add break"). This mirrors the Report tab's employee-hours editor.
Notes:  Optional.
Net hours are calculated automatically; the app shows the worked total (span minus break time). You do not type the total yourself. Existing entries are listed below the form, each with Edit and Delete buttons. The panel works offline; entries queue and show a "pending sync" count until they upload. Office hours land in their own worksheet in the Google Sheet.
### 13.5 Job Summary
The primary admin review surface. Search by date and customer name to pull a full per-job report on one page: full timeline of events, materials logged, employee hours with skill ratings, DVIRs, incidents (with photo links), actual inventory, the Digital Bill of Lading, long-distance per-diem and drive days, reimbursements, the bill with computed total, photos, and admin notes. When two crew work the same job they are grouped here automatically. A copy-paste invoice block gives the office a plain-text summary for invoicing software.
### 13.6 Patch Notes & Admin Notes
This tab (labeled Patch Notes) publishes two different things:
Patch Notes: a titled update note the crew see the next time they open the app. Use it to announce new features. These are the notes previewed at the bottom of every crew member's Profile tab.
Admin Notes, of two kinds:
Global notes: Appear as a banner on every crew member's home screen.
Per-job notes: Appear only when that specific job is selected. Use these for job-specific instructions, e.g., "customer has a piano on the second floor."
### 13.7 Settings
Shared configuration for all crew devices; a change here applies everywhere on next load. The Settings tab holds:
Theme & Appearance: opens as its own sub-page with every look-and-feel control: color preset, font, button shape, button background/size, logo variant, and pin colors. Save your current look as a named custom preset and apply it to all users with one tap.
DVIR unit list: add, edit, or remove vehicles from the DVIR dropdown.
Employee Tags: manage the free-form tag list used across the roster and the availability digest.
Job Types: configure the job-type tags crew pick from on the Job Report (Section 7.5).
Crew Skills: the skills registry. Define each skill, mark it core (rated on every job) or job-specific, choose which job types it applies to, and keep a per-employee skill matrix.
Furniture Catalogue: import and export the shared catalogue as a CSV, with item dimensions and custom fields. One catalogue feeds the Estimator, the actual-inventory tool, and the BOL item pickers.
Help text overrides: customize the help text for any UI field.
Pin colors: color each event type differently on the map (under Theme & Appearance).
### 13.8 Advanced Settings
Google Calendar OAuth: Upload/replace the OAuth token that powers the calendar job picker. Takes effect right away.
Data Management: on-device housekeeping for the current admin's phone (clear local caches and queues). Does not touch server data.
Sheet sync refresh: Advanced Settings → Sheet Sync → "Refresh sheet from app data." Re-sends anything that reached the app but missed the shared Google Sheet (events and signed BOLs), due to a Google API blip or a background task that did not finish. Safe to run any time; the app also runs this check automatically in the background.
System Check: a one-tap health snapshot. It confirms the database, the Google Sheets connection, the Google Drive connection, and required settings are all working; checks that every app-to-sheet sync is pointed at the right worksheet; and flags any records that have drifted out of the sheet (events or signed BOLs). Copy and paste the output into a support message.
Crew Resources Events
Crew Resources is a backend integration that automatically posts a daily "Crew Resources" event to a dedicated Resources calendar in Google Calendar, summarizing who's available that day (grouped by tag and calling out crew leads) alongside who's already scheduled on the Jobs calendar. It runs hourly in the background once enabled, so admin doesn't normally need to touch it. The "Generate / refresh" button here forces an immediate refresh for today through a chosen number of days ahead, useful for confirming the wiring is working or seeding the next batch right away.
Diagnostics
A collapsed card at the bottom of Advanced Settings holds read-only checks for integrations that are wired through environment variables or OAuth, currently the Crew Resources calendar wiring. Open it when a feature looks set up but isn't behaving as expected.
### 13.9 Incidents
The Incidents tab is the log of every incident the crew report from the field (Section 8.4). Each carries an automatic claim number and links to its photos. From here admin records an estimated cost, adds notes, and marks the incident resolved. A filter hides resolved incidents when you only want the open ones.
## 14. TROUBLESHOOTING
Sorted by most common issues first. If something isn't listed here, text Jacob.
### 14.1 Installation Issues
"Add to Home Screen" not appearing on iPhone
Cause:  Using Chrome or another browser instead of Safari.
Fix:  Copy the URL and open it in Safari. iPhone only supports PWA install via Safari.
App not loading on first open
Cause:  No internet connection on first visit.
Fix:  Connect to WiFi or cellular, then open the app. After first load it works offline.
App icon missing after install
Cause:  Install step was skipped or incomplete.
Fix:  Repeat the install steps for your device.
App looks outdated after an update
Cause:  Browser cached an old version.
Fix:  Tap "Update app to latest version" on the Profile tab. If that doesn't help: on iPhone close the tab fully and reopen in Safari; on Android, hold refresh and select Hard Reload.
### 14.2 Login & Account Issues
"Invalid or expired reset link"
Cause:  Link timed out (15 min limit) or was sent from a different environment.
Fix:  Request a new reset link. Don't reuse old ones.
Can't log in after signing up
Cause:  Account not yet activated by admin.
Fix:  Text Jacob so he can activate your account.
Logged out unexpectedly
Cause:  Session expired or another device triggered sign-out.
Fix:  Log back in normally. No data is lost.
"You don't have permission"
Cause:  Account exists but admin role is needed for that action.
Fix:  Contact Jacob to update your role if appropriate.
### 14.3 Calendar & Job Issues
Calendar dropdown is empty or won't load
Cause:  No signal, or OAuth token expired.
Fix:  Use manual entry. If this persists on signal, tell Jacob; may need OAuth refresh.
Two crew on the same job logging to separate records
Cause:  Each used manual entry and typed the job name before the other crew member's entry showed up in their dropdown, or one crew member typed a name that didn't exactly match what's now listed.
Fix:  The manual-entry dropdown now shows other crew's entries for that date; whoever is second should check the dropdown for a matching entry before typing a new one. If two records were already created, both crew should re-select the correct entry when back online, or admin can reconcile in Job Summary.
Job not appearing in calendar dropdown
Cause:  Job not added to Google Calendar, or wrong date selected.
Fix:  Check the date picker. If job is missing entirely, tell Jacob.
### 14.4 Timeline Issues
Events not appearing after logging them
Cause:  Offline, events are queued.
Fix:  Normal. They will sync when signal returns. Check the queue indicator.
Time on an event is wrong
Cause:  Forgot to tap, or phone clock was off.
Fix:  Tap the time on the event to edit it. Limit: 7 days back, 5 min forward.
Note I added isn't showing on another device
Cause:  Sync gap or device hasn't refreshed.
Fix:  Pull to refresh or navigate away and back to the Timeline tab.
Events from yesterday showing under today
Cause:  Old timezone bug.
Fix:  Update the app from the Profile tab. All times now display in Mountain.
### 14.5 Scheduling Availability Issues
Can't submit: some days won't fill in
Cause:  One or more days in the window are locked from a prior submission, or the window still has unset days.
Fix:  Check for a lock icon on any day; locked days need an office unlock to change (Section 11.3). Otherwise, tap through every remaining day until none are unset.
Reminder banner won't go away
Cause:  Your submitted availability horizon is still less than 2 weeks out, or you dismissed it but it reappeared next session.
Fix:  Submit the next window from the Submit tab. Dismissing only hides the banner for your current session; it returns next time if you're still behind.
Submitted the wrong status for a day
Cause:  A day was set incorrectly before submitting.
Fix:  If the window hasn't locked yet, reopen it from the Submit tab and correct it. If it's already locked, contact the office for an unlock.
Quick-fill button didn't change a day I expected
Cause:  That specific day was locked, so quick-fill skipped it by design.
Fix:  Locked days never change from quick-fill or the calendar grid. Contact the office for an unlock if it needs to change.
Future absence submission rejected
Cause:  The start date was less than 14 days out, the end date was before the start date, or the range exceeded 100 days.
Fix:  Use your regular 2-week submission for anything inside 14 days. For longer stretches, split into multiple submissions of 100 days or fewer.
### 14.6 DVIR Issues
DVIR reminder keeps popping
Cause:  No DVIR filed for the vehicle today.
Fix:  Complete the DVIR or select the appropriate multi-job option to dismiss.
My truck isn't in the vehicle dropdown
Cause:  Vehicle not added to unit list by admin.
Fix:  Tell Jacob; he adds vehicles in Advanced Settings.
Mechanic sign button not visible on a DVIR
Cause:  You are not an admin.
Fix:  Only admins can sign the mechanic portion, or email a remote sign-off link. Contact Jacob.
Mechanic didn't get the emailed sign-off link
Cause:  Email delayed, wrong address, or filtered to spam.
Fix:  Have the mechanic check spam. Confirm the email address and re-send from DVIR Review. If it still doesn't arrive, tell Jacob; the link is also recoverable from the server logs.
DVIR submitted but no confirmation
Cause:  Likely offline, queued for sync.
Fix:  It will sync on reconnect. Do not re-submit unless you're certain it failed.
Signature drawing way off from finger
Cause:  Old DPI bug on high-res screens.
Fix:  Update the app from the Profile tab to get the latest version.
### 14.7 Materials Issues
Added material not showing up
Cause:  Offline, queued for sync.
Fix:  Normal. Pull to refresh when back on signal.
Removed material still shows in bill
Cause:  Sync lag.
Fix:  Pull to refresh or re-open the Bill tab. Admin sheet reconciles automatically.
Qty field snapping back to 1
Cause:  Old bug, since fixed.
Fix:  Update the app from the Profile tab to get the latest version.
### 14.8 Photo Issues
Photo stuck on "uploading"
Cause:  Offline, queued.
Fix:  Leave it. It uploads automatically on reconnect. Don't tap retry repeatedly.
Photo upload shows "Session expired"
Cause:  Your login token expired or was revoked.
Fix:  Log out and sign back in, then retry the photo.
"Photo too large to upload"
Cause:  The file exceeds the server's 100 MB limit. Rare; almost all phone photos compress well under this.
Fix:  Take a new photo instead of uploading an unusually large file from your library.
"Server error" on photo upload
Cause:  A temporary server-side hiccup.
Fix:  Wait a moment and try again. If it keeps happening, tell Jacob.
Photo uploaded but not visible to other crew
Cause:  Sync delay or other device hasn't refreshed.
Fix:  Pull to refresh on the other device.
### 14.9 Bill & Report Issues
Submit button is greyed out
Cause:  Bill has not been marked reviewed.
Fix:  Open the Bill section, review line items, and check the "Reviewed" box.
Labor hours in bill seem off
Cause:  Missing Start or Finish event, or Employee Hours hasn't been filled in for that person yet (the auto-generated labor line waits on that entry).
Fix:  Check the Timeline and correct any missing events using the time editor. Add or correct the person's entry in Employee Hours (Section 7.4); their labor line updates to match.
Bill missing materials I logged
Cause:  Sync lag.
Fix:  Pull to refresh. Materials auto-populate from the Materials tab.
Skill rating rows (or the job-type picker) don't show for me
Cause:  You are not a designated Skill rater. The crew-lead tag does not grant this on its own.
Fix:  Ask admin to turn on your Skill rater toggle (Employees, Section 13.1). Admins and designated raters see the skill rows.
A truck I added isn't on the bill
Cause:  A truck adds its "Truck (per hour)" line once it is recorded in Truck fullness, and a rental truck must have a name.
Fix:  Add the truck in Truck fullness (Section 7.6); name any rental. Its per-hour line then appears in the bill.
### 14.10 Expenses & Reimbursement Issues
My submission is stuck on "Pending sync"
Cause:  Offline, the submission is queued on your phone.
Fix:  Normal. It syncs automatically when you're back on signal. Don't re-submit.
"Add at least one detail or photo before submitting"
Cause:  The form was completely empty.
Fix:  Enter at least one field or attach a photo. Partial submissions are fine, just not blank ones.
"End odometer can't be lower than the start odometer"
Cause:  The end reading entered is smaller than the start reading.
Fix:  Re-check both odometer numbers and correct the entry.
I paid on the company card, do I get reimbursed?
Cause:  Company-card expenses are log-only.
Fix:  Choose "Company card" under "Paid with." It records the purchase but does not request reimbursement.
Submission shows "Rejected"
Cause:  Admin reviewed and declined the request.
Fix:  Check the "Admin: …" note under the entry, then talk to Jacob.
### 14.11 Digital Bill of Lading Issues  NEW
Can't sign: button stays disabled
Cause:  The form is missing something signing requires: at least one inventory item, the client's printed name, either signature, or the electronic-signature consent checkbox.
Fix:  Check for the specific error message above the sign button; it names exactly what's missing.
Don't see the Inventory tab on a long-distance job
Cause:  Today's day-plan on the Timeline doesn't include Loading or Unloading.
Fix:  Reopen the day-plan prompt and add Loading or Unloading for today; the Inventory tab appears once one of those is selected.
Two crew building the same BOL don't see each other's items
Cause:  The BOL list hasn't refreshed on one device.
Fix:  Switch back to the app or pull to refresh; the inventory reloads from the server on focus. Both crew should be opening the same open BOL for the job, not starting a second one.
Client didn't get their copy of the signed BOL
Cause:  The share sheet was dismissed, or the download went to a folder that isn't obvious on that phone.
Fix:  Reopen the BOL; once a phase is signed, a "Download a copy" button is always available to re-send or re-download the PDF.
### 14.12 App Performance & General
App seems out of date / missing new features
Cause:  Browser cached an old version.
Fix:  Tap "Update app to latest version" on the Profile tab. If needed, hard-refresh: on iPhone close the tab fully and reopen; on Android hold refresh and select "Hard Reload."
Page auto-zooms when tapping inputs on iPhone
Cause:  Old font size bug.
Fix:  Update the app from the Profile tab to get the latest version.
App slow or unresponsive
Cause:  Low memory on older device, or large local log.
Fix:  Close other browser tabs. If persistent, log out and back in.
Admin notes not updating
Cause:  Cached from last fetch.
Fix:  Pull to refresh on the home screen.
### 14.13 Admin: Sheet Sync Issues
Event in app but missing from sheet
Cause:  Google API blip during export.
Fix:  The background check usually re-sends within a few minutes. To force it: Advanced Settings → Sheet Sync → "Refresh sheet from app data." Run System Check on the same page to confirm nothing is still drifting.
A signed BOL is not in the sheet or the signed-PDF Drive folder
Cause:  It was signed offline, or the phone was handed off before it finished sending.
Fix:  It is kept on the crew device and delivered when it can send; the background check also re-sends it. Confirm with System Check (Sheet drift - BOLs). If it persists, send Jacob the System Check output.
Duplicate rows in a sheet tab
Cause:  Old estimator bug, since fixed.
Fix:  Duplicates were cleaned up. If new duplicates appear, contact Jacob.
Sheet rows out of order
Cause:  Expected behavior: newest events write at the top, under the header.
Fix:  None needed. Older rows below are historical.
## 15. QUICK REFERENCE
### 15.1 Job Day Checklist

| Step | Action | Who |
|---|---|---|
| 1 | Pick job from calendar (while online) | All crew |
| 2 | Complete pre-trip DVIR | Driver |
| 3 | Complete Prior On-Duty Hours Statement (interstate only) | Driver |
| 4 | Tap START when leaving dispatch | All crew |
| 5 | Tap Arrive at every stop | All crew |
| 6 | Log materials as used | All crew |
| 7 | Take photos | All crew |
| 8 | Tap Depart at every stop | All crew |
| 9 | Tap FINISH when returning to dispatch | All crew |
| 10 | Complete post-trip DVIR (end of last job) | Driver |
| 11 | Submit RODS (interstate only) | Driver |
| 12 | Sign Bill of Lading at origin and destination (interstate only) | Crew rep + client |
| 13 | Fill out Job Report | Crew lead |
| 14 | Review and submit Bill | Crew lead |

### 15.2 Key Contacts
Jacob, management@mountaineermoving.comFor: All app issues, account activation, DVIR clearance, interstate form questions, expense / reimbursement review.App URL: mountaineer-crew-app-two.vercel.app
About This Guide
This is the Version 2.3 guide, July 2026. It reflects the crew app through the v1.8 feature batch, the biggest yet. New for the crew: incident reporting from the Photos tab with automatic claim numbers (Section 8.4); actual inventory on long-distance jobs with pack types (CP / PBO / N/A), a shared catalogue search, and a chow-volume estimate (Section 3.3); job types, truck fullness, skill ratings, and a wrap-up finish-time / return-trip estimator on the Job Report (Sections 7.5-7.8); off-job hours and a personal Worked Hours view on Profile (Section 2.5); and a "Truck (per hour)" bill line per truck (Section 7.1). New for admin: the Incident log (13.9), the Skills registry and Job Types list, the shared Furniture Catalogue import/export, the Skill rater designation (13.1), an expanded Job Summary (13.5), and a unified System Check that also flags signed BOLs missing from the sheet (13.8). Reliability: signed BOLs now always reach the office sheet and the signed-PDF Drive folder, with a background check that re-sends anything missed. The estimator remains a quoting tool and is not linked to crew-app jobs. The prior edition, Guide Edition 1.8, reflected the crew app through the v1.7 update, which added the Digital Bill of Lading (Section 3.3): built and signed in the field at origin and destination, delivered to the client as a PDF even offline, and fed by a new Inventory tab on long-distance load/unload days. That update also made manual job entries visible across devices on the same date (Section 4.1) so crew no longer create duplicate job records by typing slightly different names, added a roster typeahead to name fields in Employee Hours and RODS, moved Bill labor lines to auto-generate per crew member from Employee Hours (Section 7.1), and split the Prior On-Duty Hours Statement onto a per-driver basis for multi-driver trips (Section 3.2). The edition before that, Guide Edition 1.7, reflected the app through the v1.6 update, which added Scheduling Availability (Section 11) along with Plan a Future Absence and persistent Scheduling Notes, an Employee Hours editor and Crew Feedback on the Job Report, a job-wide Job Notes field on the Timeline, date fields and photo-library support on Expense / Reimbursement submissions, automatic in-app update alerts, a restructured Profile tab (My Profile, Tools & Resources, Patch Notes preview), and admin tools for availability unlocks, the month-wide schedule view, employee tags, email aliases, desktop mode, and the Crew Resources calendar integration. The app's release version is now shown as a number (currently 2.3); each build also carries a two-word name (e.g. "Brave Otter") and a build ID on the Profile tab.