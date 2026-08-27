/**
 * Nightly crew email: crew feedback + incident reports (with photo links).
 *
 * This file is the SOURCE OF TRUTH for the script. It does not run from the
 * repo. To deploy: open the Sheet > Extensions > Apps Script, paste this file
 * over the existing code, Save. Then run installNightlyTrigger() once (only
 * needed if the trigger is missing or the hour changes).
 *
 * WHAT IT DOES
 * Scans two worksheets for anything the office has not been told about yet:
 *   - JobReports    -> rows where the crew left feedback
 *   - Incidents     -> incidents the crew filed, plus links to their photos
 * and emails the batch to management once a day.
 *
 * WHY A SEPARATE LOG TAB, NOT A "notified" COLUMN
 * The backend replaces the sheet row on every save (delete by uuid, then
 * append). Any flag written onto a JobReports or Incidents row would be wiped
 * the next time the crew saved. So "what have we already sent" lives in its own
 * tabs, keyed by uuid, which the backend never touches.
 *
 * RE-SENDING
 * An item is sent when its uuid is new, OR when its crew-authored content has
 * changed since the last send (hash mismatch). That is deliberate: a crew
 * member who edits their feedback, or attaches photos to an incident the
 * morning after filing it, should reach you rather than be swallowed. Those
 * come through marked "(updated)". Admin-only fields (resolved, est_cost,
 * notes) are excluded from the hash, so working a claim in the sheet never
 * re-emails it.
 *
 * The log tabs are not all the same width, so the hash column is located by
 * looking at the values, not by index or header. See findHashColumn_ - reading
 * it from a fixed column is what made this digest re-send its whole history
 * every night.
 */

const SHEET_ID = "1KDWNudFSc8tlqV7lzq-M235swkgq7jWg_63ilrw_9hk";

// Prod tabs. For the staging sheet use "JobReportsStaging" / "IncidentsStaging".
const JOB_REPORTS_TAB = "JobReports";
const INCIDENTS_TAB = "Incidents";

const FEEDBACK_LOG_TAB = "FeedbackEmailLog";
const INCIDENT_LOG_TAB = "IncidentEmailLog";
const BUGS_TAB = "Bugs";
const BUG_LOG_TAB = "BugEmailLog";
const FEATURE_REQUESTS_TAB = "FeatureRequests";
const FEATURE_LOG_TAB = "FeatureRequestEmailLog";

const RECIPIENT = "management@mountaineermoving.com";
const TZ = "America/Denver";

/**
 * Trigger entry point. The installed time-based trigger calls THIS function by
 * name, so do not rename it without reinstalling the trigger.
 */
function sendNightlyCrewEmail() {
  runNightlyDigest_(false);
}

/**
 * Legacy trigger entry point. An older trigger may still point at this name.
 * Kept as an alias so an existing installed trigger keeps working after this
 * script is pasted in. Safe to delete once installNightlyTrigger() has been
 * re-run (it repoints the trigger at sendNightlyCrewEmail).
 */
function sendNightlyFeedbackEmail() {
  runNightlyDigest_(false);
}

/**
 * Run by hand from the editor to see exactly what would be emailed, without
 * sending anything and without writing to the logs. Check View > Logs.
 */
function dryRunNightlyCrewEmail() {
  runNightlyDigest_(true);
}

