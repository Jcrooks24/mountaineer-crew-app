# Sanity check - Photos and incidents (area 8)

Date: 2026-09-11
Branch: `staging` @ `8ea7713`
Surfaces: photo capture in `App.tsx` (Photos tab), `IncidentReport`,
`IncidentsAdminTab`, `drive_upload.py`

Run because the photo tool was reworked this session
([ADR 0048](../decisions/0048-a-photo-is-durable-when-it-is-taken-not-when-it-is-saved.md)),
and the repo's rule is that a change like that is not done until a sanity pass has
run and the owner has ruled on the findings.

## 1. Tool and stated job

From [CREW_GUIDE.md](../CREW_GUIDE.md):

> "Document jobs with photos. Storage is per-job in Google Drive." (line 352)
>
> "Use the Photos tab to document the job. Caption your photos when relevant
> (fragile items, pre-existing damage, company-caused damage)." (line 224)

And from the owner, 2026-09-11: "damage photos are what a claim rests on."

Those agree, and together they set a higher bar than "document the job": if a
claim rests on these, the tool's real job is **to make sure a photo that was taken
survives to somewhere the office can find it**. Most findings below are measured
against that sentence rather than against the guide's.

## 2. Scenario map

| Scenario | Answered by | Verdict |
|---|---|---|
| Document a job before and after | Photo type pills (Before / After / General) | covered, but see F3 |
| Document damage for a claim | Incident, with photos attached to its claim number | covered |
| No signal for the whole job | Local store, drain on reconnect | covered |
| The file handle dies before Save | Draft written at pick (ADR 0048) | **covered as of this session** |
| Phone killed the tab mid-batch | Drafts restored per job | covered as of this session |
| Photos picked on job A, saved on job B | `job_uuid` stamped at pick | covered as of this session |
| Wrong photo taken, remove before saving | Remove / Clear in the tray | covered |
| Wrong photo noticed after it uploaded | Delete button | **gap, F2. It does not delete** |
| Two jobs, same customer name, same date | Drive folder by name + date | **ambiguous, F4. They share a folder** |
| Teammate's photos on the same job | `serverPhotos`, manual Refresh | covered |
| A receipt photo, same failure mode | Reimbursement screen | **gap, F1. Still reads at submit** |
| Brand new person, never seen the screen | Type defaults to General and sticks | ambiguous, F3 |

The category is wider than the Photos tab. Eight surfaces in the app take a
picture: Photos, BOL item photos, Estimator, Reimbursement, Bulletin, Profile,
Report Bug, Request Feature. Of the ones that queue offline, **Estimator
(`EstimatorTab.tsx:1599`) and BOL (`bolStore.ts:1289`) already read bytes at pick**
and were never exposed to this defect class. Photos was fixed today. Reimbursement
was not.

## 3. Friction count

Common path, app already open on the job: Photos tab (1) then Take Photo (1) then
shutter (1) then Use Photo (1) then Save (1) = **5 taps, 0 typed characters**. The
note is optional and the type pills default to General, so a crew member can
document a job without typing anything. That is about as low as this can go, and
it is not a finding.

## 4. Findings

