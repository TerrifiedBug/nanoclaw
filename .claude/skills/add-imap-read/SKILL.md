---
name: add-imap-read
description: Add read-only IMAP email access to NanoClaw agent containers. Supports multiple providers (Gmail, Yahoo, Outlook, any IMAP server). Guides through app password setup and configures environment variables. Triggers on "add email", "add imap", "email integration", "read emails".
---

# Add IMAP Email Reader

This skill configures read-only email access for agent containers via IMAP. Supports multiple providers simultaneously.

**What this does:**
- Stores IMAP credentials in `.env` as `EMAIL_ACCOUNTS` JSON
- Adds `EMAIL_ACCOUNTS` to the container env allowlist
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
grep "EMAIL_ACCOUNTS" src/container-runner.ts | head -1
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

## Step 5: Add to Container Runner Allowlist

Check if `EMAIL_ACCOUNTS` is already in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "EMAIL_ACCOUNTS" src/container-runner.ts
```

If not present, add `'EMAIL_ACCOUNTS'` to the `allowedVars` array (around line 185).

## Step 6: Verify Container Skill Exists

```bash
[ -f container/skills/email/SKILL.md ] && echo "SKILL_EXISTS" || echo "NEED_SKILL"
```

The container skill should already exist at `container/skills/email/SKILL.md`. If missing, flag this as an error — it ships with NanoClaw.

## Step 7: Test Credentials

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

## Step 8: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 9: Verify End-to-End

Tell the user:
> Email access is configured. Test it by sending a WhatsApp message like "check my email" or "how many unread emails do I have?"

## Adding More Accounts Later

Re-run `/add-imap-read` to add additional accounts. The skill will detect the existing configuration and offer to add to it.

## Troubleshooting

- **"EMAIL_ACCOUNTS not defined" in container**: Check that `EMAIL_ACCOUNTS` is in the `allowedVars` array in `src/container-runner.ts`, and that `.env` has the variable set.
- **Authentication failures**: App passwords expire if the account password changes. Regenerate and re-run this skill.
- **Gmail blocks access**: Ensure 2-Step Verification is ON and you're using an app password, not your Google password.
- **Timeout errors**: Some corporate IMAP servers require VPN. Check network connectivity.

## Removal

1. Remove credentials from `.env`:
```bash
sed -i '/^EMAIL_ACCOUNTS=/d' .env
```

2. Remove `'EMAIL_ACCOUNTS'` from `allowedVars` in `src/container-runner.ts`

3. Optionally remove the container skill:
```bash
rm -rf container/skills/email/
```

4. Rebuild and restart NanoClaw.

5. Revoke app passwords in each provider's security settings.

## Security

- App passwords are stored in `.env` which is gitignored
- `EMAIL_ACCOUNTS` is filtered through `allowedVars` — only the email skill can access it
- All IMAP connections use SSL/TLS (port 993)
- Emails are read with `readonly=True` and `BODY.PEEK[]` — never marked as read, never modified
- No email sending capability exists in the container skill
