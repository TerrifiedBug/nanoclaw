---
name: add-imap-read
description: Add read-only IMAP email access to NanoClaw agent containers. Supports multiple providers (Gmail, Yahoo, Outlook, any IMAP server). Guides through app password setup and configures environment variables. Triggers on "add email", "add imap", "email integration", "read emails".
---

# Add IMAP Email Reader

This skill configures read-only email access for agent containers via IMAP. Supports multiple providers simultaneously.

**What this does:**
- Stores IMAP credentials in `.env` as `EMAIL_ACCOUNTS` JSON
- Creates the `plugins/imap-read/` plugin directory with env var config and agent skill
- Agents can then read/search/summarize emails — never send

**What this does NOT do:**
- No email sending capability
- No OAuth setup — uses simple app passwords
- No email polling or channel mode — read on-demand only

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- For Gmail: 2-Step Verification enabled on the Google Account
- For Yahoo: Account Security settings accessible

## Step 1: Check Existing Configuration

```bash
grep "^EMAIL_ACCOUNTS=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
ls plugins/imap-read/plugin.json 2>/dev/null && echo "PLUGIN_EXISTS" || echo "NO_PLUGIN"
```

If `ALREADY_CONFIGURED`, ask the user if they want to add another account or reconfigure.

## Step 2: Gather Account Details

Ask the user which email providers they want to add. For each account, collect:

1. **Provider name** (e.g., "Gmail", "Yahoo", "Work")
2. **IMAP host** (auto-fill based on provider):
   - Gmail: `imap.gmail.com`
   - Yahoo: `imap.mail.yahoo.com`
   - Outlook/Hotmail: `outlook.office365.com`
   - Other: ask for the IMAP server address
3. **Email address** (username for IMAP login)
4. **App password** (NOT the regular account password)

### App Password Instructions

**Gmail:**
> To create a Gmail app password:
> 1. Go to https://myaccount.google.com/apppasswords
> 2. You must have 2-Step Verification enabled
> 3. Select "Other" as the app name, enter "NanoClaw"
> 4. Copy the 16-character password (spaces don't matter)

**Yahoo:**
> To create a Yahoo app password:
> 1. Go to https://login.yahoo.com/account/security
> 2. Click "Generate app password"
> 3. Select "Other app", enter "NanoClaw"
> 4. Copy the generated password

**Outlook/Hotmail:**
> To create an Outlook app password:
> 1. Go to https://account.microsoft.com/security
> 2. Under "Additional security", enable 2-Step Verification if not already
> 3. Go to "App passwords" > Create a new app password
> 4. Copy the generated password

Tell the user to generate the app password now and paste it when ready.

## Step 3: Build EMAIL_ACCOUNTS JSON

Construct the JSON array from the collected details. Each account is an object:

```json
[
  {
    "name": "Gmail",
    "host": "imap.gmail.com",
    "port": 993,
    "user": "user@gmail.com",
    "pass": "xxxx xxxx xxxx xxxx"
  },
  {
    "name": "Yahoo",
    "host": "imap.mail.yahoo.com",
    "port": 993,
    "user": "user@yahoo.com",
    "pass": "xxxx xxxx xxxx xxxx"
  }
]
```

## Step 4: Save to .env

Write the `EMAIL_ACCOUNTS` variable to `.env`. If it already exists, replace it.

```bash
# Remove existing line if present
sed -i '/^EMAIL_ACCOUNTS=/d' .env

# Add the new configuration (single line, no wrapping)
echo 'EMAIL_ACCOUNTS=THE_JSON_ARRAY_HERE' >> .env
```

**Important:** The JSON must be on a single line with no line breaks.

## Step 5: Create Plugin Directory

Create the plugin directory with `plugin.json` and the agent skill:

```bash
mkdir -p plugins/imap-read/skills

cat > plugins/imap-read/plugin.json << 'PLUGIN_EOF'
{
  "name": "imap-read",
  "description": "Read-only IMAP email access",
  "containerEnvVars": ["EMAIL_ACCOUNTS"],
  "hooks": []
}
PLUGIN_EOF

cat > plugins/imap-read/skills/SKILL.md << 'SKILL_EOF'
---
name: imap-read
description: Email access via IMAP. Use when the user asks about their email, wants an inbox summary, or for morning digest email sections. Supports Gmail, Yahoo, Outlook, and any IMAP provider. Can mark emails as read to avoid duplicate digest entries. Never sends or deletes emails.
allowed-tools: Bash(python3:*, curl:*)
---

# Email Reader (IMAP)

Read emails from multiple accounts via IMAP. Can mark emails as read to prevent duplicate digest entries. **Never sends or deletes emails.**

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

## Read Unread Emails for Digest (Then Mark as Read)

Fetches unread emails and marks them as read so the next digest won't repeat them. Use this for daily/scheduled digests.

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
            if part.get_content_type() == "text/plain":
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
        m.select("INBOX")  # Writable — needed to mark as read
        _, data = m.search(None, "UNSEEN")
        uids = data[0].split() if data[0] else []
        for uid in uids[-30:]:  # Last 30 unread max
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
            # Mark as read after successfully fetching
            m.store(uid, "+FLAGS", "\\Seen")
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

## Mark Emails as Read

After processing emails (e.g., in a digest), mark them as read so they won't appear in future unread fetches. Pass UIDs as arguments.

```bash
python3 << 'PYEOF'
import imaplib, json, os, sys

uids_to_mark = sys.argv[1:]  # Pass UIDs as arguments
if not uids_to_mark:
    print("Usage: python3 mark_read.py <uid1> <uid2> ...")
    exit(1)

accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
# Mark across all accounts — IMAP silently ignores UIDs that don't exist in a mailbox
for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a["host"], a.get("port", 993))
        m.login(a["user"], a["pass"])
        m.select("INBOX")  # Writable — no readonly flag
        for uid in uids_to_mark:
            m.store(uid.encode(), "+FLAGS", "\\Seen")
        m.close(); m.logout()
        print(f"{a['name']}: marked {len(uids_to_mark)} UIDs as read")
    except Exception as e:
        print(f"{a['name']}: ERROR - {e}")