function runNightlyDigest_(dryRun) {
  const t0 = Date.now();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  // Force pending writes from a prior run to land before we read the logs.
  // Apps Script can otherwise hand back a stale read immediately after a
  // setValues from the previous execution, which would resend everything.
  SpreadsheetApp.flush();

  const feedback = collectFeedback_(ss);
  const incidents = collectIncidents_(ss);
  const bugs = collectBugs_(ss);
  const features = collectFeatureRequests_(ss);

  if (feedback.length === 0 && incidents.length === 0 && bugs.length === 0 && features.length === 0) {
    Logger.log("Nothing new to send");
    return;
  }

  const subject = buildSubject_(feedback, incidents, bugs, features);
  const body = buildEmailBody_(feedback, incidents, bugs, features);

  if (dryRun) {
    Logger.log("--- DRY RUN. No email sent, no log written. ---");
    Logger.log("To: " + RECIPIENT);
    Logger.log("Subject: " + subject);
    Logger.log(body);
    return;
  }

  MailApp.sendEmail({ to: RECIPIENT, subject: subject, body: body });

  const stamp = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss");

  appendLog_(ss, FEEDBACK_LOG_TAB,
    ["job_uuid", "job_name", "submitted_by", "sent_at", "feedback_hash"],
    feedback.map(function (c) { return [c.uuid, c.jobName, c.submittedBy, stamp, c.hash]; }));

  appendLog_(ss, INCIDENT_LOG_TAB,
    ["incident_uuid", "claim_number", "job_name", "sent_at", "content_hash"],
    incidents.map(function (c) { return [c.uuid, c.claimNumber, c.jobName, stamp, c.hash]; }));

  appendLog_(ss, BUG_LOG_TAB,
    ["bug_uuid", "submitted_by", "sent_at", "content_hash"],
    bugs.map(function (c) { return [c.uuid, c.submittedBy, stamp, c.hash]; }));

  appendLog_(ss, FEATURE_LOG_TAB,
    ["request_uuid", "submitted_by", "sent_at", "content_hash"],
    features.map(function (c) { return [c.uuid, c.submittedBy, stamp, c.hash]; }));

  // Persist the log writes before this execution ends, so the next run reads
  // them back and does not resend what we just sent.
  SpreadsheetApp.flush();
  Logger.log(
    "Sent " + feedback.length + " feedback + " + incidents.length +
    " incident(s) + " + bugs.length + " bug(s) in " + (Date.now() - t0) + "ms"
  );
}

/** Crew feedback on job reports that has not been sent (or has changed). */
function collectFeedback_(ss) {
  const rows = readTab_(ss, JOB_REPORTS_TAB, [
    "job_uuid", "job_name", "submitted_by", "has_crew_feedback", "crew_feedback", "updated_at",
  ]);
  if (!rows) return [];

  const sent = readSentMap_(ss, FEEDBACK_LOG_TAB);
  Logger.log("Feedback log has " + Object.keys(sent).length + " entries");

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row["has_crew_feedback"]).trim().toLowerCase() !== "yes") continue;

    const fb = String(row["crew_feedback"] || "").trim();
    if (!fb) continue;

    const uuid = String(row["job_uuid"] || "").trim();
    // No uuid means no dedupe key: every blank-uuid row would share one entry in
    // the log and suppress the others. The other three collectors already skip
    // these; a JobReports row with no job_uuid is broken data, not feedback.
    if (!uuid) {
      Logger.log("Skipping feedback row " + (i + 2) + ": no job_uuid");
      continue;
    }

    const hash = hashString_(fb);
    if (alreadySent_(sent, uuid, hash)) continue;

    out.push({
      uuid: uuid,
      jobName: String(row["job_name"] || "(no job name)").trim(),
      submittedBy: String(row["submitted_by"] || "").trim(),
      updatedAt: row["updated_at"] || "",
      feedback: fb,
      hash: hash,
      isUpdate: wasLogged_(sent, uuid),
    });
  }
  return out;
}

/** Incidents that have not been sent, or whose crew-authored content changed. */
function collectIncidents_(ss) {
  const rows = readTab_(ss, INCIDENTS_TAB, [
    "incident_uuid", "claim_number", "incident_date", "job_name", "reported_by",
    "attributed_crew", "severity", "description", "photo_urls",
  ]);
  if (!rows) return [];

  const sent = readSentMap_(ss, INCIDENT_LOG_TAB);
  Logger.log("Incident log has " + Object.keys(sent).length + " entries");

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const uuid = String(row["incident_uuid"] || "").trim();
    if (!uuid) continue;

    const description = String(row["description"] || "").trim();
    const severity = String(row["severity"] || "").trim();
    const photos = splitPhotoUrls_(row["photo_urls"]);

    // Hash only what the CREW authored. Admin working the claim in the sheet
    // (resolved, est_cost, notes) must not trigger a re-send. Photos ARE in the
    // hash on purpose: they are usually attached after the incident is filed,
    // and an incident that reaches you with no photos is half a report.
    //
    // The NUL separator below is written as an escape on purpose. It used to be
    // a raw NUL byte sitting in this file, which made git treat the whole script
    // as binary and show no diff for any change to it - bad for a file that only
    // ships by being read and hand-pasted. It is the same character, so every
    // hash already in IncidentEmailLog still matches and nothing re-sends.
    const hash = hashString_([severity, description, photos.join("|")].join("\u0000"));
    if (alreadySent_(sent, uuid, hash)) continue;

    out.push({
      uuid: uuid,
      claimNumber: String(row["claim_number"] || "").trim(),
      incidentDate: String(row["incident_date"] || "").trim(),
      jobName: String(row["job_name"] || "").trim(),
      reportedBy: String(row["reported_by"] || "").trim(),
      attributedCrew: String(row["attributed_crew"] || "").trim(),
      severity: severity,
      description: description,
      photos: photos,
      hash: hash,
      isUpdate: wasLogged_(sent, uuid),
    });
  }
  return out;
}

