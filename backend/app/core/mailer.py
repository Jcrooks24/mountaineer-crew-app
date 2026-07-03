from __future__ import annotations

import os
import json
import urllib.request
import urllib.error


def send_email(to_email: str, subject: str, text: str) -> None:
    """
    Sends transactional email via Postmark HTTP API (preferred).
    Falls back to DEV print if token missing.
    """
    token = os.getenv("POSTMARK_SERVER_TOKEN", "").strip()
    from_email = os.getenv("SMTP_FROM", "").strip()  # reuse your existing env var

    if not token or not from_email:
        print("=== EMAIL (DEV MODE) ===")
        print("TO:", to_email)
        print("SUBJECT:", subject)
        print(text)
        print("MISSING:", {
            "POSTMARK_SERVER_TOKEN": bool(token),
            "SMTP_FROM": bool(from_email),
        })
        print("========================")
        return

    payload = {
        "From": from_email,
        "To": to_email,
        "Subject": subject,
        "TextBody": text,
        "MessageStream": "outbound",  # default transactional stream
    }

    req = urllib.request.Request(
        url="https://api.postmarkapp.com/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": token,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status < 200 or resp.status >= 300:
                raise RuntimeError(f"Postmark API error {resp.status}: {body}")
            print("POSTMARK API SEND OK:", body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Postmark API HTTPError {e.code}: {err_body}") from e
    except Exception as e:
        raise RuntimeError(f"Postmark API send failed: {repr(e)}") from e