# dev-tools — staging feedback briefing

Turns Vercel Toolbar comment threads left on the **staging** deploy into a
single source-mapped markdown file (`staging-feedback.md`) you can hand to Claude
Code at the start of a session. Closes the gap between "someone commented on a
rendered element" and "which file do I edit".

Frontend/tooling only — nothing here touches the FastAPI backend or ships to the
app bundle (except the inert `data-component` attributes described below).

## The pieces

| File | What it is |
|------|------------|
| `gen-component-map.ts` | Scans `frontend/src` and writes `component-map.json` (identifier → source file). |
| `component-map.json` | **Auto-generated.** Do not hand-edit. |
| `fetch-staging-feedback.ts` | Reads toolbar threads (stdin / file / API) and writes `staging-feedback.md`. |
| `staging-feedback.md` | **Auto-generated** briefing. Hand this to Claude Code. |
| `sample-threads.json` | Example input so you can see the format. |

## One-time / whenever components move

Regenerate the component map (also run after adding a `data-component` tag):

```bash
cd frontend
npm run map:components
```

The map has two kinds of key, so a comment resolves whether it landed on a whole
component or a tagged section:

1. **`data-component="X"` values** — the exact element a reviewer clicked. Wins on conflict.
2. **exported component names** — every `export function/const/class` starting with a capital.

## Before a session — generate the briefing

Pull the unresolved staging threads and pipe them in. Three ways:

```bash
cd frontend

# A) You already have the threads as JSON (e.g. pulled via the Vercel MCP):
npm run staging:brief < ../dev-tools/threads.json

# B) A file path argument:
npx tsx ../dev-tools/fetch-staging-feedback.ts ../dev-tools/threads.json

# C) Direct API (optional): set both env vars, then run with no input.
#    The URL is config because Vercel's toolbar-comments endpoint isn't a
#    stable public API — pull via the MCP and pipe in (A) if you don't have one.
VERCEL_TOKEN=xxx VERCEL_COMMENTS_URL="https://api.vercel.com/…" npm run staging:brief
```

Add `--all` to include resolved threads (default is unresolved only).

Output → `dev-tools/staging-feedback.md`, formatted:

```
## /?tab=timeline — RodsRecorder (`frontend/src/components/RodsRecorder.tsx`)
Thread ID: vc_thread_a1
> the comment, verbatim
Replies:
- **Dispatch:** follow-up message
```

Anything that can't be matched to a `data-component` lands under **Unmapped**
(nothing is dropped), and every thread is listed under **Threads to resolve** so
you can check them off in the Vercel Toolbar (or via the Vercel MCP) once handled.

### Expected input shape (tolerant)

An array of threads, or `{ threads: [...] }` / `{ comments: [...] }` / `{ data: [...] }`.
Per thread the script looks for (any of): `id`; a page via `path`/`page`/`url`;
comment text via `text`/`body`/`message` (or the first item of `comments`); a
selector via `selector`/`anchor.selector`/`target.selector`/`element.selector`;
`replies`/`comments`; and `resolved`/`status`. See `sample-threads.json`.

## Adding a tag so a section maps

Add `data-component="<PascalCaseName>"` to the **root element** of the view, then
rerun `npm run map:components`:

```tsx
return <div className="card" data-component="ActualInventory"> … </div>;
```

Prefer the actual exported component name; for a sub-section that isn't its own
component, use a clear unique name (e.g. `ReportPerDiem`). Tags are inert and safe
in prod. To keep them out of the prod bundle you could strip them with a small
Vite/Babel plugin, but that's optional — they add no runtime cost.

## Currently tagged views

Timeline: `TimelineActionsTile`, `RodsRecorder`, `LdPlanTile` ·
Inventory: `ActualInventory`, `BolInventoryTab` ·
Report (LD): `ReportDocuments`, `ReportPerDiem`, `RodsSignoff` ·
Long-distance page: `LdHosReference`, `LdFormsSection` (PODS/BOL), `LdTralaExemption`.
