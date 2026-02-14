---
name: add-changedetection
description: Add changedetection.io integration to NanoClaw. Enables agents to create and manage website watches for price monitoring, stock alerts, and content changes. Guides through API key setup and webhook configuration. Triggers on "add changedetection", "changedetection setup", "price monitoring", "website monitoring".
---

# Add ChangeDetection.io

This skill configures changedetection.io API access for agent containers and sets up webhook notifications so changes trigger the agent automatically.

**What this does:**
- Stores the changedetection.io URL and API key in `.env`
- Creates the `plugins/changedetection/` plugin directory with env var config and agent skill
- Configures changedetection.io to webhook back to NanoClaw on changes
- Agents can then create/manage watches via the `changedetection` agent skill

## Prerequisites

- A running changedetection.io instance (self-hosted)
- NanoClaw webhook server must be configured (`/add-webhook`)

## Step 1: Check Existing Configuration

```bash
grep "^CHANGEDETECTION_URL=" .env 2>/dev/null && echo "URL_SET" || echo "NEED_URL"
grep "^CHANGEDETECTION_API_KEY=" .env 2>/dev/null && echo "KEY_SET" || echo "NEED_KEY"
grep "^NANOCLAW_WEBHOOK_SECRET=" .env 2>/dev/null && echo "WEBHOOK_SET" || echo "NEED_WEBHOOK"
ls plugins/changedetection/plugin.json 2>/dev/null && echo "PLUGIN_EXISTS" || echo "NO_PLUGIN"
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

## Step 4: Create Plugin Directory

Create the plugin directory with `plugin.json` and the agent skill:

```bash
mkdir -p plugins/changedetection/skills

cat > plugins/changedetection/plugin.json << 'PLUGIN_EOF'
{
  "name": "changedetection",
  "description": "Website change monitoring via changedetection.io",
  "containerEnvVars": ["CHANGEDETECTION_URL", "CHANGEDETECTION_API_KEY"],
  "hooks": []
}
PLUGIN_EOF

cat > plugins/changedetection/skills/SKILL.md << 'SKILL_EOF'
---
name: changedetection
description: Monitor websites for changes using changedetection.io. Create watches for price tracking, stock alerts, and content monitoring. Use for price monitoring, wishlist tracking, or any website change detection.
allowed-tools: Bash(curl:*)
---

# Website Monitoring with ChangeDetection.io

Monitor websites for price changes, stock availability, and content updates. Requires `$CHANGEDETECTION_URL` and `$CHANGEDETECTION_API_KEY` environment variables. If not configured, tell the user to run `/add-changedetection` on the host to set it up.

## Authentication

All requests use the `x-api-key` header:
```bash
curl -s "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Creating a Watch

### Basic watch
```bash
curl -s -X POST "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-page",
    "title": "Product Name - Price Watch"
  }'
```

### Price monitoring watch (with webhook notification)
```bash
curl -s -X POST "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-page",
    "title": "Product Name - Price Watch",
    "include_filters": [".price", ".product-price", "[data-price]"],
    "processor": "restock_diff",
    "track_ldjson_price_data": true,
    "time_between_check": {"hours": 4},
    "notification_urls": ["json://'"${NANOCLAW_WEBHOOK_URL}"'"],
    "notification_title": "Price Change: {watch_title}",
    "notification_body": "{watch_url} changed. Check the latest snapshot.",
    "notification_format": "text"
  }'
```

### Watch with CSS selector for specific element
```bash
curl -s -X POST "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product",
    "title": "Descriptive title",
    "include_filters": ["div.price-container", "span.current-price"],
    "subtractive_selectors": ["div.ads", "nav", "footer"],
    "time_between_check": {"hours": 6}
  }'
