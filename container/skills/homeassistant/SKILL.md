---
name: homeassistant
description: Control Home Assistant - smart plugs, lights, scenes, automations, sensors, climate, media players. Uses native MCP tools for device control and state queries.
allowed-tools: mcp__home-assistant(*), Bash(curl:*)
---

# Home Assistant

Control smart home devices via Home Assistant's MCP Server integration. If MCP tools and `$HA_URL`/`$HA_TOKEN` are not configured, tell the user to run `/add-homeassistant` on the host to set it up.

## How It Works

Home Assistant is connected as an MCP server. You have native MCP tools available — use them directly to control devices, query states, and manage automations. Look for tools prefixed with `mcp__home-assistant`.

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

```bash
# Get entity state
curl -s "$HA_URL/api/states/{entity_id}" -H "Authorization: Bearer $HA_TOKEN"

# Call a service
curl -s -X POST "$HA_URL/api/services/{domain}/{service}" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "...", ...}'
```

## Entity Domains

- `switch.*` -- Smart plugs, generic switches
- `light.*` -- Lights (Hue, LIFX, etc.)
- `scene.*` -- Pre-configured scenes
- `automation.*` -- Automations
- `climate.*` -- Thermostats
- `cover.*` -- Blinds, garage doors
- `media_player.*` -- TVs, speakers
- `sensor.*` -- Temperature, humidity, etc.

## Notes

- Only entities exposed in HA's Voice assistants > Expose settings are accessible
- To request access to more entities, tell the user to expose them in HA settings
- MCP tools are the preferred method — only use curl as a fallback
