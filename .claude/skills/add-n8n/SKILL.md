---
name: add-n8n
description: Add n8n workflow automation integration to NanoClaw. Enables agents to create monitoring workflows that trigger webhooks instead of burning tokens on frequent polling. Guides through MCP server setup and configures environment. Triggers on "add n8n", "n8n setup", "n8n integration", "workflow automation".
---

# Add n8n Workflow Automation

This skill connects NanoClaw to an n8n instance so agents can create and manage automated workflows. The key use case: instead of burning agent tokens on frequent scheduled tasks that poll for changes, n8n does the polling (free) and only triggers the agent via webhook when something actually happens.

**What this does:**
- Adds n8n MCP server to `.mcp.json` for agent access
- Stores n8n credentials in `.env` as `N8N_URL` and `N8N_API_KEY`
- Optionally exposes `NANOCLAW_WEBHOOK_URL` and `NANOCLAW_WEBHOOK_SECRET` to containers so agents can configure n8n workflows to call back

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- An n8n instance with MCP server enabled (Settings > MCP Server)
- **Optional:** The webhook skill (`/add-webhook`) — only needed if you want n8n workflows to trigger agent turns. Without it, agents can still create/manage n8n workflows but can't receive callbacks.

## Step 1: Check Existing Configuration

```bash
grep "^N8N_URL=" .env 2>/dev/null && echo "N8N_CONFIGURED" || echo "N8N_NEEDS_SETUP"
grep '"n8n"' .mcp.json 2>/dev/null && echo "MCP_CONFIGURED" || echo "MCP_NEEDS_SETUP"
grep "^WEBHOOK_SECRET=" .env 2>/dev/null && echo "WEBHOOK_AVAILABLE" || echo "NO_WEBHOOK"
grep "^NANOCLAW_WEBHOOK_URL=" .env 2>/dev/null && echo "WEBHOOK_URL_CONFIGURED" || echo "WEBHOOK_URL_NEEDS_SETUP"
```

If `N8N_CONFIGURED`, ask the user if they want to reconfigure.

If `NO_WEBHOOK`, inform the user:
> The webhook skill isn't configured yet. n8n will work for workflow management, but if you want n8n workflows to trigger agent turns (e.g., alert you when something happens), run `/add-webhook` first, then re-run `/add-n8n` to configure the callback URL.

## Step 2: Gather n8n Details

Ask the user for:

1. **n8n URL** — the base URL of their n8n instance (e.g. `https://n8n.example.com` or `http://192.168.1.x:5678`)
2. **n8n API Key** — generate one in n8n: Settings > API > Create API Key

Tell the user:
> To create an n8n API key:
> 1. Open your n8n instance
> 2. Go to **Settings** (bottom-left gear icon)
> 3. Click **API** in the left sidebar
> 4. Click **Create API Key**
> 5. Copy the key and paste it here

## Step 3: Configure Webhook URL (optional)

**Skip this step if the webhook skill isn't set up or the user doesn't need n8n→NanoClaw callbacks yet.**

If `WEBHOOK_SECRET` exists in `.env`, offer to configure the callback URL so n8n workflows can trigger agent turns.

The agent needs to know the NanoClaw webhook endpoint so it can configure n8n workflows to call back.

Determine the webhook URL that n8n can reach:
- If n8n and NanoClaw are on the same machine: `http://localhost:3457/webhook` or `http://HOST_IP:3457/webhook`
- If on different machines: use the NanoClaw host's LAN IP or DNS name

```bash
# Get the current webhook port
grep "^WEBHOOK_PORT=" .env 2>/dev/null || echo "WEBHOOK_PORT=3457 (default)"
grep "^WEBHOOK_SECRET=" .env 2>/dev/null && echo "SECRET_EXISTS" || echo "NO_SECRET"
```

Ask the user: "What URL can your n8n instance use to reach NanoClaw's webhook?" and suggest the likely value based on the network setup.

## Step 4: Save to .env

```bash
# Remove existing lines if present
sed -i '/^N8N_URL=/d' .env
sed -i '/^N8N_API_KEY=/d' .env

# Add n8n credentials
echo 'N8N_URL=THE_N8N_URL_HERE' >> .env
echo 'N8N_API_KEY=THE_API_KEY_HERE' >> .env
```

**If webhook is configured (Step 3 was not skipped):**

