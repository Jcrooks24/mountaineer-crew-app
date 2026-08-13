/**
 * Server-restart detection, and route code splitting.
 *
 * The backend recycles every 1000 requests to stay inside a 512 MB limit. For a
 * few seconds it is unreachable, and crews read that as the app being broken.
 *
 * The risk in "explain the restart" is telling a crew member to sit and wait for
 * a restart that is not coming. An OFFLINE phone and a RESTARTING server look
 * identical from a failed fetch, and so does a genuine 500. Getting that
 * classification wrong is worse than saying nothing, so most of these checks are
 * about what must NOT be called a restart.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const src = readFileSync(`${ROOT}/frontend/src/lib/serverStatus.ts`, "utf8");
const mod = await import(
  "data:text/javascript;base64," +
  Buffer.from(esbuild.transformSync(src, { loader: "ts", format: "esm" }).code).toString("base64")
);
const {
  looksLikeRestart, noteServerUnavailable, noteServerReachable, snapshot, subscribe,
  resetServerStatus,
} = mod;

// Node 24 defines navigator as a getter-only global, so it must be redefined
// rather than assigned. The offline case below is the whole reason this test
// needs to control it.
const setOnline = (v) =>
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: v }, configurable: true, writable: true,
  });
setOnline(true);

console.log("A restart is recognised:");
check("502 is a restart", looksLikeRestart(null, 502));
check("503 is a restart", looksLikeRestart(null, 503));
check("504 is a restart", looksLikeRestart(null, 504));
check("a refused connection while online is a restart",
  looksLikeRestart(new TypeError("Failed to fetch")));

console.log("\nThings that must NOT be called a restart:");
// A 500 means the app is UP and threw. Telling a crew member to wait for a
// restart that is not coming would strand them on a broken screen.
check("500 is not a restart", !looksLikeRestart(null, 500));
check("404 is not a restart", !looksLikeRestart(null, 404));
check("401 is not a restart", !looksLikeRestart(null, 401));
check("422 is not a restart", !looksLikeRestart(null, 422));
check("200 is not a restart", !looksLikeRestart(null, 200));
setOnline(false);
check("a failed fetch while OFFLINE is not a restart",
  !looksLikeRestart(new TypeError("Failed to fetch")),
  "offline must keep saying offline");
setOnline(true);
check("a non-network error is not a restart", !looksLikeRestart(new Error("boom")));

console.log("\nState clears on the first real answer:");
resetServerStatus();
check("starts clear", snapshot().restarting === false);
noteServerUnavailable();
check("marked restarting", snapshot().restarting === true);
noteServerUnavailable();
check("a second failure does not restart the clock",
  snapshot().restarting === true && snapshot().seconds === 0);
noteServerReachable();
check("cleared by a success", snapshot().restarting === false);

console.log("\nSubscribers are told, and a broken one cannot break the app:");
resetServerStatus();
const seen = [];
subscribe((s) => seen.push(s.restarting));
subscribe(() => { throw new Error("bad subscriber"); });
check("current state pushed on subscribe", seen.length === 1 && seen[0] === false);
noteServerUnavailable();
check("notified on change", seen[seen.length - 1] === true);
noteServerReachable();
check("notified on recovery", seen[seen.length - 1] === false);

console.log("\nOnly safe methods are retried:");
const client = readFileSync(`${ROOT}/frontend/src/api/client.ts`, "utf8");
check("retry is gated on the method", /isSafeToRetry\(opts\.method\)/.test(client));
check("GET and HEAD only", /m === "GET" \|\| m === "HEAD"/.test(client));
// The bulletin like endpoint TOGGLES: a blind POST retry would undo the tap.
check("the toggle hazard is written down", /TOGGLES/.test(client));
check("retries are bounded", /RESTART_RETRY_DELAYS_MS = \[/.test(client));
const delays = client.match(/RESTART_RETRY_DELAYS_MS = \[([^\]]+)\]/)[1]
  .split(",").map((n) => parseInt(n.trim(), 10));
const total = delays.reduce((a, b) => a + b, 0);
check("total retry window is seconds, not minutes", total > 3000 && total < 15000,
  `${total} ms over ${delays.length} attempts`);

// A 502/503/504 is a proxy ANSWERING - positive evidence of a restart. A failed
// fetch while "online" is ambiguous: navigator.onLine reports true for a phone
// on a tower with no usable throughput. Spending the full ladder on that would
// make every request slower for the crews with the worst signal.
const ambiguous = client.match(/AMBIGUOUS_RETRY_DELAYS_MS = \[([^\]]+)\]/)[1]
  .split(",").map((n) => parseInt(n.trim(), 10));
check("an ambiguous network failure retries once, briefly",
  ambiguous.length === 1 && ambiguous[0] <= 1000, `${ambiguous.join(",")} ms`);
check("the ambiguous ladder is shorter than the confirmed one",
  ambiguous.reduce((a, b) => a + b, 0) < total);
check("the network-error path uses the ambiguous ladder",
  /catch \(err\)[\s\S]{0,400}AMBIGUOUS_RETRY_DELAYS_MS/.test(client));
check("the status path uses the confirmed ladder",
  /looksLikeRestart\(null, res\.status\)[\s\S]{0,300}RESTART_RETRY_DELAYS_MS/.test(client));

console.log("\nA deploy cannot strand a crew member on a dead chunk:");
const lazyRoute = readFileSync(`${ROOT}/frontend/src/lib/lazyRoute.ts`, "utf8");
check("chunk-load failures are recognised across browsers",
  /ChunkLoadError/.test(lazyRoute)
  && /Failed to fetch dynamically imported module/.test(lazyRoute)
  && /Importing a module script failed/.test(lazyRoute));
// A reload loop would lock a crew member out of the WHOLE app rather than one
// screen, which is far worse than the error page it replaces.
check("it reloads at most once per route", /alreadyReloadedFor\(key\)/.test(lazyRoute));
check("the once-only mark is persisted", /sessionStorage\.setItem/.test(lazyRoute));
check("no sessionStorage is treated as already-reloaded, not as free rein",
  /return true;/.test(lazyRoute.split("function alreadyReloadedFor")[1].split("}")[3] || "")
  || /catch \{[\s\S]{0,200}return true;/.test(lazyRoute));
// Reloading an offline PWA turns "this screen is unavailable" into "the app is
// gone".
check("an offline device is never reloaded", /navigator\.onLine === false/.test(lazyRoute));
const mainSrc = readFileSync(`${ROOT}/frontend/src/main.tsx`, "utf8");
check("every route uses it", (mainSrc.match(/lazyRoute\(/g) || []).length >= 12,
  `${(mainSrc.match(/lazyRoute\(/g) || []).length} routes`);
check("bare React.lazy is no longer used for routes",
  !/= lazy\(\(\) => import\(/.test(mainSrc));

console.log("\nThe banner does not overclaim:");
const banner = readFileSync(`${ROOT}/frontend/src/components/ServerRestartBanner.tsx`, "utf8");
check("no countdown to zero is promised", !/setTimeout[\s\S]{0,80}remaining/i.test(banner));
check("it waits before appearing", /SHOW_AFTER_MS/.test(banner));
check("the data claim is about THIS device, which is checkable",
  /saved on this phone|it is saved on this phone|entered is lost/.test(banner));
check("it sits above the bottom nav, not over it", /bottom: 78/.test(banner));
check("it is announced to screen readers", /aria-live="polite"/.test(banner));

console.log("\nRoutes are code split, and the timeline is not:");
const main = readFileSync(`${ROOT}/frontend/src/main.tsx`, "utf8");
check("Admin is lazy", /const Admin = lazyRoute\("Admin"/.test(main));
check("Availability is lazy", /const Availability = lazyRoute\("Availability"/.test(main));
// The timeline is what crews open. Making the common case wait on a second
// round trip would be a pessimisation dressed as an optimisation.
check("App (the timeline) stays a static import",
  /^import App from "\.\/App";$/m.test(main) && !/const App = lazy\(/.test(main));
check("a Suspense fallback exists", /<Suspense fallback=\{<RouteLoading \/>\}>/.test(main));
check("the fallback does not replace the nav or banners",
  main.indexOf("<Suspense") > main.indexOf("<ServerRestartBanner />"));

console.log("\nThe split did not break offline navigation:");
// Crews work offline. A lazy chunk that the service worker does not precache is
// a white screen the moment they navigate with no signal.
const sw = readFileSync(`${ROOT}/frontend/dist/sw.js`, "utf8");
for (const chunk of ["Admin", "Availability", "LongDistance", "Bulletin", "Profile"]) {
  check(`${chunk} chunk is precached`, new RegExp(`assets/${chunk}-`).test(sw));
}

console.log("\nThe initial download actually got smaller:");
const out = execFileSync("node", ["-e", `
  const {readdirSync,readFileSync}=require("fs");
  const {gzipSync}=require("zlib");
  const d="${ROOT}/frontend/dist/assets";
  const f=readdirSync(d).find(x=>x.startsWith("index-")&&x.endsWith(".js"));
  process.stdout.write(String(gzipSync(readFileSync(d+"/"+f)).length));
`], { encoding: "utf8" });
const gz = parseInt(out, 10);
check("index chunk is well under the old 462 KB single bundle", gz < 250 * 1024,
  `${(gz / 1024).toFixed(0)} KB gzipped`);

console.log("\n" + (fails.length ? `${fails.length} FAILED: ${fails.join(", ")}` : "ALL PASS"));
process.exit(fails.length ? 1 : 0);
