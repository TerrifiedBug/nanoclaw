---
name: add-homeassistant
description: Add Home Assistant integration to NanoClaw via official MCP Server. Enables agents to control smart home devices, query states, and manage automations. Guides through HA MCP Server setup and configures environment. Triggers on "add home assistant", "add homeassistant", "home assistant setup", "smart home".
---

# Add Home Assistant (MCP Server)

This skill configures Home Assistant integration for agent containers using HA's official MCP Server integration. Agents get native MCP tools to control devices, query states, and manage automations.

**What this does:**
- Enables HA's built-in MCP Server integration
- Stores `HA_URL` and `HA_TOKEN` in `.env`
- Creates a `plugins/homeassistant/` plugin with MCP config fragment and agent skill
- The plugin loader merges the MCP config and passes env vars to containers automatically

**What this does NOT do:**
- No polling or webhook setup (use `/add-webhook` for HA push events)
- No custom tool definitions -- tools come from HA's Assist API dynamically

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- Home Assistant instance accessible from this server (local network or remote)
- Home Assistant 2025.2 or newer (MCP Server integration was introduced in 2025.2)

## Step 1: Check Existing Configuration

```bash
grep "^HA_URL=" .env 2>/dev/null && echo "HA_URL_SET" || echo "HA_URL_MISSING"
grep "^HA_TOKEN=" .env 2>/dev/null && echo "HA_TOKEN_SET" || echo "HA_TOKEN_MISSING"
[ -d plugins/homeassistant ] && echo "PLUGIN_EXISTS" || echo "PLUGIN_MISSING"
```

If already configured, ask the user if they want to reconfigure or just verify the setup.

## Step 2: Enable MCP Server Integration in Home Assistant

Tell the user:

> **Enable the MCP Server integration in Home Assistant:**
> 1. Open your Home Assistant web UI
> 2. Go to **Settings > Devices & Services**
> 3. Click **+ Add Integration**
> 4. Search for **"Model Context Protocol Server"** and add it
> 5. Once added, it exposes an MCP endpoint at `/api/mcp`
>
> **Expose entities to the agent:**
> 1. Go to **Settings > Voice assistants**
> 2. Click **Expose** tab
> 3. Select entities you want the agent to control (lights, switches, sensors, etc.)
> 4. Only exposed entities will be available -- start conservative, expand later

Ask the user to confirm they've done this before proceeding.

## Step 3: Gather Connection Details

Collect from the user:

