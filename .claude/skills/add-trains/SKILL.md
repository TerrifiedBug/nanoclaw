---
name: add-trains
description: Add UK train departure/arrival information to NanoClaw via National Rail Darwin API. Guides through free API token registration and configures environment. Triggers on "add trains", "train times", "national rail", "uk trains setup".
---

# Add UK Trains

This skill configures live UK train departure and arrival data for agent containers using the National Rail Darwin API.

**What this does:**
- Stores Darwin API token in `.env` as `NATIONAL_RAIL_TOKEN`
- Adds `NATIONAL_RAIL_TOKEN` to the container env allowlist
- Agents can then query live departures, arrivals, delays, and platforms

## Prerequisites

- NanoClaw must be set up and running (`/setup`)

## Step 1: Check Existing Configuration

```bash
grep "^NATIONAL_RAIL_TOKEN=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
grep "NATIONAL_RAIL_TOKEN" src/container-runner.ts | head -1
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

## Step 4: Add to Container Runner Allowlist

Check if `NATIONAL_RAIL_TOKEN` is already in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "NATIONAL_RAIL_TOKEN" src/container-runner.ts
```

If not present, add `'NATIONAL_RAIL_TOKEN'` to the `allowedVars` array.

## Step 5: Test the Token

```bash
source .env
python3 container/skills/trains/scripts/trains.py departures PAD --rows 3
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

- **"NATIONAL_RAIL_TOKEN not set" in container**: Check that `NATIONAL_RAIL_TOKEN` is in the `allowedVars` array in `src/container-runner.ts`, and that `.env` has the variable set.
- **HTTP 401 errors**: Token may have expired or been revoked. Re-register at the Darwin portal.
- **Empty trainServices array**: The station may have no services at that time, or the filter station code is wrong.

## Removal

1. Remove token from `.env`:
```bash
sed -i '/^NATIONAL_RAIL_TOKEN=/d' .env
```

2. Remove `'NATIONAL_RAIL_TOKEN'` from `allowedVars` in `src/container-runner.ts`

3. Optionally remove the container skill:
```bash
rm -rf container/skills/trains/
```

4. Rebuild and restart NanoClaw.
