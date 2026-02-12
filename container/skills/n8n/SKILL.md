---
name: n8n
description: Create and manage n8n automation workflows. Use n8n for frequent monitoring, event-driven alerts, and conditional triggers INSTEAD of scheduled tasks — saves tokens by only triggering the agent when something actually happens. Run `/add-n8n` on the host to configure.
allowed-tools: mcp__n8n(*), Bash(curl:*)
---

# n8n Workflow Automation

Create and manage automated workflows on n8n. n8n does the frequent polling (free, zero tokens) and only triggers you via webhook when something actually needs attention.

## When to Use n8n vs Scheduled Tasks

| Use n8n | Use scheduled task |
|---|---|
| Frequent checks (every few minutes) | Daily/weekly digests that always produce output |
| "Alert me if X happens" | "Give me a summary every morning" |
| Conditional triggers (only act if threshold met) | One-off questions |
| Event-driven monitoring | Tasks that aggregate multiple sources |

**Rule of thumb:** If most polling cycles would result in "nothing to report", use n8n. If every run produces useful output, use a scheduled task.

## How It Works

1. You create an n8n workflow via MCP tools or API
2. The workflow polls a source on a schedule (e.g., check email every 2 min)
3. A filter node checks if the condition is met
4. If yes → HTTP Request node POSTs to NanoClaw webhook → agent turn triggered
5. If no → nothing happens, zero tokens spent

## Webhook Configuration

When creating n8n workflows that call back to NanoClaw, use:

- **URL**: `$NANOCLAW_WEBHOOK_URL`
- **Method**: POST
- **Headers**: `Authorization: Bearer $NANOCLAW_WEBHOOK_SECRET`, `Content-Type: application/json`
- **Body**: `{"source": "n8n-{workflow-name}", "text": "Description of what happened and any relevant data"}`

Example HTTP Request node body:
```json
{
  "source": "n8n-email-alert",
  "text": "New email from {{$json.from}}: {{$json.subject}}\n\nPreview: {{$json.preview}}"
}
```

## Two Interfaces: MCP vs REST API

### MCP Tools (discovery and triggering)

Look for tools prefixed with `mcp__n8n`. Use MCP for:
- **Searching** existing workflows
- **Triggering** pre-built workflows that are MCP-enabled
- **Checking** workflow metadata and execution status

MCP does NOT support creating or editing workflow definitions — use the REST API for that.

### REST API (full workflow management)

Use the REST API for creating, editing, activating, and deleting workflows:

```bash
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
```

## Example Use Cases

### Email VIP Alert
> "Alert me immediately when I get an email from my boss"

n8n workflow: Schedule Trigger (every 2 min) → IMAP node → Filter (from contains "boss@") → HTTP Request (webhook)

### Home Assistant Event
> "Tell me when the washing machine finishes"

n8n workflow: Schedule Trigger (every 5 min) → HA API (power sensor) → IF (power < 5W AND was > 100W) → HTTP Request (webhook)

### Stock Price Alert
> "Alert me if SRAD drops more than 3% today"

n8n workflow: Schedule Trigger (every 15 min, market hours) → HTTP Request (stock API) → IF (change < -3%) → HTTP Request (webhook)

### Service Health
> "Tell me if my website goes down"

n8n workflow: Schedule Trigger (every 1 min) → HTTP Request (health check) → IF (status != 200) → HTTP Request (webhook)

## Notes

- Always include `"source": "n8n-{descriptive-name}"` in webhook payloads so you know what triggered the alert
- Keep the webhook `text` field informative — include the relevant data so you can respond without making additional API calls
- Test workflows before activating — use n8n's manual execution
- Consider adding a cooldown/dedup to avoid alert fatigue (e.g., don't re-alert for the same email)