1. **Home Assistant URL** -- e.g., `http://192.168.1.100:8123` or `https://ha.example.com`
   - Must be reachable from this server (not just from the user's browser)
   - No trailing slash

2. **Long-Lived Access Token** -- created in HA:
   > To create a long-lived access token:
   > 1. In Home Assistant, click your profile icon (bottom-left)
   > 2. Scroll to **Long-Lived Access Tokens**
   > 3. Click **Create Token**, name it "NanoClaw"
   > 4. Copy the token immediately (it's only shown once)

Tell the user to create the token and paste it when ready.

## Step 4: Test Connection

Verify the HA instance is reachable and the token works:

```bash
curl -sf -o /dev/null -w "%{http_code}" \
  "$HA_URL/api/" \
  -H "Authorization: Bearer $HA_TOKEN"
```

Expected: `200`. If it fails:
- **Connection refused / timeout**: HA URL is wrong or not reachable from this server
- **401**: Token is invalid -- regenerate it
- **404**: URL may need a port (`:8123`) or the path is wrong

Then test that the MCP endpoint exists:

```bash
curl -sf -o /dev/null -w "%{http_code}" \
  "$HA_URL/api/mcp" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"nanoclaw","version":"1.0"}}}'
```

Expected: `200`. If `404`, the MCP Server integration is not enabled in HA.

## Step 5: Save to .env

Write both variables to `.env`. If they already exist, replace them.

```bash
# Remove existing lines if present
sed -i '/^HA_URL=/d' .env
sed -i '/^HA_TOKEN=/d' .env

# Add the new configuration
echo "HA_URL=THE_URL_HERE" >> .env
echo "HA_TOKEN=THE_TOKEN_HERE" >> .env
```

## Step 6: Create Plugin

Create the `plugins/homeassistant/` directory with `plugin.json`, `mcp.json`, and agent skill.

```bash
mkdir -p plugins/homeassistant/skills
```

### 6a. Create `plugins/homeassistant/plugin.json`

```json
{
  "name": "homeassistant",
  "description": "Home Assistant smart home integration via MCP",
  "containerEnvVars": ["HA_URL", "HA_TOKEN"],
  "hooks": []
}
```

### 6b. Create `plugins/homeassistant/mcp.json`

This MCP config fragment is automatically merged by the plugin loader -- no need to edit the root `.mcp.json`.

```json
{
  "mcpServers": {
    "home-assistant": {
      "type": "http",
      "url": "${HA_URL}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${HA_TOKEN}"
      }
    }
  }
}
```

The `${HA_URL}` and `${HA_TOKEN}` use Claude Code's env var expansion -- they reference the values from `.env` at runtime, so no secrets are stored in the config.

### 6c. Create `plugins/homeassistant/skills/SKILL.md`

Write the agent skill file with the following content:

```markdown
---
name: homeassistant
description: Control Home Assistant - smart plugs, lights, scenes, automations, sensors, climate, media players. Uses native MCP tools for device control and state queries.
allowed-tools: mcp__home-assistant(*), Bash(curl:*)
---

# Home Assistant

Control smart home devices via Home Assistant's MCP Server integration. If MCP tools and `$HA_URL`/`$HA_TOKEN` are not configured, tell the user to run `/add-homeassistant` on the host to set it up.

## How It Works

Home Assistant is connected as an MCP server. You have native MCP tools available -- use them directly to control devices, query states, and manage automations. Look for tools prefixed with `mcp__home-assistant`.

## Usage

Use the MCP tools naturally. Examples of what you can do:
- Turn lights on/off, set brightness and color
- Toggle switches and smart plugs
- Check sensor readings (temperature, humidity, motion, etc.)
- Trigger scenes and automations
- Query device states
- Control climate devices (thermostats)
- Control media players

## Fallback: REST API

If MCP tools are unavailable, fall back to the REST API with curl:

\`\`\`bash
# Get entity state
curl -s "$HA_URL/api/states/{entity_id}" -H "Authorization: Bearer $HA_TOKEN"

# Call a service
curl -s -X POST "$HA_URL/api/services/{domain}/{service}" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "...", ...}'
\`\`\`

## Entity Domains

- `switch.*` -- Smart plugs, generic switches
- `light.*` -- Lights (Hue, LIFX, etc.)
- `scene.*` -- Pre-configured scenes
- `automation.*` -- Automations
- `climate.*` -- Thermostats
- `cover.*` -- Blinds, garage doors
- `media_player.*` -- TVs, speakers
- `sensor.*` -- Temperature, humidity, etc.

## Event-Driven Alerts

For "alert me when X happens" based on HA state changes, you MUST create an **HA automation** -- never use scheduled tasks or n8n polling for HA state changes. HA automations are instant (event-driven), token-free, and the correct approach.

### Step 1: Check rest_command.nanoclaw_webhook

HA automations can't call external URLs natively. They need a `rest_command` entry to call the NanoClaw webhook. The service MUST be named exactly `nanoclaw_webhook`. **Always check this first** before creating any alert:

\`\`\`bash
curl -s "$HA_URL/api/services" -H "Authorization: Bearer $HA_TOKEN" | python3 -c "
import sys, json
services = json.load(sys.stdin)
rc = [s for s in services if s['domain'] == 'rest_command']
if rc and 'nanoclaw_webhook' in rc[0].get('services', {}):
    print('READY: rest_command.nanoclaw_webhook is configured')
else:
    print('MISSING: rest_command.nanoclaw_webhook not found')
"
\`\`\`

**If MISSING:** Stop and guide the user through the one-time setup. Do NOT create a scheduled task or n8n workflow as a fallback.

First, read the actual webhook values from the environment:

\`\`\`bash
echo "WEBHOOK_URL: $NANOCLAW_WEBHOOK_URL"
echo "WEBHOOK_SECRET: $NANOCLAW_WEBHOOK_SECRET"
\`\`\`

Then give the user the exact YAML to add to their HA config files. Substitute the real values from the env vars above into the examples below.

**configuration.yaml** -- add under `rest_command:` (or create the section if it doesn't exist):

\`\`\`yaml
rest_command:
  nanoclaw_webhook:
    url: "ACTUAL_WEBHOOK_URL"
    method: POST
    content_type: "application/json"
    headers:
      Authorization: !secret nanoclaw_webhook_secret
    payload: '{"source": "{{ source }}", "text": "{{ message }}"}'
\`\`\`

Note: `content_type` MUST be a top-level field (same level as `url`/`method`), NOT inside `headers`. HA will send an empty body without it.

**secrets.yaml** -- add this line (the `Bearer ` prefix with the trailing space is required):

\`\`\`yaml
nanoclaw_webhook_secret: "Bearer ACTUAL_WEBHOOK_SECRET"
\`\`\`

Replace `ACTUAL_WEBHOOK_URL` and `ACTUAL_WEBHOOK_SECRET` with the real values you read from the env vars above. The `Bearer ` prefix MUST be included in the secrets.yaml value -- HA's `!secret` does a direct text substitution, so the full Authorization header value (including `Bearer `) must be in the secret.

After editing both files, the user must restart HA or reload the REST Command integration, then let you know when done.

**Wait for the user to confirm setup before proceeding.** Once they confirm, re-check that `rest_command.nanoclaw_webhook` is available, then create the automation.

### Step 2: Create the Automation

Once `rest_command.nanoclaw_webhook` is confirmed available, create automations via the REST API:

\`\`\`bash
curl -s -X POST "$HA_URL/api/config/automation/config/nanoclaw_example_alert" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "NanoClaw: Example Sensor Alert",
    "description": "Alert when a sensor exceeds a threshold",
    "trigger": [
      {
        "platform": "numeric_state",
        "entity_id": "sensor.example_sensor",
        "above": 80
      }
    ],
    "condition": [],
    "action": [
      {
        "service": "rest_command.nanoclaw_webhook",
        "data": {
          "source": "ha-example-alert",
          "message": "Example sensor is at {{ states(\"sensor.example_sensor\") }}%"
        }
      }
    ],
    "mode": "single"
  }'
\`\`\`

Key points:
- The automation ID (URL path) should be a descriptive slug prefixed with `nanoclaw_`
- The action MUST use `rest_command.nanoclaw_webhook` -- this is the exact service name
- Use `numeric_state` triggers for threshold alerts (above/below)
- Use `state` triggers for on/off changes
- Use Jinja2 templates in the message to include live sensor values
- Set `"mode": "single"` to prevent duplicate alerts

## Notes

- Only entities exposed in HA's Voice assistants > Expose settings are accessible
- To request access to more entities, tell the user to expose them in HA settings
- MCP tools are the preferred method -- only use curl as a fallback
- For HA-based alerts, prefer HA automations over scheduled tasks -- they're instant and native
- Always check for `rest_command.nanoclaw_webhook` before creating alert automations
- The rest_command MUST be named exactly `nanoclaw_webhook` -- do not use any other name
```

## Step 7: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 8: Verify End-to-End

Tell the user:
> Home Assistant is connected via MCP. Test it by sending a WhatsApp message like:
> - "What lights are on?"
> - "Turn off the living room lights"
> - "What's the temperature in the bedroom?"
>
> The agent now has native MCP tools for Home Assistant -- it can query states, control devices, trigger automations, and more. Only the entities you exposed in Step 2 are accessible.

## Reconfiguring

Re-run `/add-homeassistant` to change the URL, token, or verify the setup.

## Exposing More Entities

To give the agent access to more devices:
1. Go to HA > **Settings > Voice assistants > Expose**
2. Toggle on additional entities
3. No rebuild needed -- changes are reflected immediately via MCP

## Troubleshooting

- **Agent says "no MCP tools available"**: Check that `plugins/homeassistant/mcp.json` has the `home-assistant` entry, HA MCP Server integration is enabled, and entities are exposed
- **Connection errors in agent**: Verify HA is reachable from this server (`curl $HA_URL/api/`), not just from the user's local network
- **Agent can't control a device**: The entity isn't exposed -- go to HA Voice assistants > Expose and toggle it on
- **"401 Unauthorized"**: Long-lived access token is invalid -- regenerate in HA profile settings
- **"404 Not Found" on /api/mcp**: MCP Server integration is not enabled in HA -- add it via Settings > Devices & Services

## Removal

1. Remove the plugin:
```bash
rm -rf plugins/homeassistant/
```

2. Remove credentials from `.env`:
```bash
sed -i '/^HA_URL=/d' .env
sed -i '/^HA_TOKEN=/d' .env
```

3. Rebuild and restart NanoClaw.

4. Optionally disable the MCP Server integration in HA and revoke the access token.
