from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def send_email(to_email: str, subject: str, text: str) -> None:
    """
    Minimal SMTP sender.
    - If SMTP_HOST isn't set, we print the email to logs (dev mode).
    - Postmark supports token auth (you set token as SMTP_USER + SMTP_PASS).
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

    with smtplib.SMTP(host, port) as s:
        s.starttls()
        if user and password:
            s.login(user, password)
        s.send_message(msg)
