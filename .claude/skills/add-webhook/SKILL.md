---
name: add-webhook
description: Add a webhook HTTP endpoint so external services (Home Assistant, uptime monitors, Proxmox) can push events that trigger agent turns. Avoids token-wasting cron polling. Triggers on "webhook", "add webhook", "http endpoint", "push events", "webhook endpoint".
---

# Add Webhook Endpoint

This skill adds an HTTP webhook endpoint to NanoClaw. External services POST events to it, which get injected into the main channel's message pipeline and processed by the agent — no cron polling needed.

**Why:** Cron-scheduled tasks waste tokens polling for "nothing to report." Webhooks flip the model: external services push events only when something happens. A Home Assistant automation, uptime monitor, or CI pipeline fires a POST, and the agent processes it within 2 seconds.

**Architecture:** A lightweight Node.js `http` server runs alongside WhatsApp. Incoming webhooks are inserted directly into the SQLite `messages` table as if they were WhatsApp messages. The existing 2-second polling loop picks them up and routes them through the normal container pipeline. No new dependencies — uses Node.js built-in `http` and `crypto`.

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A main channel must be registered (personal DM or WhatsApp Business via `/add-whatsapp-biz`)

## Step 1: Check Current State

```bash
grep "WEBHOOK_SECRET" .env 2>/dev/null && echo "SECRET_EXISTS" || echo "NEED_SECRET"
[ -f src/webhook-server.ts ] && echo "SERVER_EXISTS" || echo "NEED_SERVER"
```

If both exist, skip to Step 6 (Test).

## Step 2: Add Config Constants

Add `WEBHOOK_PORT` and `WEBHOOK_SECRET` to `src/config.ts`.

Append these lines **after** the `TIMEZONE` export at the end of the file:

```typescript
// Webhook server for external event ingestion
export const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3457', 10);
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
```

## Step 3: Add `storeWebhookMessage()` to `src/db.ts`

This is a plain-string alternative to `storeMessage()` (which requires a Baileys proto object). It inserts directly into the `messages` table and updates chat metadata.

Add this function after the existing `storeMessage()` function:

```typescript
/**
 * Store a webhook-originated message (plain strings, no Baileys dependency).
 * Inserts into the messages table and updates chat metadata so the
 * polling loop picks it up like any other message.
 */
export function storeWebhookMessage(
  chatJid: string,
  messageId: string,
  source: string,
  text: string,
): void {
  const timestamp = new Date().toISOString();

  storeChatMetadata(chatJid, timestamp, source);

  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(messageId, chatJid, `webhook:${source}`, source, text, timestamp, 0);
}
```

## Step 4: Create `src/webhook-server.ts`

Create this new file. It follows the same dependency-injection pattern as `task-scheduler.ts`.

