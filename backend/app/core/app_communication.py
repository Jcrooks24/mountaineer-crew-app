"""
App communication: admin-editable bodies for every email the app sends.

Each outbound email is a TEMPLATE with a stable key, a default subject and body,
and a fixed set of PLACEHOLDERS the app fills in at send time. Admin edits the
wording in Settings; the app supplies the data. Stored as one SystemConfig JSON
blob under APP_COMMUNICATION_KEY.

Three rules this module exists to enforce:

1. **A template can never break sending.** Anything unreadable, missing, or
   malformed falls back to the built-in default. `render()` does not raise.
2. **Required placeholders cannot be removed.** A password-reset email without
   its link is not a wording preference, it is a broken email. `validate()`
   rejects the save rather than letting the admin discover it from a crew member
   who cannot log in.
3. **Substitution is literal and allowlisted.** No `str.format`, no eval, no
   attribute access. An unknown `{thing}` is left alone rather than raising, so
   a typo degrades to visible text instead of a 500 on a send path.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

APP_COMMUNICATION_KEY = "app_communication"

# {placeholder} - letters, digits, underscore only. Anything else is left as
# literal text, so prose like "{see attached}" survives untouched.
_TOKEN = re.compile(r"\{([a-z0-9_]+)\}")


class Placeholder(Dict[str, Any]):
    pass


def _p(name: str, desc: str, sample: str, required: bool = False) -> Dict[str, Any]:
    return {"name": name, "description": desc, "sample": sample, "required": required}


# ── The registry ─────────────────────────────────────────────────────────────
# Adding an email to the app? Add it here and call render() at the send site.
# A send site that formats its own body is invisible to admin, which is the
# thing this module exists to stop.
TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "password_reset",
        "label": "Password reset",
        "audience": "A crew member who asked to reset their password",
        "when": "Immediately, when someone taps 'forgot password' on the login screen.",
        "subject": "Reset your Mountaineer Crew App password",
        "body": (
            "Hi {name},\n\n"
            "Click the link below to reset your password. It expires in {expiry_hours} hour(s).\n\n"
            "{reset_link}\n\n"
            "If you didn't request this, you can ignore this email."
        ),
        "placeholders": [
            _p("name", "Their first name, or 'there' if we do not have a name on file.", "Dana"),
            _p("reset_link", "The one-time reset link. The email is useless without it.", "https://app.example.com/reset-password?token=abc123", required=True),
            _p("expiry_hours", "How long the link stays valid.", "1"),
        ],
    },
    {
        "key": "mechanic_signoff",
        "label": "Mechanic sign-off request",
        "audience": "The mechanic named on a DVIR with defects",
        "when": "When a crew member sends a DVIR for mechanic sign-off.",
        "subject": "Mechanic sign-off needed - {vehicle_number} (DVIR {inspection_date})",
        "body": (
            "Hi {mechanic_name},\n\n"
            "Mountaineer Moving needs a mechanic sign-off before vehicle "
            "{vehicle_number} can return to service.\n\n"
            "Inspection: {inspection_type} on {inspection_date}\n"
            "Reported by: {driver_name}\n"
            "Defects: {defects}\n"
            "{notes_line}\n"
            "Review the inspection and sign off here (link expires in {expiry_days} days):\n\n"
            "{sign_link}\n"
        ),
        "placeholders": [
            _p("mechanic_name", "The mechanic's name, if one was entered.", "Sam"),
            _p("vehicle_number", "The vehicle's unit number.", "Truck 12"),
            _p("inspection_type", "Pre-trip or post-trip.", "Post-trip"),
            _p("inspection_date", "Date of the inspection.", "2026-08-11"),
            _p("driver_name", "Who reported the defect.", "Dana Reyes"),
            _p("defects", "Comma-separated list of the defects noted.", "Brakes, Left mirror"),
            _p("notes_line", "The driver's notes, already formatted as its own line. Empty when there are none.", "Notes: pulls left under braking"),
            _p("sign_link", "The mechanic's one-time sign-off link. The email is useless without it.", "https://app.example.com/mechanic-sign?token=abc123", required=True),
            _p("expiry_days", "How long the sign-off link stays valid.", "14"),
        ],
    },
    {
        "key": "signed_bol",
        "label": "Signed Bill of Lading to the customer",
        "audience": "The customer on the job",
        "when": "When crew email the signed BOL from the field. The PDF is attached automatically.",
        "subject": "Your signed Bill of Lading - {job_name}",
        "body": (
            "Hello,\n\n"
            "Attached is the signed Bill of Lading for your move{job_date_suffix}.\n\n"
            "Please keep a copy for your records. If you have any questions, "
            "reply to this email or call us at {company_phone}.\n\n"
            "Thank you,\n"
            "{company_name}"
        ),
        "placeholders": [
            _p("job_name", "The job / customer name on the BOL.", "Reyes - Bozeman to Billings"),
            _p("job_date_suffix", "Reads ' on 2026-08-11', or empty when the job has no date.", " on 2026-08-11"),
            _p("company_name", "Your company name.", "Mountaineer Moving LLC"),
            _p("company_phone", "Your contact number.", "(406) 201-9580"),
        ],
    },
    {
        "key": "hours_correction",
        "label": "Hours corrected on a job",
        "audience": "The crew member whose hours changed",
        "when": "When you initial a job on the Job Summary. Sent once per correction.",
        "subject": "Correction to your hours on {job_name}",
        "body": (
            "Hi {first_name},\n\n"
            "Your reported hours on {job_name} ({work_date}) were reviewed and "
            "corrected before payroll. Here is exactly what changed:\n\n"
            "{corrections}\n\n"
            "These are the numbers being paid. If any of this looks wrong, reply to "
            "this email or talk to the office before the next pay period closes.\n\n"
            "{company_name}\n"
        ),
        "placeholders": [
            _p("first_name", "Their first name.", "Dana"),
            _p("employee_name", "Their full name.", "Dana Reyes"),
            _p("job_name", "The job the correction is on.", "Reyes - Bozeman to Billings"),
            _p("work_date", "The job's work date.", "2026-08-11"),
            _p("corrections", "The before/after lines, one per correction. Built by the app.", "Regular hours: 8.5 -> 8.0\nReason: lunch not deducted", required=True),
            _p("company_name", "Your company name.", "Mountaineer Moving"),
        ],
    },
    {
        "key": "billing_correction",
        "label": "Billing corrected on a job",
        "audience": "The crew member on the job",
        "when": "When you correct a job's billing from the Job Summary.",
        "subject": "Billing correction for {job_name}",
        "body": (
            "Hi {first_name},\n\n"
            "The billing on {job_name} was reviewed and corrected by the office.\n\n"
            "{total_line}\n"
            "Reason: {reason}\n\n"
            "If any of this looks wrong, reply to this email or talk to the office.\n\n"
            "{company_name}\n"
        ),
        "placeholders": [
            _p("first_name", "Their first name.", "Dana"),
            _p("employee_name", "Their full name.", "Dana Reyes"),
            _p("job_name", "The job.", "Reyes - Bozeman to Billings"),
            _p("total_line", "A sentence stating the before/after total, or that it did not change. Built by the app.", "The bill total changed from $1,240.00 to $1,180.00."),
            _p("reason", "The reason you recorded for the correction.", "Truck hours billed at the wrong rate"),
            _p("company_name", "Your company name.", "Mountaineer Moving"),
        ],
    },
]

BY_KEY: Dict[str, Dict[str, Any]] = {t["key"]: t for t in TEMPLATES}


# ── Emails that exist but are NOT editable ───────────────────────────────────
# Visibility is the point. An email nobody can see is the problem this whole
# module exists to fix, and "you cannot edit it" is not a reason to hide it.
# Each entry says plainly WHY it is not editable and WHERE it actually lives, so
# the office has one complete list of everything the system sends.
READ_ONLY: List[Dict[str, Any]] = [
    {
        "key": "postmark_test",
        "label": "Postmark test email",
        "audience": "Whichever address you type into the test box",
        "when": "Only when you press 'send test email' in Settings.",
        "handled_by": "Crew app backend",
        "why_locked": (
            "It is a diagnostic, not a communication. Its whole job is to prove "
            "Postmark works, so its wording has to stay fixed or it cannot tell "
            "you anything."
        ),
        "subject": "Mountaineer Crew App Test",
        "body": "If you received this, Postmark is working correctly.",
    },
    {
        "key": "payroll_finalize",
        "label": "Pay period finalized, corrections summary",
        "audience": "Each crew member with a period-scoped correction",
        "when": "When you finalize a pay period, for corrections not already sent at job sign-off.",
        "handled_by": "Crew app backend",
        "why_locked": (
            "Not yet converted to a template. This one SHOULD be editable and is "
            "the next candidate; it is listed here so it is not invisible in the "
            "meantime."
        ),
        "subject": "(built from the period dates and the corrections it covers)",
        "body": (
            "Built in payroll.py::_finalize_email. Greets the crew member, states the "
            "pay period, lists each correction with its before and after, and closes "
            "with a note to raise anything that looks wrong with the office."
        ),
    },
    {
        "key": "apps_script_nightly",
        "label": "Nightly crew feedback and incidents digest",
        "audience": "management@mountaineermoving.com",
        "when": "Once a day at approximately 9 PM.",
        "handled_by": "Google Apps Script, bound to the Sheet. NOT the crew app.",
        "why_locked": (
            "It does not run in the crew app at all. It is a script bound to the "
            "Google Sheet (apps_script/nightly_crew_email.gs), it sends through "
            "MailApp rather than Postmark, and it is not deployed by CI: the repo "
            "holds the source of truth, but what actually runs is whatever was last "
            "pasted into the Sheet's Apps Script editor. To change it, edit it "
            "there. Nothing in this screen affects it."
        ),
        "subject": "(varies with what it found: crew feedback, incidents, bug reports, feature requests)",
        "body": (
            "Scans the JobReports and Incidents tabs for anything the office has not "
            "been told about yet, and mails the batch with photo links. It tracks what "
            "it has already sent in its own log tabs, because the backend rewrites "
            "JobReports and Incidents rows on every save and would wipe a flag written "
            "onto them. An item re-sends if its crew-authored content changes."
        ),
    },
]


def catalog() -> List[Dict[str, Any]]:
    """The registry as the admin UI needs it: defaults + placeholder help."""
    return [
        {
            "key": t["key"],
            "label": t["label"],
            "audience": t["audience"],
            "when": t["when"],
            "handled_by": "Crew app backend",
            "editable": True,
            "default_subject": t["subject"],
            "default_body": t["body"],
            "placeholders": t["placeholders"],
        }
        for t in TEMPLATES
    ]


def read_only_catalog() -> List[Dict[str, Any]]:
    """Every email the system sends that this screen cannot change."""
    return [
        {
            "key": r["key"],
            "label": r["label"],
            "audience": r["audience"],
            "when": r["when"],
            "handled_by": r["handled_by"],
            "editable": False,
            "why_locked": r["why_locked"],
            "subject": r["subject"],
            "body": r["body"],
            "placeholders": [],
        }
        for r in READ_ONLY
    ]


def _stored(raw: Any) -> Dict[str, Dict[str, str]]:
    """Coerce whatever is in SystemConfig into {key: {subject, body}}. Anything
    unrecognized is dropped rather than trusted - a half-parsed template is how
    you end up mailing `{reset_link}` as literal text to a crew member."""
    out: Dict[str, Dict[str, str]] = {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return out
    if not isinstance(raw, dict):
        return out
    items = raw.get("templates") if isinstance(raw.get("templates"), dict) else raw
    if not isinstance(items, dict):
        return out
    for key, v in items.items():
        if key not in BY_KEY or not isinstance(v, dict):
            continue
        subject = v.get("subject")
        body = v.get("body")
        entry: Dict[str, str] = {}
        if isinstance(subject, str) and subject.strip():
            entry["subject"] = subject
        if isinstance(body, str) and body.strip():
            entry["body"] = body
        if entry:
            out[key] = entry
    return out


def load(db) -> Dict[str, Dict[str, str]]:
    """Admin overrides, or {} if unset/unreadable. Never raises: this sits on
    every send path and a config problem must not stop an email."""
    try:
        from app.db.models.system_config import SystemConfig
        row = db.query(SystemConfig).filter(SystemConfig.key == APP_COMMUNICATION_KEY).first()
        return _stored(row.value) if row and row.value else {}
    except Exception as exc:  # noqa: BLE001
        print(f"[app-communication] could not load overrides, using defaults: {exc}")
        return {}


def validate(key: str, subject: str, body: str) -> List[str]:
    """Errors that must block a save. Empty list means OK."""
    t = BY_KEY.get(key)
    if t is None:
        return [f"Unknown template '{key}'."]
    errors: List[str] = []
    if not (subject or "").strip():
        errors.append("Subject cannot be empty.")
    if not (body or "").strip():
        errors.append("Body cannot be empty.")

    known = {p["name"] for p in t["placeholders"]}
    used = set(_TOKEN.findall(f"{subject}\n{body}"))

    for p in t["placeholders"]:
        if p.get("required") and p["name"] not in used:
            errors.append(
                f"{{{p['name']}}} is required and is missing. {p['description']} "
                f"Without it this email cannot do its job."
            )
    for unknown in sorted(used - known):
        errors.append(
            f"{{{unknown}}} is not a placeholder for this email, so it would be "
            f"sent as literal text. Available: "
            + ", ".join("{" + n + "}" for n in sorted(known))
        )
    return errors


def _substitute(template: str, values: Dict[str, Any]) -> str:
    """Literal allowlisted substitution. An unknown token is left as-is so a
    typo shows up as visible text rather than raising on a send path."""
    def repl(m: "re.Match[str]") -> str:
        name = m.group(1)
        return "" if values.get(name) is None else str(values[name])
    return _TOKEN.sub(lambda m: repl(m) if m.group(1) in values else m.group(0), template)


def render(db, key: str, values: Dict[str, Any]) -> Tuple[str, str]:
    """(subject, body) for a template, using the admin's version when there is
    one and the built-in default otherwise.

    Never raises. If an override is somehow unusable we fall back to the default
    rather than fail the send: a crew member getting the stock wording is a
    non-event, a crew member getting no email is not.
    """
    t = BY_KEY.get(key)
    if t is None:
        raise KeyError(f"unknown communication template '{key}'")
    override = load(db).get(key, {})
    subject_tpl = override.get("subject") or t["subject"]
    body_tpl = override.get("body") or t["body"]
    try:
        return _substitute(subject_tpl, values), _substitute(body_tpl, values)
    except Exception as exc:  # noqa: BLE001
        print(f"[app-communication] render failed for '{key}', using default: {exc}")
        return _substitute(t["subject"], values), _substitute(t["body"], values)


def preview(key: str, subject: Optional[str], body: Optional[str]) -> Tuple[str, str]:
    """Render with each placeholder's sample value, so admin sees the shape of a
    real send before saving."""
    t = BY_KEY.get(key)
    if t is None:
        raise KeyError(f"unknown communication template '{key}'")
    samples = {p["name"]: p["sample"] for p in t["placeholders"]}
    return (
        _substitute(subject if subject is not None else t["subject"], samples),
        _substitute(body if body is not None else t["body"], samples),
    )
