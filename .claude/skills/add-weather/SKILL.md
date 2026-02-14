---
name: add-weather
description: Add weather lookup capability to NanoClaw agents. Uses free wttr.in and Open-Meteo APIs — no API key needed. Triggers on "add weather", "weather setup", "weather skill".
---

# Add Weather Lookup

This skill adds weather forecast capability to NanoClaw agents using free public APIs (no API key required).

## Step 1: Create the weather plugin

```bash
mkdir -p plugins/weather/skills
```

Write `plugins/weather/plugin.json`:

```json
{
  "name": "weather",
  "description": "Weather forecasts and current conditions",
  "containerEnvVars": [],
  "hooks": []
}
```

Write `plugins/weather/skills/SKILL.md`:

```markdown
---
name: weather
description: Get weather forecasts and current conditions for any location. Use whenever weather is asked about or relevant.
allowed-tools: Bash(curl:*)
---

# Weather Lookup

Use curl for quick weather lookups (no API key needed):

\`\`\`bash
curl -s "wttr.in/CityName?format=3"          # One-line summary
curl -s "wttr.in/CityName?format=%l:+%c+%t+%h+%w"  # Compact
curl -s "wttr.in/CityName?T"                  # Full forecast
\`\`\`

Tips:
- URL-encode spaces (`New+York`)
- `?m` metric, `?u` USCS
- `?1` today only, `?0` current only

Fallback (JSON): `curl -s "https://api.open-meteo.com/v1/forecast?latitude=LAT&longitude=LON&current_weather=true"`
```

## Step 2: Build and restart

```bash
npm run build
```

Then restart the service:
- **Linux (systemd):** `systemctl restart nanoclaw`
- **macOS (launchd):** `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

## Step 3: Verify

The agent can now answer weather questions. Test by asking about the weather in any city.

## Uninstall

```bash
rm -rf plugins/weather/
npm run build
# Restart service
```
