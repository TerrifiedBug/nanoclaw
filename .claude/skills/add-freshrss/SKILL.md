---
name: add-freshrss
description: Add FreshRSS feed reader integration to NanoClaw. Connects agents to a self-hosted FreshRSS instance for news summaries, unread articles, feed management, and daily digests. Guides through API key setup and configures environment. Triggers on "add freshrss", "freshrss setup", "rss feeds", "add rss".
---

# Add FreshRSS

This skill configures RSS feed access for agent containers using a self-hosted FreshRSS instance and its Google Reader API.

**What this does:**
- Stores FreshRSS credentials in `.env` as `FRESHRSS_URL`, `FRESHRSS_USER`, and `FRESHRSS_API_KEY`
- Creates the `plugins/freshrss/` plugin directory with env var config and agent skill
- Agents can then read unread articles, manage subscriptions, star items, and build daily digests

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A self-hosted FreshRSS instance with API access enabled

## Step 1: Check Existing Configuration

```bash
grep "^FRESHRSS_URL=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
ls plugins/freshrss/plugin.json 2>/dev/null && echo "PLUGIN_EXISTS" || echo "NO_PLUGIN"
```

If `ALREADY_CONFIGURED`, ask the user if they want to reconfigure or test the existing setup.

## Step 2: Gather FreshRSS Details

Ask the user for:

1. **FreshRSS URL** — the base URL of their instance (e.g. `https://freshrss.example.com`), no trailing slash
2. **FreshRSS username** — the login username (e.g. `admin`, `fruity`)
3. **FreshRSS API password** — this is NOT the web login password

Tell the user:
> To get your FreshRSS API password:
> 1. Log in to your FreshRSS instance
> 2. Go to **Settings** (gear icon) > **Profile**
> 3. Scroll to **API Management**
> 4. Set an API password if you haven't already, then click **Submit**
> 5. Copy the API password and paste it here

Wait for the user to provide all three values.

## Step 3: Save to .env

```bash
# Remove existing lines if present
sed -i '/^FRESHRSS_URL=/d' .env
sed -i '/^FRESHRSS_USER=/d' .env
sed -i '/^FRESHRSS_API_KEY=/d' .env

# Add FreshRSS credentials
echo 'FRESHRSS_URL=THE_URL_HERE' >> .env
echo 'FRESHRSS_USER=THE_USERNAME_HERE' >> .env
echo 'FRESHRSS_API_KEY=THE_API_KEY_HERE' >> .env
```

## Step 4: Create Plugin Directory

Create the plugin directory with `plugin.json` and the agent skill:

```bash
mkdir -p plugins/freshrss/skills

cat > plugins/freshrss/plugin.json << 'PLUGIN_EOF'
{
  "name": "freshrss",
  "description": "FreshRSS feed reader integration",
  "containerEnvVars": ["FRESHRSS_URL", "FRESHRSS_USER", "FRESHRSS_API_KEY"],
  "hooks": []
}
PLUGIN_EOF

cat > plugins/freshrss/skills/SKILL.md << 'SKILL_EOF'
---
name: freshrss
description: Read and manage RSS feeds via FreshRSS. Use for news summaries, unread articles, feed management, topic searches, or daily digests. Use whenever the user asks about news, feeds, articles, or RSS.
allowed-tools: Bash(curl:*)
---

# FreshRSS RSS Reader

Access the user's self-hosted FreshRSS instance via the Google Reader API. Requires `$FRESHRSS_URL`, `$FRESHRSS_USER`, and `$FRESHRSS_API_KEY` environment variables. If not configured, tell the user to run `/add-freshrss` on the host to set it up.

**Environment variables:**
- `FRESHRSS_URL` — Base URL of the FreshRSS instance (no trailing slash)
- `FRESHRSS_USER` — FreshRSS username (for GReader API auth)
- `FRESHRSS_API_KEY` — API password (set in FreshRSS > Settings > Profile > API Management)

## Authentication

FreshRSS uses the GReader API. First obtain an auth token, then use it for all requests:

```bash
# Get auth token (use the API password, not the web login password)
AUTH=$(curl -s "$FRESHRSS_URL/api/greader.php/accounts/ClientLogin" \
  -d "Email=$FRESHRSS_USER&Passwd=$FRESHRSS_API_KEY" | grep -oP 'Auth=\K.*')

echo "Auth token: $AUTH"
```

Use the token in all subsequent requests:
```bash
-H "Authorization: GoogleLogin auth=$AUTH"
```

## Common Operations

### Get unread count

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/unread-count?output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq .
```

