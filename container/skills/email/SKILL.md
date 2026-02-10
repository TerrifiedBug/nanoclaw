---
name: email-read
description: Read-only email access via IMAP. Use when the user asks about their email, wants an inbox summary, or for morning digest email sections. Supports Gmail, Yahoo, Outlook, and any IMAP provider. This skill is READ ONLY — never send, delete, or modify emails.
allowed-tools: Bash(python3:*, curl:*)
---

# Email Reader (IMAP — Read Only)

Read emails from multiple accounts via IMAP. **This skill is strictly read-only** — never send, delete, or modify emails.

All accounts are configured in the `$EMAIL_ACCOUNTS` environment variable as a JSON array. Run `/add-imap-read` on the host to configure accounts.

## Quick Check — Unread Count

```bash
python3 -c "
import imaplib, json, os
accounts = json.loads(os.environ['EMAIL_ACCOUNTS'])
for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a['host'], a.get('port', 993))
        m.login(a['user'], a['pass'])
        m.select('INBOX', readonly=True)
        _, data = m.search(None, 'UNSEEN')
        count = len(data[0].split()) if data[0] else 0
        print(f\"{a['name']}: {count} unread\")
        m.close(); m.logout()
    except Exception as e:
        print(f\"{a['name']}: ERROR - {e}\")
"
```

## Read Unread Emails (Headers + Preview)

Returns JSON with sender, subject, date, and body preview for each unread message.

```bash
python3 << 'PYEOF'
import imaplib, email, json, os
from email.header import decode_header

def decode_hdr(val):
    if not val: return ""
    parts = decode_header(val)
    return " ".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )

def get_body_preview(msg, max_len=300):
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")[:max_len]
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")[:max_len]
    return ""

accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
results = []

for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a["host"], a.get("port", 993))
        m.login(a["user"], a["pass"])
        m.select("INBOX", readonly=True)
        _, data = m.search(None, "UNSEEN")
        uids = data[0].split() if data[0] else []
        for uid in uids[-20:]:  # Last 20 unread max
            _, msg_data = m.fetch(uid, "(BODY.PEEK[])")
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            results.append({
                "account": a["name"],
                "uid": uid.decode(),
                "from": decode_hdr(msg["From"]),
                "subject": decode_hdr(msg["Subject"]),
                "date": msg["Date"],
                "preview": get_body_preview(msg)
            })
        m.close(); m.logout()
    except Exception as e:
        results.append({"account": a["name"], "error": str(e)})

print(json.dumps(results, indent=2))
PYEOF
```

## Read Emails from Last 24 Hours (For Digest)

Fetches all emails from the last 24 hours regardless of read status.

```bash
python3 << 'PYEOF'
import imaplib, email, json, os
from datetime import datetime, timedelta
from email.header import decode_header

def decode_hdr(val):
    if not val: return ""
    parts = decode_header(val)
    return " ".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )

def get_body_preview(msg, max_len=300):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")[:max_len]
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")[:max_len]
    return ""

since = (datetime.now() - timedelta(days=1)).strftime("%d-%b-%Y")
accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
results = []

for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a["host"], a.get("port", 993))
        m.login(a["user"], a["pass"])
        m.select("INBOX", readonly=True)
        _, data = m.search(None, f"SINCE {since}")
        uids = data[0].split() if data[0] else []
        for uid in uids[-30:]:  # Last 30 max
            _, msg_data = m.fetch(uid, "(BODY.PEEK[])")
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            results.append({
                "account": a["name"],
                "uid": uid.decode(),
                "from": decode_hdr(msg["From"]),
                "subject": decode_hdr(msg["Subject"]),
                "date": msg["Date"],
                "preview": get_body_preview(msg)
            })
        m.close(); m.logout()
    except Exception as e:
        results.append({"account": a["name"], "error": str(e)})

print(json.dumps(results, indent=2))
PYEOF
```

## Search Emails by Keyword

```bash
python3 << 'PYEOF'
import imaplib, email, json, os, sys
from email.header import decode_header

KEYWORD = sys.argv[1] if len(sys.argv) > 1 else "invoice"

def decode_hdr(val):
    if not val: return ""
    parts = decode_header(val)
    return " ".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )

accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
results = []

for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a["host"], a.get("port", 993))
        m.login(a["user"], a["pass"])
        m.select("INBOX", readonly=True)
        _, data = m.search(None, f'SUBJECT "{KEYWORD}"')
        uids = data[0].split() if data[0] else []
        for uid in uids[-10:]:
            _, msg_data = m.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            results.append({
                "account": a["name"],
                "uid": uid.decode(),
                "from": decode_hdr(msg["From"]),
                "subject": decode_hdr(msg["Subject"]),
                "date": msg["Date"]
            })
        m.close(); m.logout()
    except Exception as e:
        results.append({"account": a["name"], "error": str(e)})

print(json.dumps(results, indent=2))
PYEOF
```

Replace `"invoice"` with the actual search term, or pass it as an argument.

## Read Full Email by UID

To read a specific email found in search results:

```bash
python3 << 'PYEOF'
import imaplib, email, json, os, sys
from email.header import decode_header

ACCOUNT_NAME = sys.argv[1]  # e.g., "Gmail"
UID = sys.argv[2]           # e.g., "12345"

def decode_hdr(val):
    if not val: return ""
    parts = decode_header(val)
    return " ".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )

def get_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    return ""

accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
account = next((a for a in accounts if a["name"] == ACCOUNT_NAME), None)
if not account:
    print(json.dumps({"error": f"Account '{ACCOUNT_NAME}' not found"}))
    exit(1)

m = imaplib.IMAP4_SSL(account["host"], account.get("port", 993))
m.login(account["user"], account["pass"])
m.select("INBOX", readonly=True)
_, msg_data = m.fetch(UID.encode(), "(BODY.PEEK[])")
raw = msg_data[0][1]
msg = email.message_from_bytes(raw)

print(json.dumps({
    "from": decode_hdr(msg["From"]),
    "to": decode_hdr(msg["To"]),
    "subject": decode_hdr(msg["Subject"]),
    "date": msg["Date"],
    "body": get_body(msg)
}, indent=2))

m.close(); m.logout()
PYEOF
```

## Setup

Set `EMAIL_ACCOUNTS` in `.env` as a JSON array:

```
EMAIL_ACCOUNTS=[{"name":"Gmail","host":"imap.gmail.com","port":993,"user":"you@gmail.com","pass":"xxxx xxxx xxxx xxxx"},{"name":"Yahoo","host":"imap.mail.yahoo.com","port":993,"user":"you@yahoo.com","pass":"xxxx xxxx xxxx xxxx"}]
```

**App passwords required:**
- Gmail: Google Account > Security > 2-Step Verification > App Passwords
- Yahoo: Yahoo Account > Account Security > Generate App Password
- Outlook: Microsoft Account > Security > App Passwords

## Notes

- All reads use `readonly=True` and `BODY.PEEK[]` — emails are never marked as read
- Body preview is limited to 300 characters to avoid huge outputs
- Unread fetch limited to 20 most recent, digest to 30, search to 10
- Connections use IMAP4_SSL (port 993) — always encrypted
