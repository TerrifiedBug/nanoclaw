---
name: add-changedetection
description: Add changedetection.io integration to NanoClaw. Enables agents to create and manage website watches for price monitoring, stock alerts, and content changes. Guides through API key setup and webhook configuration. Triggers on "add changedetection", "changedetection setup", "price monitoring", "website monitoring".
---

# Add ChangeDetection.io

This skill configures changedetection.io API access for agent containers and sets up webhook notifications so changes trigger the agent automatically.

**What this does:**
- Stores the changedetection.io URL and API key in `.env`
- Ensures env vars are in the container allowlist
- Configures changedetection.io to webhook back to NanoClaw on changes
- Agents can then create/manage watches via the `changedetection` container skill

## Prerequisites

- A running changedetection.io instance (self-hosted)
- NanoClaw webhook server must be configured (`/add-webhook`)

## Step 1: Check Existing Configuration

```bash
grep "^CHANGEDETECTION_URL=" .env 2>/dev/null && echo "URL_SET" || echo "NEED_URL"
grep "^CHANGEDETECTION_API_KEY=" .env 2>/dev/null && echo "KEY_SET" || echo "NEED_KEY"
grep "^NANOCLAW_WEBHOOK_SECRET=" .env 2>/dev/null && echo "WEBHOOK_SET" || echo "NEED_WEBHOOK"
```

If `NEED_WEBHOOK`, tell the user to run `/add-webhook` first — changedetection.io needs somewhere to send notifications.

If both URL and KEY are set, ask if they want to reconfigure.

## Step 2: Get Connection Details

Ask the user:
> Please provide your changedetection.io details:
> 1. **Instance URL** (e.g. `http://192.168.1.100:5000` or `https://cd.yourdomain.com`)
> 2. **API key** (found in Settings > API tab in the changedetection.io dashboard)

## Step 3: Save to .env

```bash
# Remove existing lines if present
sed -i '/^CHANGEDETECTION_URL=/d' .env
sed -i '/^CHANGEDETECTION_API_KEY=/d' .env

# Add the new values
echo 'CHANGEDETECTION_URL=THE_URL_HERE' >> .env
echo 'CHANGEDETECTION_API_KEY=THE_KEY_HERE' >> .env
```

## Step 4: Verify Container Allowlist

Check that both vars are in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "CHANGEDETECTION_URL" src/container-runner.ts
grep "CHANGEDETECTION_API_KEY" src/container-runner.ts
```

If not present, add `'CHANGEDETECTION_URL'` and `'CHANGEDETECTION_API_KEY'` to the `allowedVars` array.

## Step 5: Verify Container Skill Exists

```bash
[ -f container/skills/changedetection/SKILL.md ] && echo "SKILL_EXISTS" || echo "NEED_SKILL"
```

The container skill should already exist. If missing, flag this as an error.

## Step 6: Test the Connection

```bash
source .env
curl -s "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if isinstance(r, dict):
    print(f'OK - {len(r)} watch(es) found')
else:
    print(f'FAILED - unexpected response: {str(r)[:200]}')
"
```

If the test fails:
- **Connection refused**: Check the URL and that changedetection.io is running
- **401/403**: API key is wrong — regenerate in Settings > API
- **Timeout**: Check network/firewall between NanoClaw and changedetection.io

## Step 7: Test Webhook Connectivity

Verify changedetection.io can reach NanoClaw's webhook endpoint. Determine the NanoClaw webhook URL that changedetection.io should use:

```bash
# If on same machine
echo "Webhook URL: http://localhost:3457/webhook"

# If on different machines (use NanoClaw's IP/hostname)
hostname -I | awk '{print "Webhook URL: http://" $1 ":3457/webhook"}'
```

Test that changedetection.io can reach the webhook:
```bash
source .env
SECRET=$(grep "^NANOCLAW_WEBHOOK_SECRET=" .env | cut -d= -f2)
curl -s -X POST http://localhost:3457/webhook \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"source": "changedetection-test", "text": "Test notification from changedetection.io setup"}' | python3 -c "
import sys, json
r = json.load(sys.stdin)
if r.get('ok'):
    print('OK - webhook endpoint reachable')
else:
    print(f'FAILED - {r}')
"
```

## Step 8: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 9: Verify End-to-End

Tell the user:
> ChangeDetection.io is configured. You can now ask TARS to:
> - "Monitor this product page for price changes: [URL]"
> - "Set up watches for the items on my Notion wishlist"
> - "Show me all active changedetection watches"
>
> When a watched page changes, changedetection.io will webhook NanoClaw and TARS will notify you automatically.

## Removal

1. Remove from `.env`:
```bash
sed -i '/^CHANGEDETECTION_URL=/d' .env
sed -i '/^CHANGEDETECTION_API_KEY=/d' .env
```

2. Remove from allowlist in `src/container-runner.ts` if added.

3. Rebuild and restart NanoClaw.

## Security

- API key is stored in `.env` which is gitignored
- `CHANGEDETECTION_URL` and `CHANGEDETECTION_API_KEY` are filtered through `allowedVars`
- Webhook notifications are authenticated via `NANOCLAW_WEBHOOK_SECRET`
- changedetection.io instance should be on a private network or VPN
