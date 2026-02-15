---
name: add-webhook
description: Add a webhook HTTP endpoint so external services (Home Assistant, uptime monitors, Proxmox) can push events that trigger agent turns. Avoids token-wasting cron polling. Triggers on "webhook", "add webhook", "http endpoint", "push events", "webhook endpoint".
---

# Add Webhook Endpoint

HTTP webhook endpoint for NanoClaw. External services POST events to it, which get injected into the message pipeline -- no cron polling needed.

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A main channel must be registered (via `/setup`)

## Install

1. Check current state:
   ```bash
   grep "NANOCLAW_WEBHOOK_SECRET" .env 2>/dev/null && echo "SECRET_EXISTS" || echo "NEED_SECRET"
   [ -d plugins/webhook ] && echo "PLUGIN_EXISTS" || echo "NEED_PLUGIN"
   ```
   If both exist, skip to Verify.

2. Generate and add the webhook secret to `.env`:
   ```bash
   TOKEN=$(openssl rand -hex 32)
   echo "NANOCLAW_WEBHOOK_SECRET=${TOKEN}" >> .env
   echo "Generated NANOCLAW_WEBHOOK_SECRET: ${TOKEN}"
   ```
   Optionally set a custom port (default is 3457):
   ```bash
   echo "WEBHOOK_PORT=3457" >> .env
   ```

3. Copy plugin files:
   ```bash
   cp -r .claude/skills/add-webhook/files/ plugins/webhook/
   ```

4. Rebuild and restart:
   ```bash
   npm run build
   systemctl restart nanoclaw  # or launchctl on macOS
   ```

## Verify

Read the secret from `.env`:
```bash
SECRET=$(grep "^NANOCLAW_WEBHOOK_SECRET=" .env | cut -d= -f2)
```

### Test auth rejection (should return 401):
```bash
curl -s -X POST http://localhost:3457/webhook \
  -H "Content-Type: application/json" \
  -d '{"source": "test", "text": "hello"}' | jq .
```

### Test with wrong token (should return 401):
```bash
curl -s -X POST http://localhost:3457/webhook \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"source": "test", "text": "hello"}' | jq .
```

### Test successful injection (should return 200):
```bash
curl -s -X POST http://localhost:3457/webhook \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"source": "test", "text": "This is a test webhook message. Reply with OK if you received it."}' | jq .
```

### Verify in database:
```bash
sqlite3 store/messages.db "SELECT id, sender_name, content, timestamp FROM messages WHERE id LIKE 'wh-%' ORDER BY timestamp DESC LIMIT 5"
```

The agent should process the message within ~2 seconds and reply on WhatsApp.

## Usage Examples

### Home Assistant Automation
```yaml
automation:
  - alias: "Notify NanoClaw on motion"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_motion
        to: "on"
    action:
      - service: rest_command.nanoclaw_webhook
        data:
          source: home-assistant
          text: "Motion detected on front door camera at {{ now().strftime('%H:%M') }}"

rest_command:
  nanoclaw_webhook:
    url: "http://NANOCLAW_IP:3457/webhook"
    method: POST
    headers:
      Authorization: "Bearer YOUR_NANOCLAW_WEBHOOK_SECRET"
      Content-Type: "application/json"
    payload: '{"source": "{{ source }}", "text": "{{ text }}"}'
```

### Uptime Kuma / Generic Monitor
```bash
curl -X POST http://NANOCLAW_IP:3457/webhook \
  -H "Authorization: Bearer YOUR_NANOCLAW_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "uptime-kuma", "text": "ALERT: website.com is DOWN. Status: 503. Downtime: 2 minutes."}'
```

## How It Works

- The webhook plugin starts only if `NANOCLAW_WEBHOOK_SECRET` is set in `.env` (safe default = off)
- `POST /webhook` validates Bearer token, parses JSON body `{ source, text }`
- Message is inserted into the pipeline via `ctx.insertMessage()`
- Agent processes it and replies on WhatsApp
- No new npm dependencies -- uses Node.js built-in `http` and `crypto`

## Security

- **Auth:** Every request requires `Authorization: Bearer <NANOCLAW_WEBHOOK_SECRET>`
- **Payload limit:** 64KB max body size prevents memory exhaustion
- **Network:** Designed for VPN/mesh networks (Tailscale, Pangolin) -- not internet-facing
- **Default off:** Server doesn't start without `NANOCLAW_WEBHOOK_SECRET` configured

## Troubleshooting

### Server not starting
```bash
grep -i "webhook" logs/nanoclaw.log | tail -10
```
Check that `NANOCLAW_WEBHOOK_SECRET` is set in `.env`.

### Port already in use
Change the port in `.env`: `WEBHOOK_PORT=3458`

### Messages not being processed
Verify the main channel is registered:
```bash
sqlite3 store/messages.db "SELECT jid, folder FROM registered_groups WHERE folder = 'main'"
```

## Remove

1. `rm -rf plugins/webhook/`
2. Remove env vars from `.env`:
   ```bash
   sed -i '/^NANOCLAW_WEBHOOK_SECRET=/d' .env
   sed -i '/^WEBHOOK_PORT=/d' .env
   ```
3. Rebuild and restart.
