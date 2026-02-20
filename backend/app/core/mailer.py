from __future__ import annotations

import os
import smtplib
import traceback
from email.message import EmailMessage


def send_email(to_email: str, subject: str, text: str) -> None:
    """
    Minimal SMTP sender.
    - Uses SMTP_HOST/PORT/USER/PASS/FROM from env.
    - If SMTP_HOST is missing, prints email to logs (dev mode).
    """
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        print("=== EMAIL (DEV MODE) ===")
        print("TO:", to_email)
        print("SUBJECT:", subject)
        print(text)
        print("========================")
        return

    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("SMTP_FROM", user)

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)

    try:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.set_debuglevel(1)  # TEMP: emits SMTP dialogue to Render logs
            s.ehlo()
            s.starttls()
            s.ehlo()
            if user and password:
                s.login(user, password)
            s.send_message(msg)
            print("SMTP SEND OK")
    except Exception as e:
        print("SMTP SEND FAILED:", repr(e))
        traceback.print_exc()
        raise
