---
name: add-cal
description: Add calendar access to NanoClaw. Supports Google Calendar (gog CLI with OAuth) and CalDAV providers (iCloud, Nextcloud, Fastmail via cal CLI). Guides through authentication and configures environment variables. Triggers on "add calendar", "add caldav", "icloud calendar", "google calendar", "calendar setup".
---

# Add Calendar Access

This skill sets up calendar integration for NanoClaw agent containers. Two tools are available:

- **`gog`** — Google Calendar (OAuth, read/write)
- **`cal`** — CalDAV providers: iCloud, Nextcloud, Fastmail (Basic Auth, read/write)

## Step 1: Check Existing Configuration

```bash
grep "^GOG_KEYRING_PASSWORD=" .env 2>/dev/null && echo "GOOGLE: CONFIGURED" || echo "GOOGLE: NOT SET"
grep "^CALDAV_ACCOUNTS=" .env 2>/dev/null && echo "CALDAV: CONFIGURED" || echo "CALDAV: NOT SET"
```

If already configured, ask the user if they want to add another provider or reconfigure.

## Step 2: Choose Provider

Ask the user which calendar provider they want to add:

- **Google Calendar** → Go to Step 3A (gog CLI setup)
- **iCloud** → Go to Step 3B (CalDAV setup)
- **Nextcloud** → Go to Step 3B (CalDAV setup)
- **Fastmail** → Go to Step 3B (CalDAV setup)
- **Other CalDAV provider** → Go to Step 3B (CalDAV setup)

---

## Step 3A: Google Calendar (gog CLI)

### Install gog

```bash
which gog && echo "GOG_INSTALLED" || echo "NEEDS_INSTALL"
```

If not installed:
```bash
curl -sL "https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin gog
```

### Import OAuth Credentials

The user needs a Google Cloud OAuth 2.0 Client ID (Desktop app):
1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Application type: Desktop app)
3. Enable the Google Calendar API in the project
4. Download the client secret JSON file

Ask the user for the path to their OAuth client JSON, then:
```bash
gog auth credentials /path/to/client_secret.json
```

### OAuth Login

```bash
gog auth login --services calendar
```

This starts a local web server for the OAuth flow. On headless servers, use socat to forward the port:
```bash
# In another terminal — replace PORT with the port gog prints
socat TCP-LISTEN:8877,bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:PORT
```

Then complete the OAuth flow in a browser.

### Verify

```bash
gog calendar calendars
```

This should list the user's Google calendars.

### Configure Environment

Ask the user for a keyring password (any string, used to encrypt the local token store):

```bash
grep "^GOG_KEYRING_PASSWORD=" .env 2>/dev/null && echo "ALREADY_SET" || echo "NEEDS_SET"
```

If not set:
```bash
echo 'GOG_KEYRING_PASSWORD=THEIR_PASSWORD_HERE' >> .env
```

### Copy gog config for containers

The container needs access to gog's config directory:
```bash
mkdir -p data/gogcli
cp -r ~/.config/gogcli/* data/gogcli/
chown -R 1000:1000 data/gogcli
```

Then skip to Step 4.

---

## Step 3B: CalDAV (iCloud, Nextcloud, Fastmail)

### Gather Account Details

1. **Provider name** (e.g., "iCloud", "Nextcloud", "Fastmail")
2. **CalDAV server URL** (auto-fill based on provider):
   - iCloud: `https://caldav.icloud.com`
   - Nextcloud: `https://YOUR_SERVER/remote.php/dav` (ask for server URL)
   - Fastmail: `https://caldav.fastmail.com`
   - Other: ask for the CalDAV server URL
3. **Username** (usually email address)
4. **App-specific password** (NOT the regular account password)

### App-Specific Password Instructions

**iCloud:**
> 1. Go to https://appleid.apple.com/account/manage
> 2. Sign in → "Sign-In and Security" → "App-Specific Passwords"
> 3. Click + → Name it "NanoClaw" → Create
> 4. Copy the password (format: xxxx-xxxx-xxxx-xxxx)

**Nextcloud:**
> 1. Settings → Security → "Devices & Sessions"
> 2. Enter "NanoClaw" → "Create new app password"

