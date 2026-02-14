---
name: add-trains
description: Add UK train departure/arrival information to NanoClaw via National Rail Darwin API. Guides through free API token registration and configures environment. Triggers on "add trains", "train times", "national rail", "uk trains setup".
---

# Add UK Trains

This skill configures live UK train departure and arrival data for agent containers by creating a plugin.

**What this does:**
- Stores Darwin API token in `.env` as `NATIONAL_RAIL_TOKEN`
- Creates `plugins/trains/` with `plugin.json`, agent skill, and Python query script
- Agents can then query live departures, arrivals, delays, and platforms

## Prerequisites

- NanoClaw must be set up and running (`/setup`)

## Step 1: Check Existing Configuration

```bash
grep "^NATIONAL_RAIL_TOKEN=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
```

If `ALREADY_CONFIGURED`, ask the user if they want to reconfigure or test the existing token.

## Step 2: Register for Darwin API Token

Tell the user:

> You need a free Darwin API token from National Rail. Here's how:
>
> 1. Go to https://realtime.nationalrail.co.uk/OpenLDBWSRegistration/
> 2. Fill in the registration form (name, email, reason: "personal use")
> 3. You'll receive an email with your API token
> 4. Paste the token here when ready

Wait for the user to provide the token.

## Step 3: Save to .env

```bash
# Remove existing line if present
sed -i '/^NATIONAL_RAIL_TOKEN=/d' .env

# Add the new token
echo 'NATIONAL_RAIL_TOKEN=THE_TOKEN_HERE' >> .env
```

## Step 4: Create Plugin Directory

```bash
mkdir -p plugins/trains/skills/scripts
```

Write `plugins/trains/plugin.json`:
```json
{
  "name": "trains",
  "description": "UK train times via National Rail Darwin API",
  "containerEnvVars": ["NATIONAL_RAIL_TOKEN"],
  "hooks": []
}
```

Write the agent skill file:
```bash
cat > plugins/trains/skills/SKILL.md << 'SKILL_EOF'
---
name: trains
description: Query UK National Rail live departure boards, arrivals, delays, and train services. Use when asked about train times, departures, arrivals, delays, platforms, or "when is the next train" for UK railways.
allowed-tools: Bash(python3:*),WebFetch
---

# UK Trains

Query National Rail for live train departures and arrivals. Run `/add-trains` on the host to configure the API token for full functionality.

## Method Selection

Check if `NATIONAL_RAIL_TOKEN` is set:

```bash
python3 -c "import os; print('API' if os.environ.get('NATIONAL_RAIL_TOKEN') else 'SCRAPE')"
```

- **API** → Use the Darwin API commands below (structured JSON, reliable)
- **SCRAPE** → Use the WebFetch fallback below (less reliable, use as last resort)

## Darwin API (preferred)

```bash
# Departures from a station
python3 /workspace/skills/trains/scripts/trains.py departures DID
python3 /workspace/skills/trains/scripts/trains.py departures DID to PAD --rows 5

# Arrivals at a station
python3 /workspace/skills/trains/scripts/trains.py arrivals PAD
python3 /workspace/skills/trains/scripts/trains.py arrivals PAD from DID

# Station search
python3 /workspace/skills/trains/scripts/trains.py search paddington
```

### Response Format

JSON with:
- `locationName`, `crs` - Station info
- `messages[]` - Service alerts
- `trainServices[]` - List of trains:
  - `std`/`sta` - Scheduled departure/arrival time
  - `etd`/`eta` - Expected time ("On time", "Delayed", or actual time)
  - `platform` - Platform number
  - `operator` - Train operating company
  - `carriages` - Number of coaches
  - `isCancelled`, `cancelReason`, `delayReason` - Disruption info
  - `destination[].name` / `origin[].name` - Route endpoints

### Getting Arrival Times

To show both departure and arrival times, make two calls:
1. `departures DID to PAD` — get departure times
2. `arrivals PAD from DID` — get arrival times
Match services by the numeric prefix in serviceID.

## WebFetch Fallback (no API token)

When `NATIONAL_RAIL_TOKEN` is not set, use WebFetch to scrape the National Rail website:

```
WebFetch https://www.nationalrail.co.uk/live-trains/departures/{FROM}/{TO}
```

Examples:
- Departures from Didcot to Paddington: `https://www.nationalrail.co.uk/live-trains/departures/DID/PAD`
- Departures from Paddington to Didcot: `https://www.nationalrail.co.uk/live-trains/departures/PAD/DID`