/** Bug reports filed since the last run, or whose crew-authored content changed. */
function collectBugs_(ss) {
  const rows = readTab_(ss, BUGS_TAB, [
    "bug_uuid", "occurred_date", "submitted_by", "description", "screenshots",
  ]);
  if (!rows) return [];

  const sent = readSentMap_(ss, BUG_LOG_TAB);
  Logger.log("Bug log has " + Object.keys(sent).length + " entries");

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const uuid = String(row["bug_uuid"] || "").trim();
    if (!uuid) continue;

    const description = String(row["description"] || "").trim();
    const shots = splitPhotoUrls_(row["screenshots"]);
    // Hash the crew-authored content so a report is emailed once, and again only
    // if its text or screenshots change (e.g. a screenshot finished uploading).
    const hash = hashString_([description, shots.join("|")].join(" "));
    if (alreadySent_(sent, uuid, hash)) continue;

    out.push({
      uuid: uuid,
      occurredDate: String(row["occurred_date"] || "").trim(),
      submittedBy: String(row["submitted_by"] || "").trim(),
      description: description,
      screenshots: shots,
      hash: hash,
      isUpdate: wasLogged_(sent, uuid),
    });
  }
  return out;
}

function collectFeatureRequests_(ss) {
  const rows = readTab_(ss, FEATURE_REQUESTS_TAB, [
    "request_uuid", "title", "submitted_by", "description", "screenshots",
  ]);
  if (!rows) return [];

  const sent = readSentMap_(ss, FEATURE_LOG_TAB);
  Logger.log("Feature-request log has " + Object.keys(sent).length + " entries");

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const uuid = String(row["request_uuid"] || "").trim();
    if (!uuid) continue;

    const title = String(row["title"] || "").trim();
    const description = String(row["description"] || "").trim();
    const shots = splitPhotoUrls_(row["screenshots"]);
    // Hash the crew-authored content so a request is emailed once, and again only
    // if its text or images change.
    const hash = hashString_([title, description, shots.join("|")].join(" "));
    if (alreadySent_(sent, uuid, hash)) continue;

    out.push({
      uuid: uuid,
      title: title,
      submittedBy: String(row["submitted_by"] || "").trim(),
      description: description,
      screenshots: shots,
      hash: hash,
      isUpdate: wasLogged_(sent, uuid),
    });
  }
  return out;
}

function buildSubject_(feedback, incidents, bugs, features) {
  const f = feedback.length;
  const n = incidents.length;
  const b = bugs.length;
  const r = features.length;

  // Single-category subjects keep their original friendly wording.
  if (n === 0 && b === 0 && r === 0) {
    return f === 1 ? "Crew feedback: " + feedback[0].jobName : "Crew feedback: " + f + " jobs";
  }
  if (f === 0 && b === 0 && r === 0) {
    if (n === 1) {
      const inc = incidents[0];
      return "Incident: " + (inc.claimNumber || "incident") + (inc.jobName ? " - " + inc.jobName : "");
    }
    return "Incidents: " + n + " new";
  }
  if (f === 0 && n === 0 && r === 0) {
    return b === 1 ? "Bug report from " + (bugs[0].submittedBy || "crew") : "Bug reports: " + b + " new";
  }
  if (f === 0 && n === 0 && b === 0) {
    return r === 1 ? "Feature request from " + (features[0].submittedBy || "crew") : "Feature requests: " + r + " new";
  }
  const parts = [];
  if (f > 0) parts.push("crew feedback (" + f + ")");
  if (n > 0) parts.push("incidents (" + n + ")");
  if (b > 0) parts.push("bug reports (" + b + ")");
  if (r > 0) parts.push("feature requests (" + r + ")");
  return "Nightly digest: " + parts.join(", ");
}

