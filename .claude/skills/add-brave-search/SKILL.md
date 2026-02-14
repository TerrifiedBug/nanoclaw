---
name: add-brave-search
description: Add Brave Search API access to NanoClaw agent containers. Enables web search for research, current events, and fact-checking. Guides through free API key setup. Triggers on "add brave search", "brave search", "web search setup", "add search".
---

# Add Brave Search

This skill configures Brave Search API access for agent containers by creating a plugin.

**What this does:**
- Stores the Brave API key in `.env` as `BRAVE_API_KEY`
- Creates `plugins/brave-search/` with `plugin.json` and agent skill
- Agents can then search the web via the `brave-search` skill

## Step 1: Check Existing Configuration

```bash
grep "^BRAVE_API_KEY=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
```

If `ALREADY_CONFIGURED`, tell the user Brave Search is already set up. Ask if they want to replace the key.

## Step 2: Get API Key

Tell the user:
> To get a free Brave Search API key:
> 1. Go to https://brave.com/search/api/
> 2. Click "Get Started" and create an account
> 3. Subscribe to the **Free** plan (2,000 queries/month)
> 4. Copy your API key from the dashboard
>
> Paste the API key when ready.

## Step 3: Save to .env

```bash
# Remove existing line if present
sed -i '/^BRAVE_API_KEY=/d' .env

# Add the new key
echo 'BRAVE_API_KEY=THE_KEY_HERE' >> .env
```

## Step 4: Create Plugin Directory

```bash
mkdir -p plugins/brave-search/skills
```

Write `plugins/brave-search/plugin.json`:
```json
{
  "name": "brave-search",
  "description": "Brave Search API access for web search",
  "containerEnvVars": ["BRAVE_API_KEY"],
  "hooks": []
}
```

Write the agent skill file:
```bash
cat > plugins/brave-search/skills/SKILL.md << 'SKILL_EOF'
---
name: brave-search
description: Search the web using Brave Search API. Use for research, current events, finding information online, fact-checking, or when you need to look something up.
allowed-tools: Bash(curl:*)
---

# Web Search with Brave

Search the web for any topic using Brave Search API. Requires `$BRAVE_API_KEY` environment variable. If not configured, tell the user to run `/add-brave-search` on the host to set it up.

```bash
# Basic search
curl -s "https://api.search.brave.com/res/v1/web/search?q=your+search+query" \
  -H "X-Subscription-Token: $BRAVE_API_KEY"

# Recent results (past 24 hours)
curl -s "https://api.search.brave.com/res/v1/web/search?q=your+query&freshness=pd" \
  -H "X-Subscription-Token: $BRAVE_API_KEY"

# Specific country/language
curl -s "https://api.search.brave.com/res/v1/web/search?q=your+query&country=GB&search_lang=en" \
  -H "X-Subscription-Token: $BRAVE_API_KEY"
```

## Response Format
Returns JSON with `web.results[]` array containing:
- `title` - Page title
- `url` - Page URL
- `description` - Snippet text
- `published` - Publish date

## Freshness Options
- `pd` - Past 24 hours
- `pw` - Past week
- `pm` - Past month
- `py` - Past year

Use for: research, news, fact-checking, finding documentation, troubleshooting.
SKILL_EOF
```

## Step 5: Test the Key

```bash
source .env
curl -s "https://api.search.brave.com/res/v1/web/search?q=test&count=1" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'web' in r and r['web'].get('results'):
    print(f\"OK - got {len(r['web']['results'])} result(s)\")
else:
    print(f\"FAILED - {r.get('message', r.get('type', 'unknown error'))}\")
"
```

If the test fails, help troubleshoot:
- **"Unauthorized"**: Key is wrong or not activated yet
- **"Rate limited"**: Free tier exceeded, wait or upgrade

## Step 6: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 7: Verify End-to-End

Tell the user:
> Brave Search is configured. Test it by sending a WhatsApp message like "search for the latest tech news" or "what's happening in the world today?"

## Uninstall

1. Remove the plugin:
```bash
rm -rf plugins/brave-search/
```

2. Remove from `.env`:
```bash
sed -i '/^BRAVE_API_KEY=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

## Security

- API key is stored in `.env` which is gitignored
- `BRAVE_API_KEY` is declared in `plugin.json` `containerEnvVars` -- only passed to containers when the plugin is active
- Free tier: 2,000 queries/month, no billing unless you upgrade