| # | Q | Severity | Finding | Evidence | Suggested direction |
|---|---|---|---|---|---|
| F1 | Q2, Q6 | **High** | Reimbursement still reads picked files at submit, the exact defect class just fixed in Photos. A dead handle throws before the row is enqueued, so nothing queues and the crew member sees the raw browser `NotReadableError` text. Milder than Photos was, because the form is not cleared, but retrying can never succeed and nothing tells them to re-take the receipt. A receipt is money. | `pages/Reimbursement.tsx:187-188` (odometer) and `:235` (receipt): `await toQueuedPhoto(file)` is evaluated inline in the `enqueue*({...})` argument, so it throws before the call happens | Read at pick, using the shape `EstimatorTab.tsx:1599` already uses |
| F2 | Q1, Q4 | **High** | Delete does not delete an uploaded photo, and the photo returns with no Delete button at all. The handler removes only the local IndexedDB row; the file stays in Drive and in Postgres. `refreshPhotos` is local-only, so it looks like it worked. On the next Refresh or job re-select the photo comes back as a server-only card, and that card renders Add note and View in Drive but no Delete. The confirm says "Delete this photo?", which is not what happens. | `App.tsx:2067` (`onDeletePhoto` calls `deletePhoto` and `refreshPhotos` only); server-only card at `App.tsx:3429-3439` | Queue a server DELETE, or rename it "Remove from this phone" and say so in the confirm. Worth deciding separately whether crew should be able to delete an uploaded claim photo at all |
| F3 | Q7 | Med | Photo type is per-batch and sticky. It defaults to General and is never reset after a save, so tagging a batch Before, saving, then shooting the after photos files them as Before unless the crew member notices the pill. The incident attach target has the same shape and resets only on a job change. | `App.tsx:559` (`useState("general")`), no reset in `onSaveAllPending`; attach target reset at `App.tsx:1662` is keyed on `jobUuid` only | Reset to General after a save, or move the type onto each photo in the tray |
| F4 | Q6 | Med | Drive folders are keyed by job **name plus date**, not `job_uuid`. Two jobs for the same customer name on the same date write into one folder. The app is careful about `job_uuid` everywhere else, and this is the layer the office actually browses. | `backend/app/integrations/drive_upload.py:153` (`<job_name> - <job_date> /`) and `:177` | Append a short `job_uuid` segment to the folder label. It would rename future folders only, not existing ones |
| F5 | Q7 | Med | "Uploading…" is shown to a crew member with no signal, next to a Retry button, while the crew guide tells them that state means they are offline and not to retry. The state turns only on `drive_status === "pending"`, with no `navigator.onLine` check. | pending branch of the saved gallery in `App.tsx`; [CREW_GUIDE.md](../CREW_GUIDE.md) lines 226 and 359 | Say "Waiting for signal" when offline and hide Retry then. It would also let two lines come out of the crew guide |
| F6 | Q7 | Low | "Preview unavailable on this device" does not say whether the photo will still upload. It is a correct guard against a broken-image icon, but it leaves the crew member unable to tell a cosmetic problem from a lost photo. | saved gallery placeholder branch, `App.tsx` | Add "The photo will still upload" when `drive_status` is not `failed` |

## 5. Verified good

- **Offline behavior is real.** Photos store locally first and drain on boot, on
  `online`, and on an `isOnline` flip, guarded by `drainingPhotosRef`, stopping
  mid-batch rather than marking everything failed
  (`App.tsx::drainPendingPhotos`).
- **Identity flows on `job_uuid`** through the client and the API. The one place
  it does not is the Drive folder label, which is F4.
- **Incident photos carry their claim number** into the card and into the admin
  Incidents tab, and the server unions the authoritative `photos.incident_uuid`
  with the client snapshot rather than trusting the snapshot.
- **Captions are handled carefully**, with the local-copy versus server-only split
  and the 404-versus-500 distinction an earlier pass earned.
- **Beta subtext is correct.** `multiPhoto` is in `BETA_FEATURES` and the PHOTOS
  header renders the tag.
- **The saved gallery does not revoke preview URLs on load**, which is a real bug
  somebody already fixed, and the comment at the site explains why.
- **Delete on a not-yet-uploaded photo works properly.** That is the case the
  confirm was actually written for.

## 6. Needs a human look

Not driveable from here. One look each, on a real phone:

1. **Force-quit the app with photos in the tray**, reopen, select the same job.
   The tray should come back with the photos in it. This is new today.
2. **Take a photo, tag it Before, fail it with airplane mode, then reconnect.**
   The saved card should still read Before after the retry. Before today it came
   back General.
3. **On a 390px screen**, does the new "already stored on this phone" line read as
   reassurance, or as clutter above the type pills?
4. **Pick photos on one job, switch jobs without saving.** The tray should empty
   and refill with the second job's own drafts, not carry the first job's across.

## 7. Unverified from here

- Whether any Drive folder collision (F4) has actually happened in the live
  folder. Needs someone to look in `Mountaineer Crew Photos` for two same-named
  jobs on one date.
- Whether real phone photos ever approach the 100 MB body limit. The crew guide
  says they do not; nothing has measured it.
- How often the handle actually dies in the field. The fix removes the window
  rather than measuring it, and nothing counts occurrences.
- Whether unsaved drafts accumulate on devices in practice. There is no reaping
  and no telemetry.

---

**Nothing was changed in this pass.** Six findings, none of them blocking the work
already committed. F1 and F2 are the two worth opening as work; say the word and
they go through Batch mode in the debugging protocol, per-item approval first.