function buildEmailBody_(feedback, incidents, bugs, features) {
  const lines = [];

  if (feedback.length > 0) {
    lines.push(
      "Crew feedback collected since the last nightly summary (" +
      feedback.length + " job" + (feedback.length === 1 ? "" : "s") + "):"
    );
    lines.push("");
    feedback.forEach(function (c, idx) {
      const date = formatDate_(c.updatedAt);
      lines.push(
        (idx + 1) + ". " + c.jobName +
        (date ? "  ·  " + date : "") +
        (c.isUpdate ? "  (updated)" : "")
      );
      if (c.submittedBy) lines.push("   Submitted by: " + c.submittedBy);
      lines.push("");
      lines.push(c.feedback);
      lines.push("");
      lines.push("---");
      lines.push("");
    });
  }

  if (incidents.length > 0) {
    lines.push(
      "INCIDENTS filed since the last nightly summary (" + incidents.length + "):"
    );
    lines.push("");
    incidents.forEach(function (c, idx) {
      const head = [c.claimNumber || "(no claim number)"];
      if (c.severity) head.push(c.severity);
      const date = c.incidentDate || "";
      if (date) head.push(date);

      lines.push(
        (idx + 1) + ". " + head.join("  ·  ") + (c.isUpdate ? "  (updated)" : "")
      );
      lines.push("   Job: " + (c.jobName || "(not tied to a job)"));
      if (c.reportedBy) lines.push("   Reported by: " + c.reportedBy);
      if (c.attributedCrew) lines.push("   Attributed to: " + c.attributedCrew);
      lines.push("");
      lines.push(c.description || "(no description)");
      lines.push("");
      if (c.photos.length > 0) {
        lines.push("   Photos (" + c.photos.length + "):");
        c.photos.forEach(function (url) {
          lines.push("     " + url);
        });
      } else {
        lines.push("   Photos: none attached");
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
  }

  if (bugs.length > 0) {
    lines.push(
      "BUG REPORTS filed since the last nightly summary (" + bugs.length + "):"
    );
    lines.push("");
    bugs.forEach(function (c, idx) {
      const date = c.occurredDate || "";
      lines.push(
        (idx + 1) + ". Bug report" + (date ? "  ·  occurred " + date : "") +
        (c.isUpdate ? "  (updated)" : "")
      );
      if (c.submittedBy) lines.push("   Reported by: " + c.submittedBy);
      lines.push("");
      lines.push(c.description || "(no description)");
      lines.push("");
      if (c.screenshots.length > 0) {
        lines.push("   Screenshots (" + c.screenshots.length + "):");
        c.screenshots.forEach(function (url) {
          lines.push("     " + url);
        });
      } else {
        lines.push("   Screenshots: none attached");
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
  }

  if (features.length > 0) {
    lines.push(
      "FEATURE REQUESTS filed since the last nightly summary (" + features.length + "):"
    );
    lines.push("");
    features.forEach(function (c, idx) {
      lines.push(
        (idx + 1) + ". " + (c.title || "Feature request") +
        (c.isUpdate ? "  (updated)" : "")
      );
      if (c.submittedBy) lines.push("   Requested by: " + c.submittedBy);
      lines.push("");
      lines.push(c.description || "(no description)");
      lines.push("");
      if (c.screenshots.length > 0) {
        lines.push("   Images (" + c.screenshots.length + "):");
        c.screenshots.forEach(function (url) {
          lines.push("     " + url);
        });
      }
      lines.push("---");
      lines.push("");
    });
  }

  return lines.join("\n");
}

/**
 * Read a tab into an array of objects keyed by the column names you asked for.
 * Reads only the span of columns actually needed, and returns null (with a log
 * line) if the tab is missing or has lost a required column, rather than
 * throwing and killing the whole nightly run.
 */
function readTab_(ss, tabName, wanted) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    Logger.log("Tab not found: " + tabName);
    return null;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Tab is empty: " + tabName);
    return null;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const index = {};
  const missing = [];
  wanted.forEach(function (name) {
    const at = headers.indexOf(name);
    if (at < 0) missing.push(name);
    index[name] = at;
  });
  if (missing.length > 0) {
    Logger.log(tabName + " is missing column(s): " + missing.join(", "));
    return null;
  }

  const positions = wanted.map(function (n) { return index[n]; });
  const minCol = Math.min.apply(null, positions);
  const maxCol = Math.max.apply(null, positions);
  const block = sheet
    .getRange(2, minCol + 1, lastRow - 1, maxCol - minCol + 1)
    .getValues();

  return block.map(function (row) {
    const obj = {};
    wanted.forEach(function (name) {
      obj[name] = row[index[name] - minCol];
    });
    return obj;
  });
}

/**
 * Find the column holding the content hash, by looking at the values rather
 * than at a fixed index or at the header row.
 *
 * WHY NOT A FIXED INDEX. It was column 5. That is right for the two five-column
 * logs (feedback, incidents) and wrong for the four-column bug and
 * feature-request logs, where column 5 holds nothing. Every lookup came back
 * empty, no stored hash could ever match, and the nightly digest re-sent every
 * bug report and every feature request ever filed, every night, forever. That
 * is the "the digest contains everything to date" report.
 *
 * WHY NOT THE HEADER ROW. These tabs are created once and never migrated:
 * getOrCreateSheet_ writes headers only when it makes the tab. A tab written by
 * an older generation of this script can carry a header row that no longer
 * describes the columns beneath it, so trusting the header would relocate this
 * bug rather than remove it.
 *
 * The hashes are 40-character lowercase hex from hashString_. Nothing else in
 * these logs (uuids are 36 with dashes, sent_at is a timestamp, the rest are
 * names) can be mistaken for one, so the data identifies its own column.
 */
function findHashColumn_(block) {
  const SHA1 = /^[0-9a-f]{40}$/;
  // Newest rows first: those are the ones the current script wrote.
  for (let r = block.length - 1; r >= 1; r--) {
    for (let c = 1; c < block[r].length; c++) {
      if (SHA1.test(String(block[r][c] || "").trim())) return c;
    }
  }
  return -1;
}

/** uuid -> hash of what we last sent for it. Last write wins. */
function readSentMap_(ss, tabName) {
  const log = ss.getSheetByName(tabName);
  if (!log) return {};
  const lastRow = log.getLastRow();
  const lastCol = log.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return {};

  // One read for the whole block so the uuid and hash indices cannot drift.
  const block = log.getRange(1, 1, lastRow, lastCol).getValues();
  const hashAt = findHashColumn_(block);
  if (hashAt < 0) {
    Logger.log(tabName + ": no hash column found, falling back to uuid-only dedupe");
  }

  const map = {};
  for (let r = 1; r < block.length; r++) {
    const uuid = String(block[r][0] || "").trim();
    if (!uuid) continue;
    map[uuid] = hashAt < 0 ? "" : String(block[r][hashAt] || "").trim();
  }
  return map;
}

/** True when this uuid has been in a digest before, whatever it said then. */
function wasLogged_(sent, uuid) {
  return Object.prototype.hasOwnProperty.call(sent, uuid);
}

/** True when this exact content has already gone out for this uuid. */
function alreadySent_(sent, uuid, hash) {
  if (!wasLogged_(sent, uuid)) return false;
  // "" means the row is logged but its hash could not be read. Presence alone
  // counts as sent: missing one edit beats re-sending the whole history every
  // night, which is the failure this dedupe exists to prevent.
  return sent[uuid] === "" || sent[uuid] === hash;
}

/**
 * Append what we just sent to a log tab. The write width comes from the rows
 * themselves, so the header list and the write can no longer disagree about how
 * wide the tab is - that disagreement is what broke the dedupe once already.
 */
function appendLog_(ss, tabName, headers, rows) {
  if (rows.length === 0) return;
  const log = getOrCreateSheet_(ss, tabName, headers);
  log.getRange(log.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function getOrCreateSheet_(ss, tabName, headers) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
  }
  return sheet;
}

/** The sheet stores photo_urls as a comma-joined list of Drive links. */
function splitPhotoUrls_(raw) {
  return String(raw || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function formatDate_(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, TZ, "MMM d, yyyy");
}

function hashString_(s) {
  // SHA-1 is plenty for "did this change since last time".
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
  }).join("");
}

/**
 * One-time setup: installs the nightly trigger. Run this manually from the
 * Apps Script editor. Re-running is safe: it clears old triggers for both the
 * current and the legacy handler name first, so you never end up with two
 * triggers sending two emails.
 */
function installNightlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      const fn = t.getHandlerFunction();
      return fn === "sendNightlyCrewEmail" || fn === "sendNightlyFeedbackEmail";
    })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger("sendNightlyCrewEmail")
    .timeBased()
    .atHour(21) // 9 PM Mountain
    .everyDays(1)
    .inTimezone(TZ)
    .create();

  Logger.log("Nightly trigger installed for 9 PM Mountain");
}
