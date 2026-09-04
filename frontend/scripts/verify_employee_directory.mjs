/**
 * Employee directory (request ddf88e92).
 * `node scripts/verify_employee_directory.mjs`
 *
 * WHY THIS EXISTS. Three things here are decisions, and each is the kind that a
 * later edit quietly reverses:
 *
 *   1. CURRENT EMPLOYEES ONLY (user direction). The endpoint filters on
 *      is_active. Widening it would publish the phone numbers of people who have
 *      left to everybody still working here.
 *   2. It reads the SHARED cached roster rather than fetching its own list. That
 *      roster is load-bearing - employee hours are keyed on it, and it is cached
 *      so somebody with no signal can still log hours - so reusing it makes this
 *      page work offline for free. A second fetch of the same data would only
 *      create a way for the two to disagree.
 *   3. `phone` is OPTIONAL. A roster cached by an older build has no phone field
 *      at all, so "no phone on file" has to be a real rendered state.
 *
 * Cannot verify rendering or taps: no jsdom or test runner here, and the Chrome
 * tools are off limits.
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

const page = readFileSync(`${ROOT}/frontend/src/pages/EmployeeDirectory.tsx`, "utf8");
const tools = readFileSync(`${ROOT}/frontend/src/pages/Tools.tsx`, "utf8");
const main = readFileSync(`${ROOT}/frontend/src/main.tsx`, "utf8");
const api = readFileSync(`${ROOT}/backend/app/routers/users.py`, "utf8");
const schema = readFileSync(`${ROOT}/backend/app/schemas/users.py`, "utf8");

console.log("It is reachable from Tools:");
check("a Tools tile links to it", /label="Employee directory"[\s\S]{0,120}?nav\("\/directory"\)/.test(tools));
check("the route exists", /path="\/directory"/.test(main));
check("and it requires auth", /path="\/directory" element=\{<RequireAuth>/.test(main));

console.log("\nCURRENT EMPLOYEES ONLY:");
const ep = api.match(/def list_directory\([\s\S]*?\n    return users/);
check("the endpoint was found", !!ep);
check("it filters on is_active", !!ep && /User\.is_active\.is_\(True\)/.test(ep[0]),
  "widening this publishes the numbers of people who have left");
check("the page says so on screen", /Current employees only/.test(page));

console.log("\nContact details are actually served:");
// Bounded on the class body, not a character count: the field carries a long
// comment and a fixed window fails for the wrong reason.
// `(?=\nclass |$)` not `\n\nclass `: DirectoryEntry is the LAST class in the
// file, so requiring another one after it never matched.
const dirClass = schema.match(/class DirectoryEntry\(BaseModel\):([\s\S]*?)(?=\nclass |$)/);
check("the DirectoryEntry class was found", !!dirClass);
check("phone is on the directory schema",
  !!dirClass && /phone: str \| None/.test(dirClass[1]), dirClass?.[1]);
check("the page renders a phone when there is one", /\{p\.phone\}/.test(page));
check("and a real state when there is not", /No phone on file/.test(page));
check("phone is optional in the client type",
  /phone\?: string \| null;/.test(readFileSync(`${ROOT}/frontend/src/auth/AuthContext.tsx`, "utf8")),
  "an older cached roster has no phone field at all");

console.log("\nIt is opened on a phone, so the details are actionable:");
check("the number is a tel: link", /href=\{`tel:\$\{/.test(page));
check("the address is a mailto: link", /href=\{`mailto:\$\{/.test(page));
check("the search box is 16px so iOS does not zoom", /fontSize: 16/.test(page));

console.log("\nIt reuses the shared roster, so it works offline:");
check("it seeds from the cached roster", /useState<DirectoryEntry\[\]>\(\(\) => currentDirectory\(\)\)/.test(page));
check("revalidates in the background", /ensureDirectory\(\)\.catch/.test(page));
check("and subscribes to changes", /return subscribeDirectory\(/.test(page));
check("it does NOT fetch its own copy", !/apiFetch\(/.test(page),
  "a second fetch of the same data is a second thing to disagree");

console.log("\nSearch behaviour:");
check("matches on name, email and phone",
  /name\.includes\(needle\)/.test(page)
  && /email\.includes\(needle\)/.test(page)
  && /phone\.includes\(needleDigits\)/.test(page));
check("phone matching ignores punctuation",
  /\.replace\(\/\\D\/g, ""\)/.test(page),
  "'(555) 0134' and '5550134' must both find the same person");
check("a short numeric needle does not match every number",
  /needleDigits\.length >= 3/.test(page));
check("sorted by surname, like the admin roster and payroll",
  /\.sort\(compareBySurname\)/.test(page));
check("an empty result says so rather than showing nothing",
  /Nobody matches/.test(page));
check("an unloaded roster is explained, not blank",
  /roster has not loaded yet/.test(page));

console.log();
if (fails.length) {
  console.log("FAILURES: " + fails.join(", "));
  process.exit(1);
}
console.log("all checks passed");