**Fastmail:**
> 1. Settings → Privacy & Security → Integrations
> 2. "New app password" → Select CalDAV → Name it "NanoClaw"

### Build CALDAV_ACCOUNTS JSON

```json
[
  {"name": "iCloud", "serverUrl": "https://caldav.icloud.com", "user": "user@icloud.com", "pass": "xxxx-xxxx-xxxx-xxxx"}
]
```

If there's an existing `CALDAV_ACCOUNTS`, parse it and append the new account.

### Save to .env

```bash
sed -i '/^CALDAV_ACCOUNTS=/d' .env
echo 'CALDAV_ACCOUNTS=THE_JSON_ARRAY_HERE' >> .env
```

---

## Step 4: Create the Calendar Plugin

```bash
mkdir -p plugins/calendar/skills
```

Write `plugins/calendar/plugin.json`:

```json
{
  "name": "calendar",
  "description": "Google Calendar (gog) and CalDAV calendar access",
  "containerEnvVars": ["GOG_KEYRING_PASSWORD", "GOG_ACCOUNT", "CALDAV_ACCOUNTS"],
  "hooks": []
}
```

Write `plugins/calendar/skills/SKILL.md` — the agent instructions for using calendar tools:

```markdown
---
name: calendar
description: Read and manage calendars. Use for scheduling, checking availability, creating events, or any calendar-related request. Supports Google Calendar (gog) and CalDAV (iCloud, Nextcloud, Fastmail).
allowed-tools: Bash(gog:*,cal:*,curl:*)
---

# Calendar Access

## Google Calendar (gog CLI)

List calendars:
\`\`\`bash
gog calendar calendars
\`\`\`

List upcoming events (next 7 days):
\`\`\`bash
gog calendar events --from today --to "+7d"
\`\`\`

Get events for a specific date:
\`\`\`bash
gog calendar events --from "2025-01-15" --to "2025-01-16"
\`\`\`

Create an event:
\`\`\`bash
gog calendar create --title "Meeting" --start "2025-01-15T10:00:00" --end "2025-01-15T11:00:00" --calendar "primary"
\`\`\`

## CalDAV Calendars (iCloud, Nextcloud, Fastmail)

The `cal` CLI reads CALDAV_ACCOUNTS from the environment.

List calendars:
\`\`\`bash
cal calendars
\`\`\`

List events:
\`\`\`bash
cal events --from today --to "+7d"
\`\`\`

## Tips

- Default to 7-day lookahead unless the user specifies a range
- When creating events, confirm the time and calendar with the user first
- Use ISO 8601 format for dates/times
```

## Step 5: Build and Restart

```bash
npm run build
./container/build.sh
```

Then restart the service:
- **Linux (systemd):** `systemctl restart nanoclaw`
- **macOS (launchd):** `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

## Step 6: Verify End-to-End

Tell the user:
> Calendar access is configured. Test via WhatsApp: "list my calendars" or "what's on my calendar today?"

## Adding More Providers Later

Re-run `/add-cal`. The skill detects existing configuration and offers to add another provider.

## Troubleshooting

- **gog "auth required"**: OAuth tokens may have expired. Re-run `gog auth login --services calendar` on the host.
- **gog config not found in container**: Ensure `data/gogcli/` exists and is chowned to 1000:1000.
- **iCloud "401 Unauthorized"**: Use an app-specific password, not your Apple ID password.
- **"CALDAV_ACCOUNTS not defined"**: Check it's in both `.env` and `plugin.json` containerEnvVars.
- **Nextcloud connection refused**: Verify the server URL includes `/remote.php/dav`.

## Uninstall

```bash
rm -rf plugins/calendar/
sed -i '/^GOG_KEYRING_PASSWORD=/d' .env
sed -i '/^GOG_ACCOUNT=/d' .env
sed -i '/^CALDAV_ACCOUNTS=/d' .env
rm -rf data/gogcli
npm run build
# Restart service
```

Revoke app-specific passwords in provider security settings.

## Security

- OAuth tokens (gog) stored in `data/gogcli/` which is gitignored
- CalDAV app passwords stored in `.env` which is gitignored
- Environment variables declared in `plugin.json` containerEnvVars — only passed to containers when the plugin is active
- All connections use HTTPS
