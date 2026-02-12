---
name: add-github
description: Add GitHub API access to NanoClaw. Enables agents to monitor repos, check PRs, issues, commits, and CI status. Guides through Personal Access Token setup. Triggers on "add github", "github setup", "github integration", "github token".
---

# Add GitHub

This skill configures GitHub API access for agent containers using a Personal Access Token (PAT).

**What this does:**
- Stores GitHub PAT in `.env` as `GH_TOKEN`
- Adds `GH_TOKEN` to the container env allowlist
- Agents can then monitor repos, check PRs/issues, view CI status, and track activity

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A GitHub account

## Step 1: Check Existing Configuration

```bash
grep "^GH_TOKEN=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
grep "GH_TOKEN" src/container-runner.ts | head -1
```

If `ALREADY_CONFIGURED`, ask the user if they want to reconfigure or test the existing token.

## Step 2: Create a Personal Access Token

Tell the user:

> You need a GitHub Personal Access Token (fine-grained). Here's how:
>
> 1. Go to https://github.com/settings/tokens?type=beta
> 2. Click **Generate new token**
> 3. Give it a name (e.g. "NanoClaw")
> 4. Set expiration (recommended: 90 days or longer)
> 5. Under **Repository access**, select the repos you want the agent to monitor (or "All repositories")
> 6. Under **Permissions**, enable:
>    - **Contents**: Read-only (to view code and commits)
>    - **Pull requests**: Read-only (to check PRs)
>    - **Issues**: Read-only (to check issues)
>    - **Actions**: Read-only (to check CI status)
> 7. Click **Generate token** and copy it

Wait for the user to provide the token.

## Step 3: Save to .env

```bash
# Remove existing line if present
sed -i '/^GH_TOKEN=/d' .env

# Add the new token
echo 'GH_TOKEN=THE_TOKEN_HERE' >> .env
```

## Step 4: Add to Container Runner Allowlist

Check if `GH_TOKEN` is already in the `allowedVars` array in `src/container-runner.ts`:

```bash
grep "GH_TOKEN" src/container-runner.ts
```

If not present, add `'GH_TOKEN'` to the `allowedVars` array.

## Step 5: Test the Token

```bash
source .env
curl -s "https://api.github.com/user" \
  -H "Authorization: token $GH_TOKEN" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'login' in r:
    print(f'OK - authenticated as {r[\"login\"]} ({r.get(\"name\", \"\")})')
else:
    print(f'FAILED - {r.get(\"message\", json.dumps(r)[:200])}')
"
```

If the test fails:
- **401 Bad credentials**: Token is invalid or expired
- **403 Forbidden**: Token lacks required permissions
- **Connection timeout**: Network issue, try again

## Step 6: Build and Restart

```bash
npm run build
systemctl restart nanoclaw
```

## Step 7: Verify End-to-End

Tell the user:
> GitHub is configured. Test it by sending a WhatsApp message like "check my GitHub for any open PRs" or "what's the latest activity on my repos?"

## Troubleshooting

- **"GH_TOKEN not set" in container**: Check that `GH_TOKEN` is in the `allowedVars` array in `src/container-runner.ts`, and that `.env` has the variable set.
- **401 errors**: Token may have expired. Generate a new one at https://github.com/settings/tokens
- **404 on repos**: Token may not have access to that repository. Check token's repository access scope.

## Removal

1. Remove token from `.env`:
```bash
sed -i '/^GH_TOKEN=/d' .env
```

2. Remove `'GH_TOKEN'` from `allowedVars` in `src/container-runner.ts`

3. Optionally remove the container skill:
```bash
rm -rf container/skills/github/
```

4. Rebuild and restart NanoClaw.
