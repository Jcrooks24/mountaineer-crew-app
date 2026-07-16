# Staging feedback briefing (source-mapped)

Generated 2026-07-09 from 11 unresolved Vercel Toolbar threads on the `staging`
branch (project `mountaineer-crew-app`, pulled via the Vercel MCP).

> Note: the auto-generated map left every thread under "Unmapped" because the
> app's elements carry no `data-component` tags, so the toolbar only captured
> minified CSS selectors. The mapping below was derived by hand from those
> selectors + comment content. To make future runs self-map, add
> `data-component="X"` tags to the key elements (see dev-tools/README.md).

---

## Group A — Job Report screen (`/`) → `frontend/src/components/JobReport.tsx`

### 1. W8IGacJ3Ii0x — Gate skill ratings behind an admin-set crew-lead tag
> "skill ratings are still clickable by any user, i would like to harden this
> further to be viewable/editable by crew leads only. UX level crew lead
> designation is still ok. A good fix would be using an admin-set crew lead tag
> to gate whether a user can view and fill out skills"

- Source: `JobReport.tsx:293-295` (`canLead`, `selfAssess`, `leadEditable`),
  `:1336` + `:1537` (skill rating rows), `:2172-2185` (`LeadGate`), `:2247`
  (rating buttons).
- Root cause: `leadEditable = canLead || selfAssess`. `LeadGate` shows every
  user a "No crew lead on this job — let me fill it in" button that flips
  `selfAssess=true`, so anyone can edit ratings. That escape hatch is the hole.

### 2. oF0nTf6qKwND — Remove the crew-lead hours confirmation
> "Remove crew lead hours confirmation"

- Source: `JobReport.tsx:1611-1624` (the `hours_verified` checkbox +
  "Crew lead: I've verified these hours are correct." / "Hours verified by a
  crew lead." status), plus the `hours_verified` field wiring (`:167`, `:232`,
  `:468`, `:554`, `:1066`).

### 3. S6oGpfVToyhv — "man hours, not hours"
> "man hours, not hours"

- Source: `JobReport.tsx` Employee Hours block (a `.small` hours label with two
  spans, selector `div.col > div.small:nth-of-type(4) > span:nth-of-type(2)`).
  The "Total man-hours" line (`:1575`) already reads correctly; this is a
  secondary "Hours" label that should read "Man Hours". Exact line to confirm
  when we open the file.

### 4. ezBYstUa0FA1 — Tie labor buttons to crew skills via the crew-lead access point
> "These can be tied to crew skills in crew lead access point mentioned in my
> skills comment"

- Source: `JobReport.tsx` (a button in the report's action/labor row). This is a
  design note that depends on #1 (the crew-lead gating). Lower priority / design.

### 5. yFyaZ1WtcHwD — No em dashes, app-wide
> "No em dashes app-wide!"

- Source: app-wide, user-facing strings across `frontend/src/**`. This is a
  sweep, not a single file. (Matches the standing no-em-dash rule already in
  place for the cleaning CRM.)

---

## Group B — Admin › Settings tab (`/admin`) → `frontend/src/pages/Admin.tsx`

All five threads below are on the **Settings tab** (`SettingsTab`, `Admin.tsx:2400-2421`),
which renders 8 cards in order: 1 Theme nav, 2 Advanced nav, 3 DVIRUnits,
4 EmployeeTags, 5 JobTypes, 6 Skills, 7 Furniture, 8 HelpText.

### 6. vqmrc0vS1bg6 — Furniture catalog export returns only 1 item
> "exported furniture catalogue only has 1 item in it..."

- Source (frontend): `Admin.tsx:2752-2774` (`exportCsv` in `FurnitureCatalogCard`,
  card 7). The fetch/blob path looks correct and the card's own count comes from
  `GET /api/furniture-catalog` (`:2724`).
- Likely root cause is **backend/data**: `GET /api/furniture-catalog/export-csv`
  (in `backend/app/routers/`) or the staging catalog genuinely having 1 row.
  Needs a backend look + a check of what the card's item count shows on staging.

### 7. FVxtTIplXob0 — Collapse EmployeeTags list (show first 3, expand)
> "can hide some of these with option to expand"
- Source: `EmployeeTagsManagerCard` (`Admin.tsx:2427+`, card 4).

### 8. vsZeVO9xYZM3 — Collapse JobTypes list (show first 3, expand)
> "dont need to see all at once; can show first 3 with option to expand the rest"
- Source: `JobTypesManagerCard` (`Admin.tsx:2597+`, card 5).

### 9. NoZ53BOqf9N3 — Collapse Skills list (show first 3, expand)
> "dont need to see all at once; can show first 3 with option to expand the rest"
- Source: `SkillsManagerCard` (`Admin.tsx:2842+`, card 6).

### 10. zfibvVoUwP-Z — Collapse HelpText list (show first 3, expand)
> "dont need to see all at once; can show first 3 with option to expand the rest"
- Source: `HelpTextCard` (`Admin.tsx:4380+`, card 8; the selector points at one
  of its inputs).

---

## Group C — Admin › Estimator tab (`/admin`) → `frontend/src/components/EstimatorTab.tsx`

### 11. 0lKqyGMyaR5A — Estimator tool won't be used as built
> "this feature will never be used as is. estimate tool is used on site during a
> walkthrough -> data collected is entered into our CRM and the estimate is
> generated from there -> created on google calendar as job"

- Mapped by **content** (the selector's card-3 position collides with the
  Settings tab's DVIR card across tabs; the text is unambiguously about the
  estimator). Source: `frontend/src/components/EstimatorTab.tsx` (rendered at
  `Admin.tsx:195`). This is a product-direction note — needs a conversation
  about what to do with the tab, not a mechanical fix.

---

## Threads to resolve after addressing
_Resolve in the Vercel Toolbar or via the Vercel MCP (`change_toolbar_thread_resolve_status`) once handled._

- [ ] W8IGacJ3Ii0x — / (skill ratings crew-lead gating)
- [ ] oF0nTf6qKwND — / (remove crew-lead hours confirmation)
- [ ] S6oGpfVToyhv — / (man hours, not hours)
- [ ] ezBYstUa0FA1 — / (labor buttons ↔ crew skills; design)
- [ ] yFyaZ1WtcHwD — / (no em dashes app-wide)
- [ ] vqmrc0vS1bg6 — /admin (furniture export only 1 item)
- [ ] FVxtTIplXob0 — /admin (collapse EmployeeTags)
- [ ] vsZeVO9xYZM3 — /admin (collapse JobTypes)
- [ ] NoZ53BOqf9N3 — /admin (collapse Skills)
- [ ] zfibvVoUwP-Z — /admin (collapse HelpText)
- [ ] 0lKqyGMyaR5A — /admin (estimator direction; product decision)