PYEOF
```

To mark specific emails from a specific account:

```bash
python3 << 'PYEOF'
import imaplib, json, os, sys

ACCOUNT_NAME = sys.argv[1]  # e.g., "Yahoo"
uids_to_mark = sys.argv[2:]  # e.g., "123" "456"

accounts = json.loads(os.environ["EMAIL_ACCOUNTS"])
account = next((a for a in accounts if a["name"] == ACCOUNT_NAME), None)
if not account:
    print(json.dumps({"error": f"Account '{ACCOUNT_NAME}' not found"}))
    exit(1)

m = imaplib.IMAP4_SSL(account["host"], account.get("port", 993))
m.login(account["user"], account["pass"])
m.select("INBOX")  # Writable
for uid in uids_to_mark:
    m.store(uid.encode(), "+FLAGS", "\\Seen")
m.close(); m.logout()
print(f"Marked {len(uids_to_mark)} emails as read in {ACCOUNT_NAME}")
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

- Most reads use `readonly=True` and `BODY.PEEK[]` — the digest script is the exception, marking fetched emails as read
- The "Mark Emails as Read" script can be used separately to mark specific UIDs
- Body preview is limited to 300 characters to avoid huge outputs
- Unread fetch limited to 20 most recent, digest to 30, search to 10
- Connections use IMAP4_SSL (port 993) — always encrypted
SKILL_EOF
```

## Step 6: Test Credentials

Test each account's IMAP connection before rebuilding:

```bash
python3 -c "
import imaplib, json
accounts = json.loads('''THE_JSON_ARRAY_HERE''')
for a in accounts:
    try:
        m = imaplib.IMAP4_SSL(a['host'], a.get('port', 993))
        m.login(a['user'], a['pass'])
        m.select('INBOX', readonly=True)
        _, data = m.search(None, 'UNSEEN')
        count = len(data[0].split()) if data[0] else 0
        print(f\"{a['name']}: OK - {count} unread emails\")
        m.close(); m.logout()
    except Exception as e:
        print(f\"{a['name']}: FAILED - {e}\")
"
```

If any account fails, help the user troubleshoot:
- **Gmail "Invalid credentials"**: App password may be wrong, or "Less secure app access" might need enabling (legacy accounts)
- **Yahoo "Authentication failed"**: App password not generated, or 2FA not enabled
- **Connection timeout**: Check IMAP host and port are correct

## Step 7: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 8: Verify End-to-End

Tell the user:
> Email access is configured. Test it by sending a WhatsApp message like "check my email" or "how many unread emails do I have?"

## Adding More Accounts Later

Re-run `/add-imap-read` to add additional accounts. The skill will detect the existing configuration and offer to add to it.

## Troubleshooting

- **"EMAIL_ACCOUNTS not defined" in container**: Check that `plugins/imap-read/plugin.json` exists with the correct `containerEnvVars`, and that `.env` has the variable set.
- **Authentication failures**: App passwords expire if the account password changes. Regenerate and re-run this skill.
- **Gmail blocks access**: Ensure 2-Step Verification is ON and you're using an app password, not your Google password.
- **Timeout errors**: Some corporate IMAP servers require VPN. Check network connectivity.

## Uninstall

1. Remove the plugin directory:
```bash
rm -rf plugins/imap-read/
```

2. Remove credentials from `.env`:
```bash
sed -i '/^EMAIL_ACCOUNTS=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

4. Revoke app passwords in each provider's security settings.

## Security

- App passwords are stored in `.env` which is gitignored
- `EMAIL_ACCOUNTS` is passed to containers via the plugin's `containerEnvVars` config
- All IMAP connections use SSL/TLS (port 993)
- Emails are read with `readonly=True` and `BODY.PEEK[]` — never marked as read, never modified
- No email sending capability exists in the container skill
