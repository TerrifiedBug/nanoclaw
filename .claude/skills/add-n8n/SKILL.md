---
name: add-n8n
description: Add n8n workflow automation integration to NanoClaw. Enables agents to create monitoring workflows that trigger webhooks instead of burning tokens on frequent polling. Guides through MCP server setup and configures environment. Triggers on "add n8n", "n8n setup", "n8n integration", "workflow automation".
---

# Add n8n Workflow Automation

This skill connects NanoClaw to an n8n instance so agents can create and manage automated workflows. The key use case: instead of burning agent tokens on frequent scheduled tasks that poll for changes, n8n does the polling (free) and only triggers the agent via webhook when something actually happens.

**What this does:**
- Creates a `plugins/n8n/` plugin with MCP config fragment and agent skill
- Stores n8n credentials in `.env` as `N8N_URL` and `N8N_API_KEY`
- Optionally configures `NANOCLAW_WEBHOOK_URL` and `NANOCLAW_WEBHOOK_SECRET` so agents can set up n8n callbacks
- The plugin loader merges the MCP config and passes env vars to containers automatically

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- An n8n instance with MCP server enabled (Settings > MCP Server)
- **Optional:** The webhook plugin (`/add-webhook`) -- only needed if you want n8n workflows to trigger agent turns. Without it, agents can still create/manage n8n workflows but can't receive callbacks.

## Step 1: Check Existing Configuration

```bash
grep "^N8N_URL=" .env 2>/dev/null && echo "N8N_CONFIGURED" || echo "N8N_NEEDS_SETUP"
[ -d plugins/n8n ] && echo "PLUGIN_EXISTS" || echo "PLUGIN_MISSING"
grep "^NANOCLAW_WEBHOOK_SECRET=" .env 2>/dev/null && echo "WEBHOOK_AVAILABLE" || echo "NO_WEBHOOK"
grep "^NANOCLAW_WEBHOOK_URL=" .env 2>/dev/null && echo "WEBHOOK_URL_CONFIGURED" || echo "WEBHOOK_URL_NEEDS_SETUP"
```

If `N8N_CONFIGURED`, ask the user if they want to reconfigure.

If `NO_WEBHOOK`, inform the user:
> The webhook plugin isn't configured yet. n8n will work for workflow management, but if you want n8n workflows to trigger agent turns (e.g., alert you when something happens), run `/add-webhook` first, then re-run `/add-n8n` to configure the callback URL.

## Step 2: Gather n8n Details

Ask the user for:

1. **n8n URL** -- the base URL of their n8n instance (e.g. `https://n8n.example.com` or `http://192.168.1.x:5678`)
2. **n8n API Key** -- generate one in n8n: Settings > API > Create API Key

Tell the user:
> To create an n8n API key:
> 1. Open your n8n instance
> 2. Go to **Settings** (bottom-left gear icon)
> 3. Click **API** in the left sidebar
> 4. Click **Create API Key**
> 5. Copy the key and paste it here

## Step 3: Configure Webhook URL (optional)

**Skip this step if the webhook plugin isn't set up or the user doesn't need n8n->NanoClaw callbacks yet.**

If `NANOCLAW_WEBHOOK_SECRET` exists in `.env`, offer to configure the callback URL so n8n workflows can trigger agent turns.

The agent needs to know the NanoClaw webhook endpoint so it can configure n8n workflows to call back.

Determine the webhook URL that n8n can reach:
- If n8n and NanoClaw are on the same machine: `http://localhost:3457/webhook` or `http://HOST_IP:3457/webhook`
- If on different machines: use the NanoClaw host's LAN IP or DNS name

```bash
# Get the current webhook port
grep "^WEBHOOK_PORT=" .env 2>/dev/null || echo "WEBHOOK_PORT=3457 (default)"
grep "^NANOCLAW_WEBHOOK_SECRET=" .env 2>/dev/null && echo "SECRET_EXISTS" || echo "NO_SECRET"
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

echo 'NANOCLAW_WEBHOOK_URL=THE_WEBHOOK_URL_HERE' >> .env
```

## Step 5: Create Plugin

Create the `plugins/n8n/` directory with `plugin.json`, `mcp.json`, and agent skill.

```bash
mkdir -p plugins/n8n/skills
```

### 5a. Create `plugins/n8n/plugin.json`

```json
{
  "name": "n8n",
  "description": "n8n workflow automation integration",
  "containerEnvVars": ["N8N_URL", "N8N_API_KEY", "NANOCLAW_WEBHOOK_URL", "NANOCLAW_WEBHOOK_SECRET"],
  "hooks": []
}
```

### 5b. Create `plugins/n8n/mcp.json`

This MCP config fragment is automatically merged by the plugin loader -- no need to edit the root `.mcp.json`.

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

### 5c. Create `plugins/n8n/skills/SKILL.md`

Write the agent skill file with the following content:

```markdown
---
name: n8n
description: Create and manage n8n automation workflows. Best for monitoring EXTERNAL sources (email, stock prices, websites, APIs). NEVER use for Home Assistant state changes -- use HA automations instead (they are instant). Run `/add-n8n` on the host to configure.
allowed-tools: mcp__n8n(*), Bash(curl:*)
---

# n8n Workflow Automation

Create and manage automated workflows on n8n. n8n does the frequent polling (free, zero tokens) and only triggers you via webhook when something actually needs attention.

## Choosing the Right Tool

| Scenario | Use | Why |
|---|---|---|
| Alert based on Home Assistant state (sensor, switch, etc.) | **HA automation** (use the homeassistant skill) | HA automations are instant and event-driven; do NOT use n8n for HA state monitoring |
| Alert based on external source (email, stock, API, website) | **n8n workflow** -> webhook | HA can't monitor these; n8n polls for free |
| Daily/weekly digest combining multiple sources | **Scheduled task** | Always produces output, aggregates data |
| One-off question or on-demand lookup | **Direct tool call** | No automation needed |

**Decision order:**
1. If the data source is **Home Assistant** -> ALWAYS use an HA automation (instant, event-driven). Follow the homeassistant skill instructions -- if `rest_command` is missing, guide the user through setup. Never use n8n to poll HA sensors.
2. If the data source is **external** (email, stock, API) -> use n8n (only option for sources HA can't monitor)
3. If the task **always produces output** (digests, summaries) -> use a scheduled task

## How It Works

1. You create an n8n workflow via MCP tools or API
2. The workflow polls a source on a schedule (e.g., check email every 2 min)
3. A filter node checks if the condition is met
4. If yes -> HTTP Request node POSTs to NanoClaw webhook -> agent turn triggered
5. If no -> nothing happens, zero tokens spent

## Webhook Configuration

When creating n8n workflows that call back to NanoClaw, use:

- **URL**: `$NANOCLAW_WEBHOOK_URL`
- **Method**: POST
- **Headers**: `Authorization: Bearer $NANOCLAW_WEBHOOK_SECRET`, `Content-Type: application/json`
- **Body**: `{"source": "n8n-{workflow-name}", "text": "Description of what happened and any relevant data"}`

Example HTTP Request node body:
\`\`\`json
{
  "source": "n8n-email-alert",
  "text": "New email from {{$json.from}}: {{$json.subject}}\n\nPreview: {{$json.preview}}"
}
\`\`\`

## Two Interfaces: MCP vs REST API

### MCP Tools (discovery and triggering)

Look for tools prefixed with `mcp__n8n`. Use MCP for:
- **Searching** existing workflows
- **Triggering** pre-built workflows that are MCP-enabled
- **Checking** workflow metadata and execution status

MCP does NOT support creating or editing workflow definitions -- use the REST API for that.

### REST API (full workflow management)

Use the REST API for creating, editing, activating, and deleting workflows:

\`\`\`bash
# List workflows
curl -s "$N8N_URL/api/v1/workflows" -H "X-N8N-API-KEY: $N8N_API_KEY"

# Get a specific workflow
curl -s "$N8N_URL/api/v1/workflows/{id}" -H "X-N8N-API-KEY: $N8N_API_KEY"

# Activate a workflow
curl -s -X PATCH "$N8N_URL/api/v1/workflows/{id}" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'

# Create a workflow
curl -s -X POST "$N8N_URL/api/v1/workflows" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "...", "nodes": [...], "connections": {...}}'
\`\`\`

## Example Use Cases

### Email VIP Alert
> "Alert me immediately when I get an email from my boss"

n8n workflow: Schedule Trigger (every 2 min) -> IMAP node -> Filter (from contains "boss@") -> HTTP Request (webhook)

### Stock Price Alert
> "Alert me if SRAD drops more than 3% today"

n8n workflow: Schedule Trigger (every 15 min, market hours) -> HTTP Request (stock API) -> IF (change < -3%) -> HTTP Request (webhook)

### Service Health
> "Tell me if my website goes down"

n8n workflow: Schedule Trigger (every 1 min) -> HTTP Request (health check) -> IF (status != 200) -> HTTP Request (webhook)

## Notes

- Always include `"source": "n8n-{descriptive-name}"` in webhook payloads so you know what triggered the alert
- Keep the webhook `text` field informative -- include the relevant data so you can respond without making additional API calls
- Test workflows before activating -- use n8n's manual execution
- Consider adding a cooldown/dedup to avoid alert fatigue (e.g., don't re-alert for the same email)
```

## Step 6: Test n8n API Connection

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

## Step 7: Test Webhook Reachability from n8n's Perspective

**Skip if webhook was not configured in Step 3.**

```bash
source .env
# Test the webhook URL is reachable (from localhost; n8n may be elsewhere)
curl -s -X POST "$NANOCLAW_WEBHOOK_URL" \
  -H "Authorization: Bearer $NANOCLAW_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "n8n-test", "text": "n8n integration test -- if you see this, the webhook is working"}' | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('OK' if r.get('ok') else f'FAILED - {json.dumps(r)}')
"
```

## Step 8: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 9: Verify End-to-End

Tell the user:
> n8n integration is configured. Test it by sending a WhatsApp message like "create an n8n workflow that checks my email every 5 minutes and alerts me if I get anything from my boss"

## Troubleshooting

- **n8n MCP tools not available in container**: Check that `plugins/n8n/mcp.json` exists with the n8n entry and that `N8N_URL`/`N8N_API_KEY` are set in `.env`.
- **n8n can't reach webhook**: Ensure NanoClaw's webhook port is accessible from the n8n host. Check firewall rules.
- **"Unauthorized" from n8n API**: Regenerate the API key in n8n Settings > API.

## Removal

1. Remove the plugin:
```bash
rm -rf plugins/n8n/
```

2. Remove from `.env`:
```bash
sed -i '/^N8N_URL=/d' .env
sed -i '/^N8N_API_KEY=/d' .env
sed -i '/^NANOCLAW_WEBHOOK_URL=/d' .env
```

3. Rebuild and restart NanoClaw.

## Security

- API key is stored in `.env` which is gitignored
- Webhook secret ensures only authorized sources can trigger the agent
- n8n workflows should be tested before activation to avoid unintended triggers
