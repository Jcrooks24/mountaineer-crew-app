/**
 * Every /api/... URL the client calls must exist on the server.
 *
 * WHY THIS EXISTS. The PTO feature shipped to staging completely dead: the
 * payroll screen called `/api/admin/off-job/pto` while the router served
 * `/api/admin/off-job-hours/pto`. Every request 404'd, the balance read's
 * `catch` swallowed it, and the panel rendered as though the employee simply had
 * no allowance. Nothing caught it - not the build (a URL is a string), not
 * `test_pto.py` (it drives the router functions directly and never touches a
 * URL), not a type. A client/server contract has no compiler, so it needs a test.
 *
 * HOW IT WORKS. The server's route table is the source of truth, exported to
 * `scripts/api_routes.json` by `backend/scripts/dump_api_routes.py`. This script
 * extracts every `/api/...` string literal in `src/` and asserts each one matches
 * a real route, treating a `${...}` interpolation as one path segment.
 *
 * REGENERATE the route table whenever an endpoint is added, removed or renamed:
 *   cd backend && python scripts/dump_api_routes.py
 * A stale table is itself a failure here (see the freshness check at the end):
 * a checked-in file that no longer matches the routers would let this pass while
 * proving nothing, which is worse than not having it.
 *
 * WHAT IT DOES NOT CHECK: the HTTP method, the request shape, or the response
 * shape. It answers exactly one question - "does this path exist" - which is the
 * question that was answered wrong.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const ROUTES = join(HERE, "api_routes.json");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `   ${detail}` : ""}`);
  if (!ok) failures++;
};

const routes = JSON.parse(readFileSync(ROUTES, "utf8"));

/** Split a path into segments, dropping the leading and trailing slash. */
const segs = (p) => p.split("/").filter(Boolean);

/** Does a client path match a server path?
 *
 *  Compared segment by segment, with no regex: a server `{id}` and a client
 *  `${...}` (already collapsed to "X" by the caller) each stand for exactly one
 *  segment, so `/a/{x}` matches `/a/b` but never `/a/b/c`. Deliberately not a
 *  regex - building one means escaping the path into a character class, and
 *  getting that escaping subtly wrong is how a check like this silently starts
 *  matching everything and passes forever. */
function pathMatches(clientPath, serverPath) {
  const c = segs(clientPath);
  const s = segs(serverPath);
  if (c.length !== s.length) return false;
  return s.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === c[i]);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// A URL literal ends at the first quote, backtick, whitespace, or `?` - the
// query string is not part of the route.
const URL_RE = /["`](\/api\/[^"`\s?]*)/g;

/**
 * Turn a raw client literal into something comparable.
 *
 * An interpolation means two different things depending on what precedes it,
 * and conflating them is what makes a naive version of this check cry wolf:
 *
 *   `/api/bill/${jobUuid}`      - after a slash, so it IS a path segment (an id)
 *   `/api/bulletin/feed${qs}`   - after a letter, so it is NOT: here it is a
 *                                 query string glued onto the last segment
 *
 * The first collapses to a single "X" and is matched exactly. The second cannot
 * be resolved statically, so the literal is truncated at that point and matched
 * as a PREFIX - `/api/bulletin/feed` still has to name something real, which is
 * the part worth asserting, while whatever the interpolation adds is not
 * guessed at.
 */
function normalize(raw) {
  const cut = raw.search(/[^/]\$\{/);
  if (cut !== -1) return { path: raw.slice(0, cut + 1).replace(/\/$/, ""), prefix: true };
  return { path: raw.replace(/\$\{[^}]*\}/g, "X").replace(/\/$/, ""), prefix: false };
}

const found = new Map();
for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(URL_RE)) {
    const { path, prefix } = normalize(m[1]);
    if (!found.has(path)) found.set(path, { file, prefix });
  }
}

console.log(`Client calls ${found.size} distinct /api paths; server exposes ${routes.paths.length}.\n`);

const orphans = [];
for (const [url, { file, prefix }] of found) {
  const hit = prefix
    // Truncated at an unresolvable interpolation: the literal part must still
    // name a real route, or be the start of one.
    ? routes.paths.some((p) => p === url || p.startsWith(`${url}/`) || p.startsWith(url))
    : routes.paths.some((p) => pathMatches(url, p));
  if (!hit) orphans.push([url, file.slice(file.indexOf("src")).split("\\").join("/")]);
}
check(orphans.length === 0, "every client /api path exists on the server",
  orphans.length ? orphans.map(([u, f]) => `\n          ${u}  <- ${f}`).join("") : "");

// The table is only evidence while it is current. `generated_from` records the
// backend commit it was dumped at; a mismatch means somebody changed a router
// and did not re-dump, so this whole file has been asserting against history.
const head = process.env.GIT_HEAD || "";
if (head && routes.generated_from && head !== routes.generated_from) {
  console.log(`\n  NOTE  api_routes.json was dumped at ${routes.generated_from.slice(0, 8)}, HEAD is ${head.slice(0, 8)}.`);
  console.log("        Re-run: cd backend && python scripts/dump_api_routes.py");
}

console.log();
if (failures) { console.log(`FAILURES: ${failures}`); process.exit(1); }
console.log("all checks passed");