### List subscriptions (feeds)

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/subscription/list?output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq '.subscriptions[] | {title, id, url: .htmlUrl}'
```

### Get unread articles

```bash
# Get newest 20 unread articles
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/reading-list?n=20&xt=user/-/state/com.google/read&output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq '.items[] | {title, published: (.published | todate), summary: .summary.content[0:200], origin: .origin.title, link: .alternate[0].href}'
```

### Get all recent articles (read and unread)

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/reading-list?n=50&output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq '.items[] | {title, published: (.published | todate), summary: .summary.content[0:200], origin: .origin.title}'
```

### Get articles from a specific feed

```bash
# Use feed ID from subscription list (e.g., feed/123)
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/stream/contents/FEED_ID?n=10&output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq '.items[] | {title, published: (.published | todate), summary: .summary.content[0:200]}'
```

### Mark article as read

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/edit-tag" \
  -H "Authorization: GoogleLogin auth=$AUTH" \
  -d "i=ITEM_ID&a=user/-/state/com.google/read"
```

### Mark all as read for a feed

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/mark-all-as-read" \
  -H "Authorization: GoogleLogin auth=$AUTH" \
  -d "s=FEED_ID&ts=$(date +%s)000000"
```

### Star an article

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/edit-tag" \
  -H "Authorization: GoogleLogin auth=$AUTH" \
  -d "i=ITEM_ID&a=user/-/state/com.google/starred"
```

### Get starred articles

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/starred?n=20&output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq '.items[] | {title, published: (.published | todate), link: .alternate[0].href}'
```

### List categories/tags

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/tag/list?output=json" \
  -H "Authorization: GoogleLogin auth=$AUTH" | jq .
```

### Add a new feed subscription

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/subscription/edit" \
  -H "Authorization: GoogleLogin auth=$AUTH" \
  -d "ac=subscribe&s=feed/https://example.com/feed.xml"
```

### Remove a feed subscription

```bash
curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/subscription/edit" \
  -H "Authorization: GoogleLogin auth=$AUTH" \
  -d "ac=unsubscribe&s=FEED_ID"
```

## Tips

- Always authenticate first and store the token in `$AUTH` before making requests
- The `n` parameter controls how many results to return (default varies)
- Article summaries contain HTML — strip tags for clean text if needed: `| sed 's/<[^>]*>//g'`
- `published` is a Unix timestamp — use `jq` `todate` to convert
- The `xt` parameter excludes tags (e.g., `xt=user/-/state/com.google/read` excludes read items)
- When summarizing feeds, focus on titles and sources first, then fetch full content only if the user asks for details
- For daily digests, get unread articles sorted by feed/category for a structured overview
SKILL_EOF
```

## Step 5: Test the API Connection

```bash
source .env
AUTH=$(curl -s "$FRESHRSS_URL/api/greader.php/accounts/ClientLogin" \
  -d "Email=$FRESHRSS_USER&Passwd=$FRESHRSS_API_KEY" | grep -oP 'Auth=\K.*')

if [ -n "$AUTH" ]; then
  UNREAD=$(curl -s "$FRESHRSS_URL/api/greader.php/reader/api/0/unread-count?output=json" \
    -H "Authorization: GoogleLogin auth=$AUTH" | python3 -c "
import sys, json
r = json.load(sys.stdin)
total = sum(int(f.get('count', 0)) for f in r.get('unreadcounts', []))
print(f'OK - {total} unread articles')
")
  echo "$UNREAD"
else
  echo "FAILED - Could not authenticate. Check URL, username, and API password."
fi
```

If the test fails:
- **Empty auth token**: Wrong username or API password (not the web login password)
- **Connection refused**: Check FreshRSS URL and that the instance is running
- **404**: FreshRSS API may not be enabled — check Settings > Authentication > Allow API access

## Step 6: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 7: Verify End-to-End

Tell the user:
> FreshRSS is configured. Test it by sending a WhatsApp message like "what's in my RSS feeds?" or "give me a news summary"

## Troubleshooting

- **"FRESHRSS_URL not set" in container**: Check that `plugins/freshrss/plugin.json` exists with the correct `containerEnvVars`, and that `.env` has the variables set.
- **Authentication fails inside container**: The API password is different from the web login password. Re-check in FreshRSS Settings > Profile > API Management.
- **"API not enabled"**: In FreshRSS, go to Settings > Authentication and ensure "Allow API access" is checked.

## Uninstall

1. Remove the plugin directory:
```bash
rm -rf plugins/freshrss/
```

2. Remove credentials from `.env`:
```bash
sed -i '/^FRESHRSS_URL=/d' .env
sed -i '/^FRESHRSS_USER=/d' .env
sed -i '/^FRESHRSS_API_KEY=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```
