---
name: add-brave-search
description: Add Brave Search API access to NanoClaw agent containers. Enables web search for research, current events, and fact-checking. Guides through free API key setup. Triggers on "add brave search", "brave search", "web search setup", "add search".
---

# Add Brave Search

This skill configures Brave Search API access for agent containers.

**What this does:**
- Stores the Brave API key in `.env` as `BRAVE_API_KEY`
- Ensures `BRAVE_API_KEY` is in the container env allowlist
- Agents can then search the web via the `brave-search` container skill

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

## Step 4: Verify Container Allowlist

Check that `BRAVE_API_KEY` is in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "BRAVE_API_KEY" src/container-runner.ts
```

If not present, add `'BRAVE_API_KEY'` to the `allowedVars` array.

## Step 5: Verify Container Skill Exists

```bash
[ -f container/skills/brave-search/SKILL.md ] && echo "SKILL_EXISTS" || echo "NEED_SKILL"
```

The container skill should already exist. If missing, flag this as an error — it ships with NanoClaw.

## Step 6: Test the Key

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

## Step 7: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 8: Verify End-to-End

Tell the user:
> Brave Search is configured. Test it by sending a WhatsApp message like "search for the latest tech news" or "what's happening in the world today?"

## Removal

1. Remove from `.env`:
```bash
sed -i '/^BRAVE_API_KEY=/d' .env
```

2. Rebuild and restart NanoClaw.

## Security

- API key is stored in `.env` which is gitignored
- `BRAVE_API_KEY` is filtered through `allowedVars` — only passed to containers that need it
- Free tier: 2,000 queries/month, no billing unless you upgrade