```bash
sed -i '/^NANOCLAW_WEBHOOK_URL=/d' .env
sed -i '/^NANOCLAW_WEBHOOK_SECRET=/d' .env

# Read WEBHOOK_SECRET from .env and expose it for containers
WEBHOOK_SECRET=$(grep "^WEBHOOK_SECRET=" .env | cut -d'=' -f2)
echo 'NANOCLAW_WEBHOOK_URL=THE_WEBHOOK_URL_HERE' >> .env
echo "NANOCLAW_WEBHOOK_SECRET=$WEBHOOK_SECRET" >> .env
```

## Step 5: Add to Container Runner Allowlist

Check and add the env vars to `allowedVars` in `src/container-runner.ts`:

```bash
grep "N8N_URL\|N8N_API_KEY\|NANOCLAW_WEBHOOK_URL\|NANOCLAW_WEBHOOK_SECRET" src/container-runner.ts
```

Always add: `'N8N_URL'`, `'N8N_API_KEY'`

If webhook was configured in Step 3, also add: `'NANOCLAW_WEBHOOK_URL'`, `'NANOCLAW_WEBHOOK_SECRET'`

## Step 6: Add n8n to MCP Config

Read `.mcp.json` and add the n8n server entry. The n8n MCP endpoint uses streamable HTTP transport:

```json
{
  "mcpServers": {
    "n8n": {
      "type": "http",
      "url": "${N8N_URL}/mcp",
      "headers": {
        "Authorization": "Bearer ${N8N_API_KEY}"
      }
    }
  }
}
```

**Important:** Merge with existing `.mcp.json` — don't overwrite other MCP servers.

## Step 7: Verify Container Skill Exists

```bash
[ -f container/skills/n8n/SKILL.md ] && echo "SKILL_EXISTS" || echo "NEED_SKILL"
```

The container skill should already exist. If missing, flag this as an error — it ships with NanoClaw.

## Step 8: Test n8n API Connection

```bash
source .env
curl -s "$N8N_URL/api/v1/workflows?limit=1" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'data' in r:
    count = len(r.get('data', []))
    print(f'OK - n8n API accessible ({r.get(\"count\", count)} workflows)')
else:
    print(f'FAILED - {r.get(\"message\", json.dumps(r)[:200])}')
"
```

If the test fails:
- **401/403**: API key is wrong or not activated
- **Connection refused**: Check n8n URL and that the instance is running
- **Timeout**: Network/firewall issue between NanoClaw host and n8n

## Step 9: Test Webhook Reachability from n8n's Perspective

```bash
source .env
# Test the webhook URL is reachable (from localhost; n8n may be elsewhere)
curl -s -X POST "$NANOCLAW_WEBHOOK_URL" \
  -H "Authorization: Bearer $NANOCLAW_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "n8n-test", "text": "n8n integration test — if you see this, the webhook is working"}' | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('OK' if r.get('ok') else f'FAILED - {json.dumps(r)}')
"
```

## Step 10: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 11: Verify End-to-End

Tell the user:
> n8n integration is configured. Test it by sending a WhatsApp message like "create an n8n workflow that checks my email every 5 minutes and alerts me if I get anything from my boss"

## Troubleshooting

- **n8n MCP tools not available in container**: Check that `.mcp.json` has the n8n entry and that `N8N_URL`/`N8N_API_KEY` are in the allowedVars array.
- **n8n can't reach webhook**: Ensure NanoClaw's webhook port is accessible from the n8n host. Check firewall rules.
- **"Unauthorized" from n8n API**: Regenerate the API key in n8n Settings > API.

## Removal

1. Remove from `.env`:
```bash
sed -i '/^N8N_URL=/d' .env
sed -i '/^N8N_API_KEY=/d' .env
sed -i '/^NANOCLAW_WEBHOOK_URL=/d' .env
sed -i '/^NANOCLAW_WEBHOOK_SECRET=/d' .env
```

2. Remove n8n from `.mcp.json`

3. Remove env vars from `allowedVars` in `src/container-runner.ts`

4. Optionally remove the container skill:
```bash
rm -rf container/skills/n8n/
```

5. Rebuild and restart NanoClaw.

## Security

- API key is stored in `.env` which is gitignored
- Webhook secret ensures only authorized sources can trigger the agent
- n8n workflows should be tested before activation to avoid unintended triggers
