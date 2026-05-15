/**
 * Job Summary sidebar — server-side Apps Script.
 *
 * Adds a "Mountaineer ▸ Job Summary…" menu item that opens an HTML sidebar
 * for searching jobs by date and/or customer name, then rendering a
 * one-page summary pulling from the production worksheets:
 *   Events, Materials, JobReports, Bills, DVIRs.
 *
 * Long-distance mode additionally pulls RODS (Record of Duty Status) and
 * PriorOnDuty (Prior On-Duty Hours Statement) rows whose log_date /
 * statement_date intersects the job's event dates.
 *
 * Reads only. Never writes to the spreadsheet.
 *
 * Install
 * -------
 * 1. Open the Mountaineer crew-logs spreadsheet.
 * 2. Extensions → Apps Script.
 * 3. Paste this file's contents into Code.gs (or any .gs file).
 * 4. File → New → HTML, name it `job_summary_sidebar`, paste the contents
 *    of `apps_script/job_summary_sidebar.html` into it.
 * 5. Save. Reload the spreadsheet — "Mountaineer" menu appears.
 * 6. First run will prompt for spreadsheet permissions — accept.
 */

const PROD_TABS = {
  events: 'Events',
  materials: 'Materials',
  jobReports: 'JobReports',
  bills: 'Bills',
  dvirs: 'DVIRs',
  rods: 'RODS',
  priorOnDuty: 'PriorOnDuty',
};

// Mountain time is what the app uses end-to-end for crew-facing dates; matching
// it here keeps the sidebar's date strings consistent with the app and the
// invoice-block copy-paste flow office assistants already use.
const MOUNTAIN_TZ = 'America/Denver';

// Cached Intl formatters — substantially faster per call than
// Utilities.formatDate (cross-VM round-trip per cell). The hot path is
// searchJobs / _buildSummary scanning thousands of rows.
// `en-CA` is ISO-like: yyyy-MM-dd and 24h time.
const _FMT_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const _FMT_HM = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOUNTAIN_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

// Per-invocation memo for Date → string conversions. Each google.script.run
// call spins up a fresh V8 context, so these maps reset between client
// calls — no unbounded growth across sessions.
const _ymdMemo = new Map();
const _hmMemo = new Map();

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Mountaineer')
    .addItem('Job Summary…', 'showJobSummaryDialog')
    .addToUi();
}

function showJobSummaryDialog() {
  // Modal centered dialog — wider than a sidebar so the composite-summary
  // table has room to render multi-column comparisons without horizontal
  // scroll on a typical laptop.
  const html = HtmlService.createHtmlOutputFromFile('job_summary_sidebar')
    .setWidth(1200)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Job Summary');
}

// ── Tab reader ──────────────────────────────────────────────────────────────

function _readTab(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(tabName);
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { headers: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h));
  const rows = values.slice(1).map(row => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
    return obj;
  });
  return { headers, rows };
}

// ── Date / time helpers ─────────────────────────────────────────────────────

function _ymdOfDate(d) {
  const k = d.getTime();
  let hit = _ymdMemo.get(k);
  if (hit !== undefined) return hit;
  hit = _FMT_YMD.format(d);
  _ymdMemo.set(k, hit);
  return hit;
}

function _hmOfDate(d) {
  const k = d.getTime();
  let hit = _hmMemo.get(k);
  if (hit !== undefined) return hit;
  hit = _FMT_HM.format(d);
  _hmMemo.set(k, hit);
  return hit;
}

function _toYMD(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return _ymdOfDate(value);
  const s = String(value);
  // Fast path: ISO-prefixed strings (the common case for stringly-stored dates).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(s);
  if (!isNaN(d.getTime())) return _ymdOfDate(d);
  return '';
}

function _toTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return _hmOfDate(value);
  const d = new Date(String(value));
  if (!isNaN(d.getTime())) return _hmOfDate(d);
  return '';
}

function _toDateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return _ymdOfDate(value) + ' ' + _hmOfDate(value);
  const d = new Date(String(value));
  if (!isNaN(d.getTime())) return _ymdOfDate(d) + ' ' + _hmOfDate(d);
  return '';
}

function _updatedAtMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined || value === '') return 0;
  const d = new Date(String(value));
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Search for jobs by date and/or customer-name fragment.
 * Returns an array of { job_uuid, job_name, dates[], event_count, material_count }.
 *
 * `dateStr` is YYYY-MM-DD; `nameFragment` is a case-insensitive substring of
 * job_name. At least one must be provided.
 */
