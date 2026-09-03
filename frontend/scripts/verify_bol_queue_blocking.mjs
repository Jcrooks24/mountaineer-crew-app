/**
 * The BOL queue's sequence-blocking rule (vet finding F3, 2026-09-03).
 *
 * The symptom this exists to catch, stated as a crew would experience it:
 *
 *   A long-distance BOL is signed TWICE - at origin and at destination - and
 *   each signing enqueues its own submit+sign+pdf triple. The drain held every
 *   later op for a BOL behind any op that did not land, including a `pdf`. So a
 *   PDF that could not be built (a deterministic failure - the ADR 0042 font
 *   defect is exactly this) left the DESTINATION SIGNATURE sitting unsent in the
 *   queue for the eight hundred miles between the two, behind a cosmetic
 *   artifact. A customer signature with no second copy, taken hostage by a PDF.
 *
 * So: a failed or backed-off `pdf` must NOT block, and a failed `submit` or
 * `sign` must still block (signing a row the server never created is
 * incoherent). Both directions are asserted, because a fix that stops blocking
 * on everything would pass a one-sided test and be a worse bug.
 *
 * Drives the REAL syncQueue out of bolStore.ts, with the network and the browser
 * storage stubbed - not a re-implementation of its logic.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${!c && d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

// ── browser surface ─────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// Node 24 defines `navigator` as a getter-only global, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true }, writable: true, configurable: true,
});
globalThis.window = globalThis;
// uploadBolPdfBlob posts the built PDF with raw fetch, not apiFetch. Left real,
// Node would attempt an actual network call and the failure mode under test
// would depend on DNS.
globalThis.fetch = async (url) => {
  globalThis.__attempted.push("PDF-UPLOAD");
  if (globalThis.__failUpload) return { ok: false, status: 502, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

// ── stub the modules bolStore imports ───────────────────────────────────────
const attempted = [];
let failPdfUpload = false;

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);

const stubs = {
  "../api/client": `
    export class ApiError extends Error {
      constructor(status, body) { super("api " + status); this.status = status; this.body = body; }
    }
    export async function apiFetch(path, opts) {
      globalThis.__attempted.push(path);
      return { ok: true };
    }`,
  "../auth/token": `export function getToken() { return "tok"; }`,
  "./photoStore": `
    export async function addPhoto() {}
    export async function updatePhoto() {}
    export async function listPhotosForJob() { return []; }`,
  "./queuedPhoto": `
    export async function slotToBlob() { return null; }
    export async function toQueuedPhoto(x) { return x; }`,
  "./bolPdf": `
    export async function generateBolPdf() {
      globalThis.__attempted.push("PDF-BUILD");
      if (globalThis.__failPdf) throw new Error("WinAnsi cannot encode U+2248");
      return { size: 10 };
    }`,
};

const stubPlugin = {
  name: "stubs",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (a) => {
      if (stubs[a.path]) return { path: a.path, namespace: "stub" };
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
      contents: stubs[a.path], loader: "js",
    }));
  },
};

globalThis.__attempted = attempted;
const built = await esbuild.build({
  entryPoints: [`${ROOT}/frontend/src/lib/bolStore.ts`],
  bundle: true, format: "esm", write: false, plugins: [stubPlugin],
  logLevel: "silent",
  // Vite injects import.meta.env; outside Vite it is undefined and a module
  // reading VITE_API_URL throws at evaluation time.
  define: { "import.meta.env": JSON.stringify({ VITE_API_URL: "http://test" }) },
});
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64")
);

// Read the queue/draft keys out of the source rather than guessing them, so a
// rename breaks this loudly instead of silently testing an empty queue.
const src = readFileSync(`${ROOT}/frontend/src/lib/bolStore.ts`, "utf8");
const keyMatch = src.match(/const\s+QUEUE_KEY\s*=\s*"([^"]+)"/);
check("found the queue key in bolStore.ts", !!keyMatch, String(keyMatch));
const QUEUE_KEY_ACTUAL = keyMatch ? keyMatch[1] : "crew_bol_queue_v1";

const draftMatch = src.match(/const\s+DRAFT_PREFIX\s*=\s*"([^"]+)"/);
const DRAFT_PREFIX = draftMatch ? draftMatch[1] : "crew_bol_draft_";

const BOL = "bol-1";
const JOB = "job-1";

function seed(ops, { withDraft = true } = {}) {
  attempted.length = 0;
  store.clear();
  store.set(QUEUE_KEY_ACTUAL, JSON.stringify(ops));
  if (withDraft) {
    // `items` MUST be an array: loadDraft returns null without it, and a pdf op
    // with no draft is acked as a genuine no-op rather than exercised. Getting
    // this wrong makes the whole pdf branch silently untested.
    store.set(DRAFT_PREFIX + JOB, JSON.stringify({
      bol_id: BOL, job_uuid: JOB, status: "delivered",
      updated_at: "2026-09-03T00:00:00Z", items: [],
    }));
  }
}

const readQueue = () => JSON.parse(store.get(QUEUE_KEY_ACTUAL) || "[]");

const failedPdf = {
  op: "pdf", bol_id: BOL, job_uuid: JOB,
  failed_at: "2026-09-03T00:00:00Z", failed_status: 0,
  failed_reason: "The signed BOL PDF could not be built on this device",
};
const secondTriple = [
  { op: "submit", bol_id: BOL, payload: { bol_id: BOL } },
  { op: "sign", bol_id: BOL, payload: { phase: "delivery", signature: "dest-signature" } },
  { op: "pdf", bol_id: BOL, job_uuid: JOB },
];

// ── 1. THE BUG: a failed pdf must not hold the destination signature ────────
globalThis.__failPdf = false;
seed([failedPdf, ...secondTriple]);
await mod.syncQueue();
check("a failed pdf no longer blocks the destination signature",
  attempted.some((p) => p.includes(`/api/bol/${BOL}/sign`)),
  `attempted=${JSON.stringify(attempted)}`);
check("the failed pdf op is KEPT, not deleted (ADR 0013)",
  readQueue().some((o) => o.op === "pdf" && o.failed_at),
  JSON.stringify(readQueue()));

// ── 2. the other direction: submit/sign must STILL block ───────────────────
seed([
  { op: "submit", bol_id: BOL, payload: {}, failed_at: "2026-09-03T00:00:00Z", failed_status: 422 },
  { op: "sign", bol_id: BOL, payload: { signature: "origin" } },
]);
await mod.syncQueue();
check("a failed submit STILL blocks the sign behind it",
  !attempted.some((p) => p.includes("/sign")),
  `attempted=${JSON.stringify(attempted)}`);

seed([
  { op: "sign", bol_id: BOL, payload: {}, failed_at: "2026-09-03T00:00:00Z", failed_status: 422 },
  { op: "pdf", bol_id: BOL, job_uuid: JOB },
]);
await mod.syncQueue();
check("a failed sign STILL blocks the pdf behind it",
  !attempted.includes("PDF-BUILD"),
  `attempted=${JSON.stringify(attempted)}`);

// ── 3. a backed-off (not failed) pdf must not block either ─────────────────
seed([
  { op: "pdf", bol_id: BOL, job_uuid: JOB, attempts: 3,
    retry_at: new Date(Date.now() + 60_000).toISOString() },
  ...secondTriple,
]);
await mod.syncQueue();
check("a pdf waiting out its backoff does not block the next signature",
  attempted.some((p) => p.includes(`/api/bol/${BOL}/sign`)),
  `attempted=${JSON.stringify(attempted)}`);

// ── 4. a build failure is marked permanent and surfaced, still not blocking ─
globalThis.__failPdf = true;
seed([{ op: "pdf", bol_id: BOL, job_uuid: JOB }, ...secondTriple]);
await mod.syncQueue();
const q = readQueue();
check("an unbuildable PDF is marked failed so the crew sees it",
  q.some((o) => o.op === "pdf" && o.failed_at && /could not be built/i.test(o.failed_reason || "")),
  JSON.stringify(q));
check("the pdf branch was actually exercised (draft loaded)",
  attempted.includes("PDF-BUILD"), `attempted=${JSON.stringify(attempted)}`);
check("and the destination signature still goes out",
  attempted.some((p) => p.includes(`/api/bol/${BOL}/sign`)),
  `attempted=${JSON.stringify(attempted)}`);
globalThis.__failPdf = false;

// ── 5. F4: the attempt cap and its stated window agree ─────────────────────
const capMatch = src.match(/PDF_MAX_TRANSIENT_ATTEMPTS\s*=\s*(\d+)/);
const cap = capMatch ? Number(capMatch[1]) : 0;
const base = 2000, capMs = 120000;
let sum = 0;
for (let n = 1; n < cap; n++) sum += Math.min(capMs, base * 2 ** (n - 1));
const minutes = sum / 60000;
check(`the cap's real window is ~10 min, not ~4 (cap=${cap}, sum=${sum}ms = ${minutes.toFixed(1)} min)`,
  minutes >= 9 && minutes <= 11, `${minutes.toFixed(1)} min`);

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