Extract train times, status (on time/delayed/cancelled), and platform numbers from the page content. This method is less reliable than the API — data may be incomplete or hard to parse.

## Station Codes

Use 3-letter CRS codes. Common ones:
- `DID` = Didcot Parkway
- `PAD` = London Paddington
- `RDG` = Reading
- `OXF` = Oxford
- `SWI` = Swindon
- `EUS` = London Euston
- `KGX` = London Kings Cross
- `VIC` = London Victoria
- `WAT` = London Waterloo
- `BHM` = Birmingham New Street
- `MAN` = Manchester Piccadilly

Use `search` (API mode) to find any station code.

## WhatsApp Message Template

```
🚂 {Origin} → {Destination}

*{dep} → {arr}* │📍{platform} │ 🚃 {coaches}
{status}
```

Status icons:
- ✅ On time
- ⚠️ Delayed (exp {time})
- ❌ Cancelled — {reason}
SKILL_EOF
```

The plugin also includes the Python query script at `plugins/trains/skills/scripts/trains.py`. This script handles SOAP requests to the Darwin API and provides the `departures`, `arrivals`, and `search` commands. Write it as follows:

```bash
cat > plugins/trains/skills/scripts/trains.py << 'SCRIPT_EOF'
#!/usr/bin/env python3
"""UK Trains CLI - Query National Rail Darwin API directly via SOAP"""
# ... (full trains.py content)
SCRIPT_EOF
chmod +x plugins/trains/skills/scripts/trains.py
```

The full `trains.py` script is too large to embed inline. Copy it from the existing source if available, or write it fresh with the Darwin SOAP API logic (station lookup, departures, arrivals commands).

## Step 5: Test the Token

```bash
source .env
[ -n "$NATIONAL_RAIL_TOKEN" ] && echo "OK - token is set (${#NATIONAL_RAIL_TOKEN} chars)" || echo "FAILED - NATIONAL_RAIL_TOKEN is empty"
```

For a deeper test (optional -- the Darwin API can be slow):
```bash
source .env
python3 plugins/trains/skills/scripts/trains.py departures PAD --rows 3
```

This should return JSON with live departures from London Paddington. If it works, the token is valid.

If it fails:
- **HTTP 401**: Token is invalid or not yet activated (can take a few minutes after registration)
- **Connection timeout**: Network issue, try again

## Step 6: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 7: Verify End-to-End

Tell the user:
> Train data is configured. Test it by sending a WhatsApp message like "when's the next train from Didcot to Paddington?"

## Troubleshooting

- **"NATIONAL_RAIL_TOKEN not set" in container**: Check that `plugins/trains/plugin.json` exists with `NATIONAL_RAIL_TOKEN` in `containerEnvVars`, and that `.env` has the variable set.
- **HTTP 401 errors**: Token may have expired or been revoked. Re-register at the Darwin portal.
- **Empty trainServices array**: The station may have no services at that time, or the filter station code is wrong.

## Uninstall

1. Remove the plugin:
```bash
rm -rf plugins/trains/
```

2. Remove token from `.env`:
```bash
sed -i '/^NATIONAL_RAIL_TOKEN=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

## Security

- API token is stored in `.env` which is gitignored
- `NATIONAL_RAIL_TOKEN` is declared in `plugin.json` `containerEnvVars` -- only passed to containers when the plugin is active
- Darwin API is free and read-only (no write operations possible)
