---
name: add-whatsapp-biz
description: Add WhatsApp Business as the main channel, replacing personal WhatsApp DM. Solves the notification problem where DMing yourself doesn't trigger push notifications. Triggers on "whatsapp business", "wa business", "business channel", "add business whatsapp".
---

# Add WhatsApp Business Channel

This skill replaces the personal WhatsApp "DM yourself" main channel with a WhatsApp Business account. The user messages the business number from their personal phone, and gets proper push notifications when the agent replies.

**Why:** WhatsApp's "Message Yourself" feature doesn't send push notifications for new messages, making it easy to miss agent responses. A separate business number solves this.

**Architecture:** A second Baileys socket connects the business account alongside the primary WhatsApp. Business JIDs are prefixed with `biz:` internally to avoid collision. The business DM becomes the `main` channel (same folder, same memory, same admin privileges). The primary WhatsApp socket continues running for group chats.

## Prerequisites

- NanoClaw must already be set up and running (primary WhatsApp connected via `/setup`)
- User must have **WhatsApp Business** installed on their phone (separate app from regular WhatsApp)
- The business account must use a **different phone number** from the personal WhatsApp

## Step 1: Check Current State

```bash
[ -f store/auth-business/creds.json ] && echo "AUTH_EXISTS" || echo "NEED_AUTH"
grep "BUSINESS_DM_TARGET_JID" .env 2>/dev/null && echo "ENV_EXISTS" || echo "NEED_ENV"
[ -d plugins/whatsapp-biz ] && echo "PLUGIN_EXISTS" || echo "PLUGIN_MISSING"
sqlite3 store/messages.db "SELECT jid, name, folder FROM registered_groups" 2>/dev/null
```

If business is already registered as the main channel, skip to Step 6 (Test).

## Step 2: Authenticate Business WhatsApp

**USER ACTION REQUIRED**

First, stop the running service to avoid connection conflicts:

```bash
# Linux
systemctl stop nanoclaw

# macOS
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```

Detect if headless:

```bash
[ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || echo "HEADLESS"
```

### Headless (server/VPS)

The auth script serves the QR code as an SVG via HTTP on port 8900. Run it from the plugin directory:

```bash
npx tsx plugins/whatsapp-biz/wa-auth-business.ts &
sleep 3
echo "Auth server running on port 8900"
```

Tell the user:

> Open **http://YOUR_SERVER_IP:8900** in any browser to see the QR code.
>
> On your phone:
> 1. Open **WhatsApp Business** (not regular WhatsApp)
> 2. Go to **Settings > Linked Devices > Link a Device**
> 3. Scan the QR code
>
> The page will update when authentication is complete.

Wait for confirmation, then verify and kill the auth server:

```bash
[ -f store/auth-business/creds.json ] && echo "Business WhatsApp authenticated" || echo "Authentication failed"
kill $(lsof -ti:8900) 2>/dev/null
```

### Local (has display)

Tell the user:

> Run this in a separate terminal:
> ```
> npx tsx plugins/whatsapp-biz/wa-auth-business.ts
> ```
> A QR code will appear. Scan it with **WhatsApp Business** > Settings > Linked Devices > Link a Device.

Wait for user confirmation.

## Step 3: Configure Target JID

Ask the user:

> What is your **personal WhatsApp phone number** (the one you'll message the business account from)?
>
> Enter with country code, no + or spaces (e.g., `441234567890` for a UK number).

**Verify the number** by cross-referencing with the primary WhatsApp connection:

```bash
grep "myPN" logs/nanoclaw.log | tail -1
```

This shows the actual phone number WhatsApp reports (e.g., `441234567890:16@s.whatsapp.net`). Use the number before the `:` suffix. The user may accidentally include extra digits -- always cross-reference.

Construct the JID: `{number}@s.whatsapp.net`

### Add to .env

```bash
# Add or update BUSINESS_DM_TARGET_JID
if grep -q "^BUSINESS_DM_TARGET_JID=" .env 2>/dev/null; then
    sed -i "s/^BUSINESS_DM_TARGET_JID=.*/BUSINESS_DM_TARGET_JID=${JID}/" .env
else
    echo "BUSINESS_DM_TARGET_JID=${JID}" >> .env
fi
echo "Set BUSINESS_DM_TARGET_JID=${JID}"
```

Replace `${JID}` with the actual value.

## Step 4: Create Plugin

Create the `plugins/whatsapp-biz/` directory with `plugin.json` and copy the auth script.

```bash
mkdir -p plugins/whatsapp-biz
```

### 4a. Create `plugins/whatsapp-biz/plugin.json`

```json
{
  "name": "whatsapp-biz",
  "description": "WhatsApp Business account authentication",
  "containerEnvVars": ["BUSINESS_DM_TARGET_JID"],
  "hooks": []
}
```

### 4b. Ensure Auth Script Exists

The auth script should be at `plugins/whatsapp-biz/wa-auth-business.ts`. If it doesn't exist, create it with the WhatsApp Business authentication code that serves QR codes via HTTP on port 8900 and saves credentials to `store/auth-business/`.

```bash
[ -f plugins/whatsapp-biz/wa-auth-business.ts ] && echo "AUTH_SCRIPT_EXISTS" || echo "NEED_AUTH_SCRIPT"
```

## Step 5: Migrate Main Channel

If the personal WhatsApp DM is currently the main channel, remove it so the business DM takes over:

```bash
# Check what's currently registered as main
sqlite3 store/messages.db "SELECT jid, folder FROM registered_groups WHERE folder = 'main'"
```

If a non-business JID is registered as main, remove it:

```bash
sqlite3 store/messages.db "DELETE FROM registered_groups WHERE folder = 'main' AND jid NOT LIKE 'biz:%'"
```

The business DM auto-registers as the `main` channel on next startup (using the same `groups/main/` folder and CLAUDE.md). All existing memory carries over.

## Step 6: Ensure Service Loads .env

The service must load `.env` so the process can read `BUSINESS_DM_TARGET_JID`.

### Linux (systemd)

Check and add `EnvironmentFile` if missing:

```bash
if grep -q "EnvironmentFile" /etc/systemd/system/nanoclaw.service 2>/dev/null; then
    echo "ALREADY_SET"
else
    PROJECT_PATH=$(grep "WorkingDirectory" /etc/systemd/system/nanoclaw.service | cut -d= -f2)
    sed -i "/^Environment=PATH/a EnvironmentFile=${PROJECT_PATH}/.env" /etc/systemd/system/nanoclaw.service
    systemctl daemon-reload
    echo "Added EnvironmentFile to systemd service"
fi
```

### macOS (launchd)

Add the env var to the plist's `EnvironmentVariables` dict. Read the current plist path and insert:

```bash
PLIST=~/Library/LaunchAgents/com.nanoclaw.plist
# Add BUSINESS_DM_TARGET_JID to the EnvironmentVariables section
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:BUSINESS_DM_TARGET_JID string ${JID}" "$PLIST" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:BUSINESS_DM_TARGET_JID ${JID}" "$PLIST"
```

## Step 7: Build, Restart, and Test

```bash
npm run build
```

Restart the service:

```bash
# Linux
systemctl restart nanoclaw

# macOS
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

Wait for startup and verify:

```bash
sleep 10
grep -E "Business WhatsApp connected|Auto-registered business" logs/nanoclaw.log | tail -5
```

You should see:
- `Business WhatsApp connected` -- second socket is live
- `Auto-registered business DM as main channel` -- main channel registered

Verify the registration:

```bash
sqlite3 store/messages.db "SELECT jid, name, folder FROM registered_groups"
```

The business DM should be the only entry with `folder = main`.

Tell the user:

> Send a message from your personal WhatsApp to the business number. The agent should respond -- and you'll get a push notification since it's from a different number.
>
> No trigger word needed -- all messages to the business number are processed.

## How It Works

- The business socket connects using credentials in `store/auth-business/`
- Incoming messages get JIDs prefixed with `biz:` (e.g., `biz:441234567890@s.whatsapp.net`)
- On startup, auto-registers as the `main` channel with folder `main` when auth + `BUSINESS_DM_TARGET_JID` exist
- Uses the same `groups/main/CLAUDE.md` and memory as the original main channel
- Has `requiresTrigger: false` -- all messages are processed
- Outgoing messages to `biz:` JIDs are routed through the business socket
- Primary WhatsApp socket continues running for group chats

## Troubleshooting

### Business socket not connecting

```bash
grep -i "business" logs/nanoclaw.log | tail -20
```

Common issues:
- Auth expired: Re-run `npx tsx plugins/whatsapp-biz/wa-auth-business.ts` (stop service first)
- Conflict error: Another process is holding the connection. Stop the service before authenticating.

### Messages not being processed

```bash
sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'biz:%'"
```

If empty, auto-registration didn't fire. Verify:
1. `BUSINESS_DM_TARGET_JID` is set in `.env`
2. Service loads `.env` (`EnvironmentFile` in systemd / env var in launchd plist)
3. `store/auth-business/creds.json` exists

### No push notifications

If you still don't get notifications, check your phone's notification settings for WhatsApp (personal app) -- the replies come FROM the business number TO your personal WhatsApp.

### Re-authentication

```bash
# Stop service first
systemctl stop nanoclaw  # or launchctl unload ...

# Clear old auth and re-authenticate
rm -rf store/auth-business
npx tsx plugins/whatsapp-biz/wa-auth-business.ts

# Restart after scanning QR
systemctl start nanoclaw
```

## Removal

1. Remove the plugin:
```bash
rm -rf plugins/whatsapp-biz/
```

2. Remove business registration:
```bash
sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'biz:%'"
```

3. Re-register personal DM as main (replace JID and trigger with configured values):
```bash
source .env
sqlite3 store/messages.db "INSERT INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger) VALUES ('YOUR_NUMBER@s.whatsapp.net', 'main', 'main', '@${ASSISTANT_NAME}', datetime('now'), 0)"
```

4. Remove auth and env var:
```bash
rm -rf store/auth-business
sed -i '/^BUSINESS_DM_TARGET_JID=/d' .env
```

5. Rebuild and restart NanoClaw.