```typescript
import crypto from 'crypto';
import http from 'http';

import { WEBHOOK_PORT, WEBHOOK_SECRET } from './config.js';
import { logger } from './logger.js';

export interface WebhookDependencies {
  getMainChannelJid: () => string | null;
  insertMessage: (chatJid: string, messageId: string, source: string, text: string) => void;
}

const MAX_BODY_SIZE = 65536; // 64KB

export function startWebhookServer(deps: WebhookDependencies): http.Server {
  const server = http.createServer((req, res) => {
    // Only accept POST /webhook
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Verify Bearer token
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${WEBHOOK_SECRET}`) {
      logger.warn({ ip: req.socket.remoteAddress }, 'Webhook auth rejected');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Read body with size limit
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (res.writableEnded) return;

      let payload: { source?: string; text?: string };
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const source = payload.source || 'webhook';
      const text = payload.text;

      if (!text || typeof text !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "text" field' }));
        return;
      }

      const mainJid = deps.getMainChannelJid();
      if (!mainJid) {
        logger.error('Webhook received but no main channel registered');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No main channel configured' }));
        return;
      }

      const messageId = `wh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      deps.insertMessage(mainJid, messageId, source, text);

      logger.info({ source, messageId, length: text.length }, 'Webhook message injected');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messageId }));
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    logger.info({ port: WEBHOOK_PORT }, 'Webhook server listening');
  });

  return server;
}
```

## Step 5: Wire Up in `src/index.ts`

Three changes to `src/index.ts`:

### 5a. Add imports

Add to the imports from `./config.js`:
```typescript
WEBHOOK_PORT,
WEBHOOK_SECRET,
```

Add to the imports from `./db.js`:
```typescript
storeWebhookMessage,
```

Add a new import:
```typescript
import { startWebhookServer } from './webhook-server.js';
```

### 5b. Start the webhook server in `main()`

Add this block in the `main()` function, **after** the business DM auto-registration block and **before** the graceful shutdown handlers:

```typescript
  // Start webhook server if secret is configured
  let webhookServer: import('http').Server | null = null;
  if (WEBHOOK_SECRET) {
    webhookServer = startWebhookServer({
      getMainChannelJid: () => {
        const entry = Object.entries(registeredGroups).find(
          ([, g]) => g.folder === MAIN_GROUP_FOLDER,
        );
        return entry ? entry[0] : null;
      },
      insertMessage: storeWebhookMessage,
    });
  } else {
    logger.debug('Webhook server disabled (no WEBHOOK_SECRET set)');
  }
```

### 5c. Add to shutdown handler

In the existing `shutdown` function, add before the `process.exit(0)` line:

```typescript
    if (webhookServer) {
      webhookServer.close();
    }
```

**Note:** The `webhookServer` variable must be declared in `main()` scope (before the shutdown function definition) so the closure can access it. Move the shutdown handler below the webhook server start block if needed, or declare `webhookServer` with `let` before the shutdown handler definition.

## Step 6: Add Environment Variable

Generate a secure random token and add it to `.env`:

```bash
# Generate a 32-byte random token
TOKEN=$(openssl rand -hex 32)
echo "WEBHOOK_SECRET=${TOKEN}" >> .env
echo "Generated WEBHOOK_SECRET: ${TOKEN}"
```

Optionally set a custom port (default is 3457):
```bash
echo "WEBHOOK_PORT=3457" >> .env
```

**Security:** Verify that `WEBHOOK_SECRET` is NOT in the container env allowlist in `src/container-runner.ts`. The secret must never leak into agent containers. Check with:

```bash
grep "WEBHOOK_SECRET" src/container-runner.ts
```

This should return no matches. If it does, remove it from the `allowedVars` array.

## Step 7: Build and Restart

```bash
npm run build
```

Restart the service:

```bash
# Linux
systemctl restart nanoclaw

# macOS
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist && launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

## Step 8: Test

Read the secret from `.env`:

```bash
SECRET=$(grep "^WEBHOOK_SECRET=" .env | cut -d= -f2)
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
      Authorization: "Bearer YOUR_WEBHOOK_SECRET"
      Content-Type: "application/json"
    payload: '{"source": "{{ source }}", "text": "{{ text }}"}'
```

### Uptime Kuma / Generic Monitor

```bash
curl -X POST http://NANOCLAW_IP:3457/webhook \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "uptime-kuma", "text": "ALERT: website.com is DOWN. Status: 503. Downtime: 2 minutes."}'
```

### Proxmox Backup Alert

```bash
curl -X POST http://NANOCLAW_IP:3457/webhook \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "proxmox", "text": "Backup completed for VM 100 (homelab). Size: 12GB. Duration: 8m 32s."}'
```

## How It Works

- Webhook server starts only if `WEBHOOK_SECRET` is set in `.env` (safe default = off)
- `POST /webhook` validates Bearer token, parses JSON body `{ source, text }`
- Generates a unique `wh-*` message ID and calls `storeWebhookMessage()`
- Message is inserted into SQLite `messages` table with `sender_name` set to `source`
- The existing 2-second polling loop picks it up via `getNewMessages()`
- Agent sees it as `<message sender="home-assistant" time="...">Motion detected...</message>`
- Agent processes it in the main channel container and replies on WhatsApp
- No new npm dependencies — uses Node.js built-in `http` and `crypto`

## Security

- **Auth:** Every request requires `Authorization: Bearer <WEBHOOK_SECRET>`
- **Isolation:** `WEBHOOK_SECRET` is NOT in the container env allowlist — agents can't read it
- **Payload limit:** 64KB max body size prevents memory exhaustion
- **SQL safety:** All inserts use parameterized queries
- **XSS safety:** Message content passes through `escapeXml()` in `formatMessages()`
- **Network:** Designed for VPN/mesh networks (Tailscale, Pangolin) — not internet-facing
- **Default off:** Server doesn't start without `WEBHOOK_SECRET` configured

## Troubleshooting

### Server not starting

```bash
grep -i "webhook" logs/nanoclaw.log | tail -10
```

Check that `WEBHOOK_SECRET` is set:
```bash
grep "^WEBHOOK_SECRET=" .env
```

### Port already in use

Change the port:
```bash
# In .env
WEBHOOK_PORT=3458
```

### Messages not being processed

Verify the main channel is registered:
```bash
sqlite3 store/messages.db "SELECT jid, folder FROM registered_groups WHERE folder = 'main'"
```

Check that webhook messages are in the database:
```bash
sqlite3 store/messages.db "SELECT * FROM messages WHERE id LIKE 'wh-%' ORDER BY timestamp DESC LIMIT 5"
```

### Firewall

If calling from another machine, ensure the webhook port is open:
```bash
# Check if port is listening
ss -tlnp | grep 3457

# If using ufw
sudo ufw allow 3457/tcp
```

## Removal

1. Remove the webhook server code:
```bash
rm src/webhook-server.ts
```

2. Remove imports and startup code from `src/index.ts` (the webhook server block and its imports)

3. Remove config constants from `src/config.ts` (`WEBHOOK_PORT`, `WEBHOOK_SECRET`)

4. Remove `storeWebhookMessage()` from `src/db.ts`

5. Remove env vars:
```bash
sed -i '/^WEBHOOK_SECRET=/d' .env
sed -i '/^WEBHOOK_PORT=/d' .env
```

6. Rebuild and restart.
