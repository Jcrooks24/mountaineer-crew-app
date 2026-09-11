# 0048 - A photo is durable when it is taken, not when Save is pressed

Date: 2026-09-11
Status: Accepted

**Driving scenario:** The owner sent a screenshot of the Photos card on a job,
2026-09-11. Under the Take Photo and Add from Library buttons sat a red line:
"The requested file could not be read, typically due to permission problems that
have occurred after a reference to a file was acquired." A crew member had added
photos to a job, pressed Save, and got an error they could not act on. The photo
was gone: not in the tray, not in Saved, no Retry button. The exact sequence that
led to it was not captured. A lost job photo is not recoverable later, and damage
photos are what a claim rests on.

**User classes affected:** Mover and Crew lead, who take the photos and are the
only people holding a copy until it uploads. Admin indirectly and severely: a
destroyed damage photo is a claim with no evidence, and nothing in the office
surfaces that a photo was ever attempted, so the absence is invisible from that
side. The photo path is shared with incident photos, which by design exist on
exactly one phone.

**Assumption this rests on:** That the picked `File` handle is reliably readable
at the moment the pick handler runs, and only becomes unreadable later. If reads
start failing at pick time too, this is the wrong layer and the answer moves into
the capture itself rather than into when we read it.

## Context

[ADR 0017](0017-offline-queues-store-bytes-not-file-handles.md) established that
a queued photo must hold bytes, never a `File`, because a handle persisted across
a reload can go stale and a stale handle uploads an empty body rather than
failing. That was correct and remains correct. What it did not settle was *when*
the bytes get read.

They were read at Save. `uploadOnePhoto` built the row for IndexedDB with
`blob: await toQueuedPhoto(file)` inline in the object literal, and
`toQueuedPhoto` calls `file.arrayBuffer()` with no guard. A picked file off an
Android camera input is a reference to a temp file the OS owns, and Android
reclaims it when the app is backgrounded or memory runs short. When that read
threw, it threw *before* `addPhoto(stored)`, so nothing was ever persisted.
`onSaveAllPending` caught it into `lastErr` and then cleared the tray
unconditionally.

Three things therefore had to be true at once for the photo to survive: the
handle had to still be alive, the crew member had to have pressed Save, and the
network was irrelevant. The first was outside our control and outside theirs.

The failure was also maximally unhelpful. The message was the browser's raw
`NotReadableError` string, which names a permission problem that is not the
cause. There was no row to retry because no row was created. And the tray had
already been emptied, so the crew member could not even see which photo they had
lost.

## Decision

**The bytes are read and written to IndexedDB in the pick handler, as a draft
row.** Save no longer reads a `File`; it writes the crew member's caption,
category and incident tag onto the stored row, flips `draft` off, and hands it to
the uploader. The window between a photo existing and a photo being durable is
now a few milliseconds inside one event handler, instead of an unbounded stretch
of wall-clock time that includes the phone being pocketed.

**A draft is invisible to every existing reader.** `listPhotosForJob` filters
drafts out at the store, not at the call sites, so the saved gallery, the upload
drain, the estimator and the BOL cannot surface a half-finished photo. Drafts are
reachable only through `listDraftPhotosForJob`, which the pending tray owns.

**The tray keeps its current meaning.** Photos still sit in it with their caption
boxes and a Save button, and still appear in Saved only after Save. Crews were not
retrained; the durability is plumbing they do not see. The one visible change is a
line telling them the photos are already on the phone, and a confirm on Clear,
which now destroys stored data rather than discarding a list.

**A read that fails at pick time is reported and the photo is not added.** There
is nothing to save in that case, so adding a row that can never upload would only
move the dead end further down the line.

### What this also fixed, because it fell out of the design

- **Photos no longer follow you to another job.** `job_uuid` is stamped at pick
  time. Save used to read the then-current `jobUuid`, so picking photos on one job
  and switching to another before saving filed them under the second job. That is
  a direct violation of the unique-key invariant and nobody had reported it.
- **The tray survives a reload.** Drafts are restored per job on mount and on job
  change. A phone that killed the tab mid-batch no longer loses the batch.
- **A retried photo keeps its Before/After tag.** There were two upload code
  paths, `uploadOnePhoto` for a fresh save and `pushPhotoToDrive` for the drain,
  and only the first sent `category`. A photo tagged Before that failed its first
  upload came back General on retry. Collapsing Save onto the drain's uploader
  removed the duplicate and the drift with it.

## Consequences

Drafts accumulate on the device if a crew member picks photos and never saves or
clears them. They are not invisible: they reappear in that job's tray every time
the job is selected. There is no age-based reaping, and if these turn out to pile
up in practice that is the next thing to add.

The preview still comes from the `File`, not from the stored bytes, because a
memory-backed object URL for every photo in a batch would hold the whole batch in
RAM on a phone. So a handle that dies mid-tray breaks the thumbnail. The photo
behind it is safe, which is the trade being made deliberately: a broken thumbnail
is a cosmetic problem and a destroyed photo is not.

Restored drafts do read their bytes for the preview, since they have no `File`.
Only unsaved photos that outlived a reload pay that cost.
