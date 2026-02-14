---
name: add-notion
description: Add Notion API access to NanoClaw. Enables agents to read and update Notion pages and databases for project management, notes, and tracking. Guides through integration setup. Triggers on "add notion", "notion setup", "notion integration", "notion api".
---

# Add Notion

This skill configures Notion API access for agent containers by creating a plugin.

**What this does:**
- Stores Notion API key in `.env` as `NOTION_API_KEY`
- Creates `plugins/notion/` with `plugin.json` and agent skill
- Agents can then read/update Notion pages and databases

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A Notion account with pages you want the agent to access

## Step 1: Check Existing Configuration

```bash
grep "^NOTION_API_KEY=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
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

## Step 4: Create Plugin Directory

```bash
mkdir -p plugins/notion/skills
```

Write `plugins/notion/plugin.json`:
```json
{
  "name": "notion",
  "description": "Notion API access for pages and databases",
  "containerEnvVars": ["NOTION_API_KEY"],
  "hooks": []
}
```

Write the agent skill file:
```bash
cat > plugins/notion/skills/SKILL.md << 'SKILL_EOF'
---
name: notion
description: Read and update Notion pages and databases. Use for project management, notes, documentation, and tracking information.
allowed-tools: Bash(curl:*)
---

# Notion API Access

Interact with Notion pages and databases. Requires `$NOTION_API_KEY` environment variable. If not configured, tell the user to run `/add-notion` on the host to set it up.

```bash
# Read a page
curl -s "https://api.notion.com/v1/pages/PAGE_ID" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28"

# Read page content (blocks)
curl -s "https://api.notion.com/v1/blocks/PAGE_ID/children" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28"

# Update page properties
curl -s "https://api.notion.com/v1/pages/PAGE_ID" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -X PATCH \
  -d '{"properties": {"Title": {"title": [{"text": {"content": "Updated Title"}}]}}}'

# Add content block
curl -s "https://api.notion.com/v1/blocks/PAGE_ID/children" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -X PATCH \
  -d '{"children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": "New content"}}]}}]}'
```

## Usage
- Replace PAGE_ID with actual Notion page IDs
- Page IDs found in Notion URLs: notion.so/PAGE_ID

## Tips
- Always use Notion-Version: 2022-06-28 header
- Page IDs are in the URL: notion.so/PAGE_ID
- Use PATCH for updates, GET for reads
- Rich text format for content blocks
SKILL_EOF
```

## Step 5: Test the Token

```bash
source .env
curl -s "https://api.notion.com/v1/users/me" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'id' in r:
    print(f'OK - {r.get(\"name\", \"connected\")}')
else:
    print(f'FAILED - {r}')
"
```

If the test fails:
- **401 Unauthorized**: Token is invalid -- check you copied the full secret
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

- **"NOTION_API_KEY not set" in container**: Check that `plugins/notion/plugin.json` exists with `NOTION_API_KEY` in `containerEnvVars`, and that `.env` has the variable set.
- **"Could not find page"**: The page hasn't been connected to the integration. Open the page in Notion > ... > Connections > add your integration.
- **401 errors**: Token may have been revoked. Generate a new one at https://www.notion.so/my-integrations

## Uninstall

1. Remove the plugin:
```bash
rm -rf plugins/notion/
```

2. Remove token from `.env`:
```bash
sed -i '/^NOTION_API_KEY=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

## Security

- API key is stored in `.env` which is gitignored
- `NOTION_API_KEY` is declared in `plugin.json` `containerEnvVars` -- only passed to containers when the plugin is active
- Use read-only capabilities unless write access is explicitly needed
