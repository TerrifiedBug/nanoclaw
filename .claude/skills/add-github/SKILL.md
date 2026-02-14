---
name: add-github
description: Add GitHub API access to NanoClaw. Enables agents to monitor repos, check PRs, issues, commits, and CI status. Guides through Personal Access Token setup. Triggers on "add github", "github setup", "github integration", "github token".
---

# Add GitHub

This skill configures GitHub API access for agent containers by creating a plugin.

**What this does:**
- Stores GitHub PAT in `.env` as `GH_TOKEN`
- Creates `plugins/github/` with `plugin.json` and agent skill
- Agents can then monitor repos, check PRs/issues, view CI status, and track activity

## Prerequisites

- NanoClaw must be set up and running (`/setup`)
- A GitHub account

## Step 1: Check Existing Configuration

```bash
grep "^GH_TOKEN=" .env 2>/dev/null && echo "ALREADY_CONFIGURED" || echo "NEEDS_SETUP"
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

## Step 4: Create Plugin Directory

```bash
mkdir -p plugins/github/skills
```

Write `plugins/github/plugin.json`:
```json
{
  "name": "github",
  "description": "GitHub API access for repo monitoring",
  "containerEnvVars": ["GH_TOKEN"],
  "hooks": []
}
```

Write the agent skill file:
```bash
cat > plugins/github/skills/SKILL.md << 'SKILL_EOF'
---
name: github
description: Monitor GitHub repositories, check PRs, issues, commits, and releases. Use for tracking development activity and code management.
allowed-tools: Bash(curl:*)
---

# GitHub API Access

Monitor GitHub repositories and activity. Requires `$GH_TOKEN` environment variable. If not configured, tell the user to run `/add-github` on the host to set it up.

```bash
# Check for new PRs on main repos
curl -s "https://api.github.com/repos/OWNER/REPO/pulls" \
  -H "Authorization: token $GH_TOKEN"

curl -s "https://api.github.com/repos/OWNER/REPO/pulls" \
  -H "Authorization: token $GH_TOKEN"

# Check specific PR details
curl -s "https://api.github.com/repos/OWNER/REPO/pulls/PR_NUMBER" \
  -H "Authorization: token $GH_TOKEN"

# Recent commits
curl -s "https://api.github.com/repos/OWNER/REPO/commits?since=2024-01-01T00:00:00Z" \
  -H "Authorization: token $GH_TOKEN"

# Repository activity
curl -s "https://api.github.com/repos/OWNER/REPO/events" \
  -H "Authorization: token $GH_TOKEN"

# Check CI status
curl -s "https://api.github.com/repos/OWNER/REPO/actions/runs" \
  -H "Authorization: token $GH_TOKEN"
```

## Key Repositories
Discover repositories by querying the GitHub API:
```bash
# List user's repositories
curl -s "https://api.github.com/user/repos?sort=updated&per_page=10" \
  -H "Authorization: token $GH_TOKEN"
```

## Environment
- `GH_TOKEN` environment variable contains GitHub PAT
- Token has read/write access to contents and pull requests
- Never add Co-authored-by lines to commits

## Use Cases
- Monitor for new PRs requiring review
- Check CI/CD status
- Track development activity
- Get notifications for repository changes
SKILL_EOF
```

## Step 5: Test the Token

```bash
source .env
curl -s -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'login' in r:
    print(f'OK - {r[\"login\"]}')
else:
    print(f'FAILED - {r}')
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

- **"GH_TOKEN not set" in container**: Check that `plugins/github/plugin.json` exists with `GH_TOKEN` in `containerEnvVars`, and that `.env` has the variable set.
- **401 errors**: Token may have expired. Generate a new one at https://github.com/settings/tokens
- **404 on repos**: Token may not have access to that repository. Check token's repository access scope.

## Uninstall

1. Remove the plugin:
```bash
rm -rf plugins/github/
```

2. Remove token from `.env`:
```bash
sed -i '/^GH_TOKEN=/d' .env
```

3. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

## Security

- Token is stored in `.env` which is gitignored
- `GH_TOKEN` is declared in `plugin.json` `containerEnvVars` -- only passed to containers when the plugin is active
- Use fine-grained PATs with minimal permissions (read-only recommended)
