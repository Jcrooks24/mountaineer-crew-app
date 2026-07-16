/**
 * Photos held in an offline queue, stored as BYTES.
 *
 * See ADR 0017. The short version, because it cost us a week:
 *
 * A `File` from an <input> is not the image. It is a reference to a file on disk.
 * A `Blob` produced from one (or restored from IndexedDB) can be file-backed too.
 * Our queues persist these across reloads, app restarts, and days without signal,
 * and only then upload them. By then the reference can be dead.
 *
 * A dead reference does NOT fail loudly. Appending it to FormData and calling
 * fetch does not throw: the request goes out with a body that never serialises,
 * the server receives an empty body, and every form field then looks absent. The
 * API reports the one field that has no default - `reimbursement_uuid`, `photo_id`
 * - and the error names a field the client provably sent. It repeats forever,
 * because nothing about a dead handle heals.
 *
 * So: read the bytes once, at enqueue, while the handle is still live. Structured
 * clone stores an ArrayBuffer as real bytes. A queued photo then depends on
 * nothing outside itself.
 */

/** A photo stored as its own bytes. Self-contained; survives a reload. */
export type QueuedPhoto = {
  bytes: ArrayBuffer;
  type: string; // mime, e.g. "image/jpeg"
};

/**
 * A photo slot in a queue. `QueuedPhoto` is what we write now; a raw `Blob`/`File`
 * is what LEGACY entries (queued before this change) still hold, and those are
 * read back defensively rather than abandoned.
 */
export type PhotoSlot = QueuedPhoto | Blob | null | undefined;

/** Thrown when a photo's bytes cannot be recovered. Never retried automatically. */
export class UnreadablePhotoError extends Error {}

/** Read a picked File into bytes at ENQUEUE time, while it is still valid. */
export async function toQueuedPhoto(
  file: File | Blob | null | undefined,
): Promise<QueuedPhoto | null> {
  if (!file) return null;
  const bytes = await file.arrayBuffer();
  return { bytes, type: file.type || "image/jpeg" };
}

/**
 * Turn a stored slot back into an uploadable Blob.
 *
 * Throws `UnreadablePhotoError` when the bytes cannot be recovered. Throwing is
 * the entire point: the alternative is appending a dead reference to FormData and
 * shipping an empty body, which is the silent failure this exists to stop.
 */
export async function slotToBlob(slot: PhotoSlot): Promise<Blob | null> {
  if (!slot) return null;

  if (slot instanceof Blob) {
    // Legacy, or a Blob restored from IndexedDB. Force it to materialise NOW so a
    // dead handle surfaces here, as an error we can show a crew member, rather
    // than as an empty request body they will never be told about.
    let bytes: ArrayBuffer;
    try {
      bytes = await slot.arrayBuffer();
    } catch {
      throw new UnreadablePhotoError("photo could not be read from this device");
    }
    if (bytes.byteLength === 0) {
      throw new UnreadablePhotoError("photo could not be read from this device");
    }
    return new Blob([bytes], { type: slot.type || "image/jpeg" });
  }

  if (!slot.bytes || slot.bytes.byteLength === 0) {
    throw new UnreadablePhotoError("photo could not be read from this device");
  }
  return new Blob([slot.bytes], { type: slot.type || "image/jpeg" });
}

/**
 * Best-effort Blob for PREVIEW (createObjectURL). Returns null instead of throwing
 * when the photo is unreadable, because a broken thumbnail must not take down the
 * gallery it sits in. The upload path is where an unreadable photo has to be loud.
 */
export async function slotToPreviewBlob(slot: PhotoSlot): Promise<Blob | null> {
  try {
    return await slotToBlob(slot);
  } catch {
    return null;
  }
}
