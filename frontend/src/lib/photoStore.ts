// src/lib/photoStore.ts
// Minimal IndexedDB wrapper for storing job photos offline.
// No external libs. Explicit + debuggable.

export type StoredPhoto = {
  id: string;          // uuid
  job_uuid: string;
  created_at: string;  // ISO
  mime: string;
  caption: string;
  blob: Blob;          // actual image
  drive_status?: "pending" | "uploaded" | "failed";
  drive_url?: string;
  drive_error?: string;
  // Optional link to an incident this photo documents (see IncidentReport).
  incident_uuid?: string;
  claim_number?: string;
};

const DB_NAME = "crew_app_db";
// Shared crew_app_db version - MUST stay in sync with reimbursementStore.ts.
// IndexedDB rejects opening a DB with a version lower than its current one,
// so every module that opens crew_app_db must use the same number and its
// upgrade handler must create the full schema.
const DB_VERSION = 2;

const STORE_PHOTOS = "photos";
const STORE_REIMBURSEMENTS = "reimbursement_queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
        store.createIndex("by_job", "job_uuid", { unique: false });
        store.createIndex("by_created", "created_at", { unique: false });
      }
      // Created here too so whichever store module opens crew_app_db first
      // builds the full v2 schema. This store is owned by reimbursementStore.ts.
      if (!db.objectStoreNames.contains(STORE_REIMBURSEMENTS)) {
        const store = db.createObjectStore(STORE_REIMBURSEMENTS, {
          keyPath: "reimbursement_uuid",
        });
        store.createIndex("by_created", "created_at", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addPhoto(p: StoredPhoto): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const store = tx.objectStore(STORE_PHOTOS);
  store.put(p);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  db.close();
}

export async function listPhotosForJob(jobUuid: string): Promise<StoredPhoto[]> {
  if (!jobUuid.trim()) return [];

  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readonly");
  const store = tx.objectStore(STORE_PHOTOS);
  const idx = store.index("by_job");

  const req = idx.getAll(jobUuid.trim());
  const results = await txPromise(req);

  db.close();

  // newest first
  results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return results;
}

export async function updatePhoto(id: string, updates: Partial<Omit<StoredPhoto, "id">>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const store = tx.objectStore(STORE_PHOTOS);

  const existing = await txPromise<StoredPhoto>(store.get(id));
  if (!existing) { db.close(); return; }

  store.put({ ...existing, ...updates });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  db.close();
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const store = tx.objectStore(STORE_PHOTOS);

  store.delete(id);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  db.close();
}
