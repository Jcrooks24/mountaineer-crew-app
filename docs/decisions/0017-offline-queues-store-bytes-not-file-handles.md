# 0017. An offline queue stores the bytes, never a File handle

**Status:** Active. Fixed in `reimbursementStore` and the job-photo queue 2026-07-14.

## Context

A `File` from an `<input type="file">` is **not the image**. It is a reference to a
file on disk, plus a promise that the bytes can be fetched from it later.

Both offline queues took that File and put it straight into IndexedDB:

```ts
blob: file,              // photoStore, via App.tsx
receipt_blob: receiptFile,   // reimbursementStore
```

That is fine for a queue that drains in the next second. Ours does not. It is an
offline-first queue: the entry sits on the phone across reloads, app restarts, and
days without signal, and only then does it upload. By the time it drains, the
reference can be dead. iOS/WebKit in particular will reclaim or move the backing
file, and the File object survives while the thing it points at does not.

**And a dead File does not fail loudly.** This is the whole reason it was hard to
find. Appending it to `FormData` and calling `fetch` does not throw. The request
goes out with a body that never serialises, so the server receives an empty body,
and then every single form field looks absent. FastAPI reports the only field
without a default:

```
[422] POST /api/reimbursements/expense rejected: body.reimbursement_uuid: Field required
```

Which reads as *"the client forgot to send an id"* about a client that
demonstrably appends that id, unconditionally, as the first line of the form.
Days were spent staring at code that was correct. The bug was one layer down, in
what the queued value actually *was*.

It also repeats forever, which makes it look like a server bug: the crew member
retries, the same dead reference produces the same empty body, and the same 422
comes back. Nothing heals, because nothing on the server side was ever wrong.

## Decision

**A queue stores the bytes. It never stores a handle to something outside itself.**

At enqueue, while the File is still live, read it:

```ts
export async function toQueuedPhoto(file: File | Blob | null): Promise<QueuedPhoto | null> {
  if (!file) return null;
  const bytes = await file.arrayBuffer();
  return { bytes, type: file.type || "image/jpeg" };
}
```

Structured clone stores an `ArrayBuffer` as real bytes, so it survives a reload. At
drain, rebuild a `Blob` from them. A queued submission is then self-contained: once
it is in the queue it depends on nothing but itself.

**And when a photo cannot be read, say so.** Legacy entries still hold a File, so
`slotToBlob()` forces it to materialise and throws `UnreadablePhotoError` if it is
dead or reads back empty. The entry is marked failed with words a crew member can
act on ("the photo can no longer be read from this phone, the rest of the claim is
safe, retake it") rather than being posted as an empty body. Per
[ADR 0013](0013-rejected-queue-work-is-never-deleted.md) the claim itself is kept.

## Consequences

- Queuing a photo now costs a copy of the image in memory and in IndexedDB. That
  is the price of the thing being reliable, and it is the same order of magnitude
  as the file already was.
- Entries queued before this change still hold a File. They are handled, not
  abandoned: a healthy one still uploads, a dead one now produces a clear message
  instead of a mystifying 422.
- **The 422 handler logs `content-type` and `content-length`** (`app/main.py`).
  Keep it. "A required form field is missing" has two very different causes, and
  the field name alone cannot tell them apart: the client omitted it, or the body
  never parsed and *every* field looks missing. The content-length is what
  distinguishes them, and its absence is what made this take as long as it did.

## What would break if you undid this

Storing the File back "to avoid copying the bytes" reintroduces a silent,
unfixable-by-retry data loss on exactly the devices the crew use, with an error
message that points at the wrong layer. If you find yourself optimising this
allocation away, you are about to spend a week debugging a 422 that names a field
your code provably sends.
