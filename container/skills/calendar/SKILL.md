---
name: calendar
description: Access Google Calendar events, create appointments, check schedule. Use for scheduling, reminders, and calendar management.
allowed-tools: Bash(gog:*)
---

# Google Calendar Access

Manage Google Calendar using gog CLI (https://github.com/steipete/gogcli):

```bash
# List all calendars
gog calendar calendars

# Check today's events
gog calendar events default --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+1 day' +%Y-%m-%dT23:59:59Z)

# Tomorrow's schedule
gog calendar events default --from $(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+2 days' +%Y-%m-%dT23:59:59Z)

# This week's events
gog calendar events default --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u -d '+7 days' +%Y-%m-%dT23:59:59Z)

# Create event on specific calendar
gog calendar create --calendar "$CALENDAR_ID" \
  --title "Event Title" \
  --start "2024-01-01T09:00:00Z" \
  --end "2024-01-01T10:00:00Z"
```

## Calendar Access
- Use `gog calendar calendars` to discover available calendars and their IDs
- Read all calendars for scheduling awareness
- Use ISO 8601 timestamps in UTC

## Environment
- Requires `GOG_KEYRING_PASSWORD` environment variable
- gog binary is pre-installed in the container
- gog config is mounted read-only from the host at `/home/node/.config/gogcli/`

## Setup (for host admin)

If gog is not yet configured, these steps are needed on the host:

1. Install gog: `curl -sL "https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin gog`
2. Import Google OAuth client JSON: `gog auth credentials /path/to/client_secret.json`
   - Create one at https://console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID (Desktop app)
   - Enable the Google Calendar API in the project
3. Login: `gog auth login --services calendar`
   - This starts a local web server; complete the OAuth flow in a browser
   - On headless servers, use `socat` to forward the port to 0.0.0.0: `socat TCP-LISTEN:8877,bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:PORT`
4. Verify: `gog calendar calendars`
5. Add `GOG_KEYRING_PASSWORD` to the project `.env` file
6. Ensure `GOG_KEYRING_PASSWORD` is in the `allowedVars` array in `src/container-runner.ts`
7. Rebuild and restart: `npm run build && ./container/build.sh`
