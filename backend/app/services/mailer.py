"""Outgoing mail. Without SMTP configured the message is logged, so password reset still works in local development."""
import logging
import smtplib
from email.message import EmailMessage

from ..config import settings

log = logging.getLogger("hirepilot.mail")


def send(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        log.warning("MAIL (SMTP not configured) to=%s subject=%s\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.mail_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    except Exception:  # never fail a request because mail is down; the user can retry
        log.exception("failed to send mail to %s", to)
