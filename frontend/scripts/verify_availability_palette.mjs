/**
 * Colorblind availability palettes: distinguishable, readable, the owner's rules.
 * `node scripts/verify_availability_palette.mjs`
 *
 * WHY THIS EXISTS. A crew member is color blind, and the Availability calendar
 * showed status by green / red / amber alone - the exact pair red-green color
 * blindness cannot separate (ADR 0050). The checks below pin what makes the fix
 * real rather than decorative:
 *
 *   - every palette keeps its three statuses apart UNDER A SIMULATION of the
 *     color blindness it is for, not merely under normal vision
 *   - the word printed on each fill is readable (WCAG 4.5:1)
 *   - a colorblind mode prints a word, so color is never the only cue
 *   - someone else's availability (the admin view) is always standard
 *   - a choice made offline applies at once, survives logout, is sent later,
 *     and is never sent under a different person's account
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..").split("\\").join("/");
const fails = [];
const check = (n, c, d = "") => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? `   ${d}` : ""}`);
  if (!c) fails.push(n);
};

class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new FakeStorage();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

// The module under test, bundled with its three imports replaced by stubs the
// test controls: the signed-in user, the network, and React's useMemo.
const esbuild = await import(`file:///${ROOT}/frontend/node_modules/esbuild/lib/main.js`);
const stubs = {
  "react": "export const useMemo = (f) => f();",
  "../api/client": "export const apiFetch = (...a) => globalThis.__apiFetch(...a);",
  "../auth/AuthContext": [
    "export const loadCachedUser = () => globalThis.__cachedUser;",
    "export const useAuth = () => ({ user: globalThis.__cachedUser });",
  ].join("\n"),
};
const built = await esbuild.build({
  entryPoints: [`${ROOT}/frontend/src/lib/availabilityPalette.ts`],
  bundle: true, write: false, format: "esm", platform: "neutral",
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^(react|\.\.\/api\/client|\.\.\/auth\/AuthContext)$/ },
        (a) => ({ path: a.path, namespace: "stub" }));
      b.onResolve({ filter: /availabilityStore$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" },
        (a) => ({ contents: stubs[a.path] ?? "export {};", loader: "js" }));
    },
  }],
});
const P = await import("data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0].text).toString("base64"));

// ── Color science, independent of the module ────────────────────────────────
const MACHADO = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function lab(hex, sim) {
  const r = rgb(hex).map(lin);
  const m = MACHADO[sim];
  const s = [0, 1, 2].map((i) => Math.min(1, Math.max(0, m[i][0] * r[0] + m[i][1] * r[1] + m[i][2] * r[2])));
  const X = 0.4124 * s[0] + 0.3576 * s[1] + 0.1805 * s[2];
  const Y = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  const Z = 0.0193 * s[0] + 0.1192 * s[1] + 0.9505 * s[2];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
// CIE76 is enough for a floor: it is harsher than dE2000 on the pairs that matter.
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const FOR = {
  red_green: ["protan", "deutan"], deuteranopia: ["deutan"], protanopia: ["protan"],
  tritanopia: ["tritan"], monochrome: ["normal"],
};
const STATUSES = ["available", "unavailable", "conditional"];

console.log("Each colorblind palette keeps its statuses apart, for the eyes it is for:");
for (const [mode, sims] of Object.entries(FOR)) {
  const c = P.statusPalette(mode);
  for (const sim of ["normal", ...sims]) {
    let worst = Infinity;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = lab(c[STATUSES[i]].bg, sim), b = lab(c[STATUSES[j]].bg, sim);
      // Monochrome is about lightness alone; hue there is not the signal.
      worst = Math.min(worst, mode === "monochrome" ? Math.abs(a[0] - b[0]) : dE(a, b));
    }
    check(`${mode} under ${sim} vision: closest pair is clearly different`, worst >= 30, `min ${worst.toFixed(0)}`);
  }
  for (const s of STATUSES) {
    const r = ratio(c[s].bg, c[s].fg);
    check(`${mode} ${s}: the word on the fill is readable`, r >= 4.5, `${r.toFixed(1)}:1`);
    check(`${mode} ${s}: the cell prints a word, not color alone`, c[s].cellLabel.length > 0);
    check(`${mode} ${s}: page text is body color, not a fill color`, c[s].text === "var(--text)");
  }
}

console.log("\nStandard stays exactly as it was:");
const std = P.statusPalette("default");
check("available is the theme's ok color", std.available.fg === "var(--ok)");
check("unavailable is the theme's danger color", std.unavailable.fg === "var(--danger)");
check("conditional is the theme's warn color", std.conditional.fg === "var(--warn)");
check("standard cells add no word", STATUSES.every((s) => std[s].cellLabel === ""));

console.log("\nWhose view it is decides the palette:");
globalThis.__cachedUser = { id: 7, availability_palette: "tritanopia" };
check("your own view uses your palette", P.useStatusPalette(true).mode === "tritanopia");
check("someone else's availability is always standard", P.useStatusPalette(false).mode === "default");
globalThis.__cachedUser = { id: 7, availability_palette: "sepia_from_a_future_build" };
check("an unknown account value falls back to standard", P.useStatusPalette(true).mode === "default");
globalThis.__cachedUser = { id: 7 };
check("a profile cached by an older build is standard", P.useStatusPalette(true).mode === "default");

console.log("\nPicking one works with no signal, and lands on the right account:");
const sent = [];
globalThis.__apiFetch = async (path, opts) => {
  if (!navigator.onLine) throw new TypeError("Failed to fetch");
  const body = JSON.parse(opts.body);
  sent.push({ user: globalThis.__cachedUser.id, ...body });
  return { ...globalThis.__cachedUser, ...body };
};
globalThis.__cachedUser = { id: 7, availability_palette: "default" };
navigator.onLine = false;
const offline = await P.chooseAvailabilityPalette(7, "protanopia");
check("offline, nothing is sent", sent.length === 0 && offline === null);
check("offline, the choice applies at once anyway", P.useStatusPalette(true).mode === "protanopia");
check("the choice outlives a sign-out (not under a key clearCrewState wipes)",
  ![...localStorage.m.keys()].some((k) => k.startsWith("mm_") || k.startsWith("crew_")));

// Someone else signs in on the same phone before signal returns.
globalThis.__cachedUser = { id: 9, availability_palette: "default" };
navigator.onLine = true;
await P.drainAvailabilityPalette();
check("a different person signed in: 7's choice is not sent as 9's", sent.length === 0);
check("and 9 does not see 7's palette", P.useStatusPalette(true).mode === "default");

globalThis.__cachedUser = { id: 7, availability_palette: "default" };
const updated = await P.drainAvailabilityPalette();
check("7 back and online: the choice is sent", sent.length === 1 && sent[0].availability_palette === "protanopia");
check("the drain hands back the updated profile for setUser", updated?.availability_palette === "protanopia");
check("the local copy is dropped once the account has it",
  ![...localStorage.m.keys()].some((k) => k.includes(":7")));
await P.drainAvailabilityPalette();
check("draining again sends nothing", sent.length === 1);

// Later, changed on another phone: the account value must win here.
globalThis.__cachedUser = { id: 7, availability_palette: "monochrome" };
check("a later change from another phone wins on this one", P.useStatusPalette(true).mode === "monochrome");

console.log();
if (fails.length) { console.log(`FAILURES: ${fails.join(", ")}`); process.exit(1); }
console.log("all checks passed");