```

## Webhook Notification Setup

To have changedetection.io notify NanoClaw when a change is detected, use the `notification_urls` field with the NanoClaw webhook:

```
json://NANOCLAW_HOST:3457/webhook
```

The `NANOCLAW_WEBHOOK_URL` env var contains the full webhook URL if configured. The notification will be POSTed as JSON to NanoClaw's webhook endpoint.

**Important:** The webhook needs the Bearer token. When setting up notifications, use this format:
```
json://NANOCLAW_HOST:3457/webhook?+HeaderName=Authorization&-Authorization=Bearer+WEBHOOK_SECRET
```

Or configure the notification in changedetection.io's global settings UI to include the Authorization header.

## Listing Watches

```bash
# List all watches (returns UUID-keyed dictionary)
curl -s "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" | python3 -c "
import sys, json
watches = json.load(sys.stdin)
for uuid, w in watches.items():
    title = w.get('title', 'Untitled')
    url = w.get('url', '')
    last = w.get('last_changed', 'never')
    print(f'{title}: {url} (last changed: {last}, uuid: {uuid})')
"
```

## Getting Watch Details

```bash
curl -s "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Getting Latest Snapshot

```bash
# Get history timestamps
curl -s "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID/history" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"

# Get latest snapshot content
curl -s "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID/history/latest" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Comparing Changes

```bash
# Compare previous vs latest snapshot
curl -s "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID/difference/previous/latest?format=text" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Updating a Watch

```bash
curl -s -X PUT "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "time_between_check": {"hours": 1},
    "include_filters": [".new-price-selector"]
  }'
```

## Deleting a Watch

```bash
curl -s -X DELETE "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Trigger Immediate Recheck

```bash
curl -s "${CHANGEDETECTION_URL}/api/v1/watch/WATCH_UUID?recheck=1" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}"
```

## Price Monitoring Workflow

When monitoring prices from a Notion wishlist:

1. Read the wishlist from Notion (use the `notion` skill)
2. For each product URL, create a watch with:
   - `include_filters` targeting the price element (inspect the page to find the right CSS selector)
   - `processor: "restock_diff"` for e-commerce pages
   - `track_ldjson_price_data: true` to extract structured price data from JSON-LD
   - `notification_urls` pointing to NanoClaw's webhook
   - `time_between_check` set to a reasonable interval (4-12 hours for prices)
3. When a price changes, the webhook fires, and you can:
   - Fetch the diff to see old vs new price
   - Notify the user with the price change details
   - Update the Notion wishlist with the new price

## Common CSS Selectors for Prices

- Amazon: `.a-price .a-offscreen`, `#priceblock_ourprice`
- eBay: `.x-price-primary span`
- Generic: `.price`, `[data-price]`, `.product-price`
- JSON-LD: Enable `track_ldjson_price_data` instead of CSS selectors

**Tip:** If unsure about the selector, create the watch without `include_filters` first. Check the snapshot to see what content is captured, then refine with specific selectors.

## Troubleshooting

- **Watch not detecting changes**: The CSS selector might be wrong. Check the latest snapshot content to verify what's being captured.
- **Notification not firing**: Verify the webhook URL is correct and reachable from the changedetection.io host.
- **JavaScript-rendered content**: Set `fetch_backend` to `"html_webdriver"` for pages that require JavaScript rendering (requires Playwright/browser setup in changedetection.io).
SKILL_EOF
```

## Step 5: Test the Connection

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

## Step 6: Test Webhook Connectivity

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

## Step 7: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 8: Verify End-to-End

Tell the user:
> ChangeDetection.io is configured. You can now ask the agent to:
> - "Monitor this product page for price changes: [URL]"
> - "Set up watches for the items on my Notion wishlist"
> - "Show me all active changedetection watches"
>
> When a watched page changes, changedetection.io will webhook NanoClaw and the agent will notify you automatically.

## Uninstall

1. Remove the plugin directory:
```bash
rm -rf plugins/changedetection/
```

2. Remove from `.env`:
```bash
sed -i '/^CHANGEDETECTION_URL=/d' .env
sed -i '/^CHANGEDETECTION_API_KEY=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

## Security

- API key is stored in `.env` which is gitignored
- `CHANGEDETECTION_URL` and `CHANGEDETECTION_API_KEY` are passed to containers via the plugin's `containerEnvVars` config
- Webhook notifications are authenticated via `NANOCLAW_WEBHOOK_SECRET`
- changedetection.io instance should be on a private network or VPN
