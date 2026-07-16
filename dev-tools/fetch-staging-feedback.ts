/**
 * fetch-staging-feedback.ts
 *
 * Turns Vercel Toolbar comment threads on the staging deploy into a single
 * source-mapped markdown briefing (dev-tools/staging-feedback.md) to hand to
 * Claude Code at the start of a session.
 *
 * Input (pick one):
 *   - Piped JSON on stdin:   npm run staging:brief < threads.json
 *   - A file:                npx tsx dev-tools/fetch-staging-feedback.ts threads.json
 *   - Direct API (optional): set VERCEL_TOKEN and VERCEL_COMMENTS_URL and run
 *                            with no input; the script GETs that URL with a
 *                            Bearer token. (The URL is left to config because
 *                            Vercel's toolbar-comments endpoint isn't a stable
 *                            public API - pull via the Vercel MCP and pipe the
 *                            JSON in if you don't have a URL.)
 *
 * The input is treated tolerantly: an array of threads, or { threads: [...] } /
 * { comments: [...] } / { data: [...] }. Each thread is scanned for a page path,
 * the comment text + replies, and an element identifier - preferring a
 * `data-component="X"` value embedded in the toolbar's CSS selector, which maps
 * to a source file via component-map.json. Anything that can't be matched is
 * still emitted under "Unmapped" so nothing is silently dropped.
 *
 * Run: `npm run staging:brief`
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(HERE, "component-map.json");
const OUT = join(HERE, "staging-feedback.md");

type Reply = { author?: string; text: string };
type NormalizedThread = {
  id: string;
  pagePath: string;
  componentId: string | null;
  text: string;
  replies: Reply[];
  resolved: boolean;
  raw: unknown;
};

// ── input loading ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function loadRawThreads(): Promise<any[]> {
  const fileArg = process.argv[2];
  let text = "";

  if (fileArg && existsSync(fileArg)) {
    text = readFileSync(fileArg, "utf8");
  } else {
    text = await readStdin();
  }

  if (!text) {
    const url = process.env.VERCEL_COMMENTS_URL;
    const token = process.env.VERCEL_TOKEN;
    if (url && token) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
      text = await res.text();
    } else {
      throw new Error(
        "No input. Pipe thread JSON on stdin, pass a file path, or set " +
        "VERCEL_TOKEN + VERCEL_COMMENTS_URL. Example: npm run staging:brief < threads.json",
      );
    }
  }

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  return parsed.threads || parsed.comments || parsed.data || [];
}

// ── normalization (tolerant to Vercel's shape) ───────────────────────────────

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function pathFromUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    // Keep the query string - this SPA selects tabs via ?tab=..., so it's the
    // difference between "/" and "which screen the comment was left on".
    const parsed = new URL(u);
    return parsed.pathname + parsed.search;
  } catch {
    return u.startsWith("/") ? u : undefined;
  }
}

// Pull a data-component value out of any selector/anchor string on the thread.
function extractComponentId(t: any): string | null {
  const haystacks = [
    t.selector, t.cssSelector, t.xpath, t.anchor?.selector, t.target?.selector,
    t.element?.selector, t.element?.dataComponent, t.dataComponent, t.component,
    JSON.stringify(t.anchor || t.target || t.element || {}),
  ].filter((x) => typeof x === "string") as string[];

  for (const h of haystacks) {
    const m = h.match(/data-component=["'`]?([A-Za-z0-9_-]+)/);
    if (m) return m[1];
  }
  // Some payloads expose it as a bare field already equal to a component name.
  const bare = firstString(t.component, t.dataComponent, t.element?.dataComponent);
  return bare || null;
}

function extractReplies(t: any): Reply[] {
  const arr = t.replies || t.comments || t.messages || [];
  if (!Array.isArray(arr)) return [];
  // If comments[] holds the whole thread, the first item is the root - skip it.
  const items = t.comments && !t.text && !t.body ? arr.slice(1) : arr;
  return items
    .map((r: any) => ({
      author: firstString(r.author?.name, r.author, r.user?.name, r.username),
      text: firstString(r.text, r.body, r.message, r.content) || "",
    }))
    .filter((r: Reply) => r.text);
}

function normalize(t: any, i: number): NormalizedThread {
  const rootText =
    firstString(t.text, t.body, t.message, t.content) ||
    firstString(t.comments?.[0]?.text, t.comments?.[0]?.body) ||
    "(no comment text)";
  const pagePath =
    firstString(t.path, t.page, t.pagePath, t.route) ||
    pathFromUrl(firstString(t.url, t.pageUrl, t.location)) ||
    "(unknown page)";
  const resolved =
    t.resolved === true ||
    t.isResolved === true ||
    firstString(t.status, t.state)?.toLowerCase() === "resolved";

  return {
    id: firstString(t.id, t.threadId, t.uid) || `thread-${i + 1}`,
    pagePath,
    componentId: extractComponentId(t),
    text: rootText,
    replies: extractReplies(t),
    resolved: !!resolved,
    raw: t,
  };
}

// ── rendering ────────────────────────────────────────────────────────────────

function loadMap(): Record<string, string> {
  if (!existsSync(MAP_PATH)) {
    throw new Error(`Missing ${MAP_PATH}. Run \`npm run map:components\` first.`);
  }
  const json = JSON.parse(readFileSync(MAP_PATH, "utf8"));
  return json.map || json;
}

function block(t: NormalizedThread, file: string | null): string {
  const head = file
    ? `## ${t.pagePath} — ${t.componentId} (\`${file}\`)`
    : `## ${t.pagePath}${t.componentId ? ` — ${t.componentId} (unmapped)` : " — (no component tag)"}`;
  const lines = [head, `Thread ID: ${t.id}`, "", `> ${t.text.replace(/\n/g, "\n> ")}`];
  if (t.replies.length) {
    lines.push("", "Replies:");
    for (const r of t.replies) lines.push(`- ${r.author ? `**${r.author}:** ` : ""}${r.text}`);
  }
  return lines.join("\n");
}

async function main() {
  const map = loadMap();
  const raw = await loadRawThreads();
  const includeResolved = process.argv.includes("--all");

  const threads = raw
    .map(normalize)
    .filter((t) => includeResolved || !t.resolved);

  const mapped: string[] = [];
  const unmapped: string[] = [];
  const resolveList: string[] = [];

  for (const t of threads) {
    const file = t.componentId ? map[t.componentId] || null : null;
    (file ? mapped : unmapped).push(block(t, file));
    resolveList.push(`- [ ] ${t.id} — ${t.pagePath}${t.componentId ? ` (${t.componentId})` : ""}`);
  }

  const now = new Date().toISOString();
  const out: string[] = [
    `# Staging feedback briefing`,
    ``,
    `Generated ${now} from ${threads.length} unresolved Vercel Toolbar thread(s).`,
    `Source map: \`dev-tools/component-map.json\` — regenerate with \`npm run map:components\`.`,
    ``,
    `---`,
    ``,
  ];

  if (mapped.length) {
    out.push(`# Mapped to source`, ``, mapped.join("\n\n"), ``);
  }
  if (unmapped.length) {
    out.push(
      `# Unmapped`,
      ``,
      `_These threads couldn't be matched to a \`data-component\`. Add the tag to the`,
      ` element (see dev-tools README) so they map next time._`,
      ``,
      unmapped.join("\n\n"),
      ``,
    );
  }
  if (!mapped.length && !unmapped.length) {
    out.push(`_No unresolved threads. 🎉_`, ``);
  }

  out.push(
    `---`,
    ``,
    `## Threads to resolve after addressing`,
    `_Check off + resolve in the Vercel Toolbar (or via the Vercel MCP) once handled._`,
    ``,
    resolveList.join("\n") || "- (none)",
    ``,
  );

  writeFileSync(OUT, out.join("\n"));
  console.log(
    `[brief] ${threads.length} thread(s): ${mapped.length} mapped, ${unmapped.length} unmapped -> dev-tools/staging-feedback.md`,
  );
}

main().catch((e) => {
  console.error(`[brief] ${e.message || e}`);
  process.exit(1);
});
