---
name: add-notion
description: Add Notion API access to NanoClaw. Enables agents to read and update Notion pages and databases for project management, notes, and tracking. Guides through integration setup. Triggers on "add notion", "notion setup", "notion integration", "notion api".
---

# Add Notion

This skill configures Notion API access for agent containers using an internal integration token.

**What this does:**
- Stores Notion API key in `.env` as `NOTION_API_KEY`
- Adds `NOTION_API_KEY` to the container env allowlist
- Agents can then read/update Notion pages and databases

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A Notion account with pages you want the agent to access

## Step 1: Check Existing Configuration

```bash
grep "^NOTION_API_KEY=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
grep "NOTION_API_KEY" src/container-runner.ts | head -1
```

If `ALREADY_CONFIGURED`, ask the user if they want to reconfigure or test the existing token.

## Step 2: Create a Notion Integration

Tell the user:

> You need a Notion internal integration. Here's how:
>
> 1. Go to https://www.notion.so/my-integrations
> 2. Click **New integration**
> 3. Give it a name (e.g. "NanoClaw")
> 4. Select the workspace you want to connect
> 5. Under **Capabilities**, enable:
>    - **Read content** (required)
>    - **Update content** (if you want the agent to edit pages)
>    - **Insert content** (if you want the agent to add blocks)
> 6. Click **Submit** and copy the **Internal Integration Secret** (starts with `ntn_`)
>
> Then, for each page/database the agent should access:
> 1. Open the page in Notion
> 2. Click **...** (top-right) > **Connections** > **Connect to** > select your integration

Wait for the user to provide the token.

## Step 3: Save to .env

```bash
# Remove existing line if present
sed -i '/^NOTION_API_KEY=/d' .env

# Add the new token
echo 'NOTION_API_KEY=THE_TOKEN_HERE' >> .env
```

## Step 4: Add to Container Runner Allowlist

Check if `NOTION_API_KEY` is already in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "NOTION_API_KEY" src/container-runner.ts
```

If not present, add `'NOTION_API_KEY'` to the `allowedVars` array.

## Step 5: Test the Token

```bash
source .env
curl -s "https://api.notion.com/v1/users/me" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'name' in r:
    print(f'OK - authenticated as {r[\"name\"]} ({r.get(\"type\", \"\")})')
elif r.get('object') == 'error':
    print(f'FAILED - {r.get(\"message\", json.dumps(r)[:200])}')
else:
    print(f'UNEXPECTED - {json.dumps(r)[:200]}')
"
```

If the test fails:
- **401 Unauthorized**: Token is invalid — check you copied the full secret
- **403 Restricted**: Token exists but lacks permissions
- **Connection timeout**: Network issue, try again

## Step 6: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 7: Verify End-to-End

Tell the user:
> Notion is configured. Test it by sending a WhatsApp message like "check my Notion for recent updates" or "add a note to my Notion page"
>
> Remember: the agent can only access pages that have been explicitly connected to the integration (Step 2).

## Troubleshooting

- **"NOTION_API_KEY not set" in container**: Check that `NOTION_API_KEY` is in the `allowedVars` array in `src/container-runner.ts`, and that `.env` has the variable set.
- **"Could not find page"**: The page hasn't been connected to the integration. Open the page in Notion > ... > Connections > add your integration.
- **401 errors**: Token may have been revoked. Generate a new one at https://www.notion.so/my-integrations

## Removal

1. Remove token from `.env`:
```bash
sed -i '/^NOTION_API_KEY=/d' .env
```

2. Remove `'NOTION_API_KEY'` from `allowedVars` in `src/container-runner.ts`

3. Optionally remove the container skill:
```bash
rm -rf container/skills/notion/
```

4. Rebuild and restart NanoClaw.