function searchJobs(dateStr, nameFragment) {
  const nf = (nameFragment || '').trim().toLowerCase();
  const ds = (dateStr || '').trim();
  if (!nf && !ds) throw new Error('Enter a date, a name, or both.');

  const events = _readTab(PROD_TABS.events);
  const materials = _readTab(PROD_TABS.materials);

  const byJob = new Map();

  function bump(uuid, name, dateYMD, kind) {
    if (!uuid) return;
    let b = byJob.get(uuid);
    if (!b) {
      b = { job_uuid: uuid, job_name: name || '', dates: new Set(), event_count: 0, material_count: 0 };
      byJob.set(uuid, b);
    }
    if (name && !b.job_name) b.job_name = String(name);
    if (dateYMD) b.dates.add(dateYMD);
    if (kind === 'event') b.event_count++;
    else if (kind === 'material') b.material_count++;
  }

  function rowDate(r, kind) {
    if (kind === 'event') return _toYMD(r.job_date) || _toYMD(r.timestamp) || _toYMD(r.logged_at);
    return _toYMD(r.job_date) || _toYMD(r.created_at);
  }

  function rowMatches(r, kind) {
    const name = String(r.job_name || '').toLowerCase();
    const matchesName = !nf || name.indexOf(nf) >= 0;
    const matchesDate = !ds || rowDate(r, kind) === ds;
    return matchesName && matchesDate;
  }

  if (events) {
    for (const r of events.rows) {
      if (!rowMatches(r, 'event')) continue;
      bump(String(r.job_uuid || ''), r.job_name, rowDate(r, 'event'), 'event');
    }
  }
  if (materials) {
    for (const r of materials.rows) {
      if (!rowMatches(r, 'material')) continue;
      bump(String(r.job_uuid || ''), r.job_name, rowDate(r, 'material'), 'material');
    }
  }

  const out = Array.from(byJob.values()).map(b => ({
    job_uuid: b.job_uuid,
    job_name: b.job_name,
    dates: Array.from(b.dates).sort(),
    event_count: b.event_count,
    material_count: b.material_count,
  }));

  // Newest job first, by latest date; ties break by job_name asc.
  out.sort((a, b) => {
    const da = a.dates[a.dates.length - 1] || '';
    const db = b.dates[b.dates.length - 1] || '';
    if (da !== db) return db < da ? -1 : 1;
    return a.job_name.localeCompare(b.job_name);
  });

  return out;
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * Build a structured one-job summary by joining every production worksheet on
 * `jobUuid` (Events, Materials, JobReports, Bills). DVIRs are matched by
 * inspection_date intersecting the job's event dates, since DVIRs aren't
 * keyed on job_uuid in the sheet. When `longDistance` is true, RODS and
 * PriorOnDuty rows are matched the same way (log_date / statement_date
 * intersecting the job's dates).
 */
function getJobSummary(jobUuid, longDistance) {
  if (!jobUuid) throw new Error('jobUuid required');
  const ld = !!longDistance;
  return _buildSummary(String(jobUuid), _loadAllTabs(ld), ld);
}

/**
 * Build a summary for each job_uuid in `uuids`, returned in the same order.
 * Used by the composite-summary view so every tab is read once total
 * (not once per job) — meaningful when comparing 5–10 jobs over a slow
 * connection.
 */
function getJobSummariesByUuids(uuids, longDistance) {
  if (!Array.isArray(uuids) || uuids.length === 0) return [];
  const ld = !!longDistance;
  const tabs = _loadAllTabs(ld);
  return uuids.map(u => _buildSummary(String(u), tabs, ld));
}

function _loadAllTabs(longDistance) {
  const tabs = {
    events: _readTab(PROD_TABS.events),
    materials: _readTab(PROD_TABS.materials),
    jobReports: _readTab(PROD_TABS.jobReports),
    bills: _readTab(PROD_TABS.bills),
    dvirs: _readTab(PROD_TABS.dvirs),
  };
  if (longDistance) {
    tabs.rods = _readTab(PROD_TABS.rods);
    tabs.priorOnDuty = _readTab(PROD_TABS.priorOnDuty);
  }
  return tabs;
}

function _buildSummary(jobUuid, tabs, longDistance) {
  const events = tabs.events;
  const materials = tabs.materials;
  const jobReports = tabs.jobReports;
  const bills = tabs.bills;
  const dvirs = tabs.dvirs;
  const rods = tabs.rods;
  const priorOnDuty = tabs.priorOnDuty;

  const eventRows = (events ? events.rows : []).filter(r => String(r.job_uuid) === jobUuid);
  const materialRows = (materials ? materials.rows : []).filter(r => String(r.job_uuid) === jobUuid);
  const jobReportRows = (jobReports ? jobReports.rows : []).filter(r => String(r.job_uuid) === jobUuid);
  const billRows = (bills ? bills.rows : []).filter(r => String(r.job_uuid) === jobUuid);

  let jobName = '';
  const dateSet = new Set();
  for (const r of eventRows) {
    if (!jobName && r.job_name) jobName = String(r.job_name);
    const d = _toYMD(r.job_date) || _toYMD(r.timestamp);
    if (d) dateSet.add(d);
  }
  for (const r of materialRows) {
    if (!jobName && r.job_name) jobName = String(r.job_name);
    const d = _toYMD(r.job_date) || _toYMD(r.created_at);
    if (d) dateSet.add(d);
  }
  // Fallback: jobs with only a JobReport or Bill (no Events/Materials)
  // would otherwise miss DVIRs/RODS/PriorOnDuty matching. Seed dateSet
  // from those rows' created_at / updated_at.
  if (dateSet.size === 0) {
    for (const r of jobReportRows) {
      const d = _toYMD(r.updated_at) || _toYMD(r.created_at);
      if (d) dateSet.add(d);
    }
    for (const r of billRows) {
      const d = _toYMD(r.created_at) || _toYMD(r.updated_at);
      if (d) dateSet.add(d);
    }
  }
  const jobDates = Array.from(dateSet).sort();

  // DVIRs: heuristic match — inspection_date falls on one of the job's dates.
  const dvirRows = (dvirs ? dvirs.rows : []).filter(r => {
    const d = _toYMD(r.inspection_date);
    return d && dateSet.has(d);
  });

  // RODS / PriorOnDuty: same heuristic — log_date / statement_date falls on
  // one of the job's dates. Only loaded in long-distance mode.
  const rodsRows = longDistance
    ? (rods ? rods.rows : []).filter(r => {
        const d = _toYMD(r.log_date);
        return d && dateSet.has(d);
      })
    : [];
  const priorHoursRows = longDistance
    ? (priorOnDuty ? priorOnDuty.rows : []).filter(r => {
        const d = _toYMD(r.statement_date);
        return d && dateSet.has(d);
      })
    : [];

  // TIMESTAMPS — events sorted ascending; JOB_NOTES sentinel rows excluded
  // (they're a transport for the global notes textarea, not crew activity).
  const timestamps = eventRows
    .filter(r => String(r.type) !== 'JOB_NOTES' && r.timestamp)
    .map(r => ({
      type: String(r.type || ''),
      time: _toTime(r.timestamp),
      datetime: _toDateTime(r.timestamp),
      note: r.note ? String(r.note) : '',
      created_by: r.created_by ? String(r.created_by) : '',
    }))
    .sort((a, b) => a.datetime.localeCompare(b.datetime));

  // MATERIALS — aggregate qty per item name across every submission; sum line
  // totals for a back-of-the-envelope materials charge.
  const matAgg = new Map();
  let materialsTotal = 0;
  for (const r of materialRows) {
    const name = String(r.item_name || '');
    if (!name) continue;
    const qty = Number(r.qty) || 0;
    matAgg.set(name, (matAgg.get(name) || 0) + qty);
    const lt = Number(r.line_total);
    if (!isNaN(lt)) materialsTotal += lt;
  }
  const materialsAggregated = Array.from(matAgg.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // JOB REPORT — keep the most-recent row by updated_at. employee_hours is
  // already a pre-formatted multi-line string from the backend.
  let jobReport = null;
  if (jobReportRows.length > 0) {
    // Sort by absolute timestamp, descending. Earlier impl used
    // String(Date).localeCompare which compares by day-name first
    // ("Tue May 13 …" vs "Wed May 14 …") and picked the wrong row.
    jobReportRows.sort((a, b) => _updatedAtMillis(b.updated_at) - _updatedAtMillis(a.updated_at));
    const r = jobReportRows[0];
    jobReport = {
      submitted_by: String(r.submitted_by || ''),
      personal_vehicles: r.personal_vehicles,
      dumpster_pct: r.dumpster_pct,
      recycling_pct: r.recycling_pct,
      billing_method: String(r.billing_method || ''),
      review_candidate: String(r.review_candidate || ''),
      hours_match: String(r.hours_match || ''),
      hours_mismatch_reason: String(r.hours_mismatch_reason || ''),
      employee_hours: String(r.employee_hours || ''),
      updated_at: _toDateTime(r.updated_at),
    };
  }

  // BILL — every row is one line item; first row carries the global discount
  // and notes (they're duplicated across rows on export). Total = sum of
  // item_amount, then apply the global discount once.
  let billTotal = 0;
  const billItems = billRows.map(r => {
    const qty = Number(r.item_qty) || 0;
    const rate = Number(r.item_rate) || 0;
    const disc = Number(r.item_discount_pct) || 0;
    const amount = Number(r.item_amount);
    if (!isNaN(amount)) billTotal += amount;
    return {
      label: String(r.item_label || ''),
      qty,
      unit: String(r.item_unit || ''),
      rate,
      discount: disc,
      amount: isNaN(amount) ? null : amount,
      source: String(r.item_source || ''),
    };
  });
  const billGlobalDiscount = billRows.length > 0 ? (Number(billRows[0].global_discount_pct) || 0) : 0;
  const billNotes = billRows.length > 0 ? String(billRows[0].bill_notes || '') : '';
  if (billGlobalDiscount > 0) billTotal = billTotal * (1 - billGlobalDiscount / 100);
  billTotal = Math.round(billTotal * 100) / 100;

  // DVIRS
  const dvirsOut = dvirRows.map(r => ({
    dvir_id: String(r.dvir_id || ''),
    phase: String(r.phase || ''),
    inspection_type: String(r.inspection_type || ''),
    inspection_date: _toYMD(r.inspection_date) || String(r.inspection_date || ''),
    vehicle_number: String(r.vehicle_number || ''),
    trailer_number: String(r.trailer_number || ''),
    driver_name: String(r.driver_name || ''),
    condition: String(r.condition || ''),
    defects: String(r.defects || ''),
    defect_notes: String(r.defect_notes || ''),
    mechanic_name: String(r.mechanic_name || ''),
    created_at: _toDateTime(r.created_at),
  }));

  // RODS — one row per driver per day, sorted by log_date then driver_name.
  const rodsOut = rodsRows.map(r => ({
    rods_id: String(r.rods_id || ''),
    log_date: _toYMD(r.log_date) || String(r.log_date || ''),
    driver_name: String(r.driver_name || ''),
    co_driver_name: String(r.co_driver_name || ''),
    vehicle_number: String(r.vehicle_number || ''),
    trailer_number: String(r.trailer_number || ''),
    origin: String(r.origin || ''),
    destination: String(r.destination || ''),
    total_miles: String(r.total_miles || ''),
    shipping_docs: String(r.shipping_docs || ''),
    carrier: String(r.carrier || ''),
    total_off_duty: String(r.total_off_duty || ''),
    total_sleeper: String(r.total_sleeper || ''),
    total_driving: String(r.total_driving || ''),
    total_on_duty: String(r.total_on_duty || ''),
    duty_changes: String(r.duty_changes || ''),
    remarks: String(r.remarks || ''),
    signed_at: _toDateTime(r.signed_at),
  })).sort((a, b) => {
    if (a.log_date !== b.log_date) return a.log_date.localeCompare(b.log_date);
    return a.driver_name.localeCompare(b.driver_name);
  });

  // PRIOR ON-DUTY HOURS STATEMENTS — one row per driver per trip.
  const priorHoursOut = priorHoursRows.map(r => ({
    statement_id: String(r.statement_id || ''),
    statement_date: _toYMD(r.statement_date) || String(r.statement_date || ''),
    driver_name: String(r.driver_name || ''),
    hours_last_24: String(r.hours_last_24 || ''),
    total_last_7: String(r.total_last_7 || ''),
    daily_breakdown: String(r.daily_breakdown || ''),
    signed_at: _toDateTime(r.signed_at),
  })).sort((a, b) => {
    if (a.statement_date !== b.statement_date) return a.statement_date.localeCompare(b.statement_date);
    return a.driver_name.localeCompare(b.driver_name);
  });

  const out = {
    job_uuid: jobUuid,
    job_name: jobName,
    job_dates: jobDates,
    timestamps,
    materials_aggregated: materialsAggregated,
    materials_total: Math.round(materialsTotal * 100) / 100,
    job_report: jobReport,
    bill: billRows.length > 0 ? {
      items: billItems,
      global_discount_pct: billGlobalDiscount,
      notes: billNotes,
      total: billTotal,
    } : null,
    dvirs: dvirsOut,
  };
  if (longDistance) {
    out.long_distance = true;
    out.rods = rodsOut;
    out.prior_hours = priorHoursOut;
  }
  return out;
}
