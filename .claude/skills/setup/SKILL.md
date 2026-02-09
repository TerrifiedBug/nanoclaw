---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, authenticate WhatsApp, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Run all commands automatically. Only pause when user action is required (scanning QR codes).

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## 1. Install Dependencies

```bash
npm install
```

## 2. Install Container Runtime

First, detect the platform and check what's available:

```bash
echo "Platform: $(uname -s)"
which container && echo "Apple Container: installed" || echo "Apple Container: not installed"
which docker && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

### If NOT on macOS (Linux, etc.)

Apple Container is macOS-only. Docker is the container runtime on Linux.

Tell the user:
> You're on Linux, so we'll use Docker for container isolation.

**Verify Docker is installed and running.** If not, tell the user to install Docker first:
```bash
# For Ubuntu/Debian:
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl enable docker && sudo systemctl start docker
```

The codebase already supports Docker — the source code uses `docker` commands for container operations. Continue to Section 3.

### If on macOS

**If Apple Container is already installed:** Continue to Section 3.

**If Apple Container is NOT installed:** Ask the user:
> NanoClaw needs a container runtime for isolated agent execution. You have two options:
>
> 1. **Apple Container** (default) - macOS-native, lightweight, designed for Apple silicon
> 2. **Docker** - Cross-platform, widely used, works on macOS and Linux
>
> Which would you prefer?

#### Option A: Apple Container

Tell the user:
> Apple Container is required for running agents in isolated environments.
>
> 1. Download the latest `.pkg` from https://github.com/apple/container/releases
> 2. Double-click to install
> 3. Run `container system start` to start the service
>
> Let me know when you've completed these steps.

Wait for user confirmation, then verify:

```bash
container system start
container --version
```

**Note:** NanoClaw automatically starts the Apple Container system when it launches, so you don't need to start it manually after reboots.

#### Option B: Docker

Tell the user:
> You've chosen Docker. Let me set that up now.

**Use the `/convert-to-docker` skill** to convert the codebase to Docker, then continue to Section 3.

## 3. Configure Claude Authentication

Ask the user:
> Do you want to use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

**First, detect if the environment is headless** (no browser available):

```bash
# Check for display/browser
[ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || echo "HEADLESS"
```

#### If headless (e.g., VPS/server):

On headless servers, `claude setup-token` can't open a browser but will display a URL. Use `expect` to run it in a PTY so it works properly:

1. Install expect if not available:
```bash
which expect || apt-get install -y expect 2>/dev/null || yum install -y expect 2>/dev/null
```

2. Create and run an expect script that captures the auth URL:
```bash
cat > /tmp/setup-token.exp << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set stty_init "columns 500 rows 50"
log_file -noappend /tmp/setup-token-debug.log

spawn claude setup-token

# Wait for "Paste" prompt (indicates URL has been shown)
expect {
    -re {Paste} {
        puts "\n===READY_FOR_CODE==="
    }
    timeout {
        puts "\n===TIMEOUT==="
        exit 1
    }
}

# Wait for code file
for {set i 0} {$i < 300} {incr i} {
    if {[file exists "/tmp/oauth_code.txt"]} {
        set f [open "/tmp/oauth_code.txt" "r"]
        set code [string trim [gets $f]]
        close $f
        if {$code ne ""} {
            break
        }
    }
    sleep 1
}

if {![info exists code] || $code eq ""} {
    puts "No code provided"
    exit 1
}

send "$code\r"

set timeout 30
expect {
    eof { puts "\n===DONE===" }
    timeout { puts "\n===TIMEOUT_AFTER_CODE===" }
}
EXPECT_EOF
chmod +x /tmp/setup-token.exp
```

3. Run the expect script in background, extract the URL, and show it to the user:
```bash
rm -f /tmp/oauth_code.txt /tmp/setup-token-debug.log
expect /tmp/setup-token.exp &
sleep 20
# Extract URL from debug log
grep -o 'https://claude.ai/oauth/authorize[^ ]*' /tmp/setup-token-debug.log | tr -d '\n'
```

4. Show the URL to the user and ask them to open it in any browser (on their phone, laptop, etc.), sign in, and paste the authorization code.

5. When they provide the code, write it to the file the expect script is watching:
```bash
echo "THE_CODE_HERE" > /tmp/oauth_code.txt
```

6. Wait ~15 seconds for the token exchange to complete, then verify:
```bash
cat ~/.claude/.credentials.json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Token type: {d.get(\"claudeAiOauth\",{}).get(\"subscriptionType\",\"unknown\")}')" 2>/dev/null || echo "Check .credentials.json manually"
```

7. Verify the credentials file was saved:
```bash
[ -f ~/.claude/.credentials.json ] && echo "Credentials saved — token will auto-sync to containers" || echo "ERROR: No credentials file found"
```

**Note:** The token is NOT stored in `.env`. NanoClaw automatically copies `~/.claude/.credentials.json` into each container on spawn. The SDK handles token refresh automatically using the refresh token in the credentials file.

#### If not headless (has browser):

Tell the user:
> Open another terminal window and run:
> ```
> claude setup-token
> ```
> A browser window will open for you to log in. Once authenticated, credentials are saved to `~/.claude/.credentials.json`.

**Note:** No need to manually extract the token. NanoClaw syncs the credentials file into containers automatically and the SDK handles token refresh.

### Option 2: API Key

Ask if they have an existing key to copy or need to create one.

**Copy existing:**
```bash
grep "^ANTHROPIC_API_KEY=" /path/to/source/.env > .env
```

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell the user to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image

Build the NanoClaw agent container:

```bash
./container/build.sh
```

This creates the `nanoclaw-agent:latest` image with Node.js, Chromium, Claude Code CLI, and agent-browser.

Verify the build succeeded by running a simple test (this auto-detects which runtime you're using):

```bash
if which docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo '{}' | docker run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "Container build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "Container build failed"
fi
```

## 5. WhatsApp Authentication

**USER ACTION REQUIRED**

First, check if already authenticated:
```bash
[ -f store/auth/creds.json ] && node -e "const c=require('./store/auth/creds.json'); if(c.registered) { console.log('Already authenticated'); process.exit(0); } else { process.exit(1); }" 2>/dev/null && echo "SKIP" || echo "NEED_AUTH"
```

If already authenticated, skip to the next step.

### If headless / running on a remote server:

Terminal QR codes may not display correctly in tool output due to character width issues. Use the HTTP QR server instead:

1. Install the qrcode npm package if not present:
```bash
npm list qrcode 2>/dev/null || npm install qrcode @types/qrcode --save-dev
```

2. Run `src/wa-auth-server.ts` which starts an HTTP server on port 8899:
```bash
npx tsx src/wa-auth-server.ts
```

This serves the QR code as a proper SVG image on a web page. Tell the user:
> Open **http://YOUR_SERVER_IP:8899** in your browser to see the QR code.
> On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan the QR code.

**IMPORTANT:** The auth server automatically reconnects after WhatsApp's 515 stream errors, which commonly occur during initial pairing on headless servers.

Wait for the script to output "Successfully authenticated" then continue.

### If running locally with a proper terminal:

**IMPORTANT:** Run this command in the **foreground**. The QR code is multi-line ASCII art that must be displayed in full. Do NOT run in background or truncate the output.

Tell the user:
> A QR code will appear below. On your phone:
> 1. Open WhatsApp
> 2. Tap **Settings → Linked Devices → Link a Device**
> 3. Scan the QR code

Run with a long Bash tool timeout (120000ms) so the user has time to scan. Do NOT use the `timeout` shell command (it's not available on macOS).

```bash
npm run auth
```

Wait for the script to output "Successfully authenticated" then continue.

## 6. Configure Assistant Name and Main Channel

This step configures three things at once: the trigger word, the main channel type, and the main channel selection.

### 6a. Ask for trigger word

Ask the user:
> What trigger word do you want to use? (default: `Andy`)
>
> In group chats, messages starting with `@TriggerWord` will be sent to Claude.
> In your main channel (and optionally solo chats), no prefix is needed — all messages are processed.

Store their choice for use in the steps below.

### 6b. Explain security model and ask about main channel type

**Use the AskUserQuestion tool** to present this:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire NanoClaw project
>
> **Recommendation:** Use your personal "Message Yourself" chat or a solo WhatsApp group as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Personal chat (Message Yourself) - Recommended
> 2. Solo WhatsApp group (just me)
> 3. Group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over NanoClaw.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a personal chat or solo group instead

### 6c. Register the main channel

First build, then start the app briefly to connect to WhatsApp and sync group metadata. Use the Bash tool's timeout parameter (15000ms) — do NOT use the `timeout` shell command (it's not available on macOS). The app will be killed when the timeout fires, which is expected.

```bash
npm run build
```

Then run briefly (set Bash tool timeout to 15000ms):
```bash
npm run dev
```

**For personal chat** (they chose option 1):

Personal chats are NOT synced to the database on startup — only groups are. Instead, ask the user for their phone number (with country code, no + or spaces, e.g. `14155551234`), then construct the JID as `{number}@s.whatsapp.net`.

**IMPORTANT:** Verify the phone number by cross-referencing with the WhatsApp connection log. After the brief `npm run dev`, check the log for the own JID:
```bash
grep "myPN" logs/nanoclaw.log | tail -1
```
This will show the actual phone number WhatsApp uses (e.g., `441234567890:16@s.whatsapp.net`). Use the number from this log (without the `:16` device suffix) as the JID. The user may accidentally include extra digits (e.g., typing `44441234567890` instead of `441234567890` for a UK number).

**For group** (they chose option 2 or 3):

Groups are synced on startup via `groupFetchAllParticipating`. Query the database for recent groups:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 40"
```

Show only the **10 most recent** group names to the user and ask them to pick one. If they say their group isn't in the list, show the next batch from the results you already have. If they tell you the group name directly, look it up:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE name LIKE '%GROUP_NAME%' AND jid LIKE '%@g.us'"
```

### 6d. Write the configuration

Once you have the JID, configure it. Use the assistant name from step 6a.

For personal chats (solo, no prefix needed), set `requiresTrigger` to `false`:

```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP",
    "requiresTrigger": false
  }
}
```

For groups, keep `requiresTrigger` as `true` (default).

Write to the database directly by creating a temporary registration script, or write `data/registered_groups.json` which will be auto-migrated on first run:

```bash
mkdir -p data
```

Then write `data/registered_groups.json` with the correct JID, trigger, and timestamp.

If the user chose a name other than `Andy`, also update:
1. `groups/global/CLAUDE.md` - Change "# Andy" and "You are Andy" to the new name
2. `groups/main/CLAUDE.md` - Same changes at the top

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 7. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the NanoClaw project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 7a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 7b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other WhatsApp chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 7c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/nanoclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the NanoClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app" }
>   ]
> }
> ```
> The folder appears inside the container at `/workspace/extra/<folder-name>` (derived from the last segment of the path). Add `"readonly": false` for write access, or `"containerPath": "custom-name"` to override the default name.

## 8. Configure Service

Detect the platform and set up the appropriate service manager:

```bash
echo "Platform: $(uname -s)"
```

### Linux: systemd

Create a systemd service unit:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)

cat > /etc/systemd/system/nanoclaw.service << EOF
[Unit]
Description=NanoClaw WhatsApp Agent
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=${NODE_PATH} ${PROJECT_PATH}/dist/index.js
WorkingDirectory=${PROJECT_PATH}
Restart=always
RestartSec=10
Environment=HOME=${HOME}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin
EnvironmentFile=${PROJECT_PATH}/.env
StandardOutput=append:${PROJECT_PATH}/logs/nanoclaw.log
StandardError=append:${PROJECT_PATH}/logs/nanoclaw.error.log

[Install]
WantedBy=multi-user.target
EOF

echo "Created systemd service with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Build and start:
```bash
npm run build
mkdir -p logs
systemctl daemon-reload
systemctl enable nanoclaw
systemctl start nanoclaw
```

Verify:
```bash
systemctl status nanoclaw
```

### macOS: launchd

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Build and start the service:

```bash
npm run build
mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

Verify it's running:
```bash
launchctl list | grep nanoclaw
```

## 9. Test

Tell the user (using the assistant name they configured):
> Send `@ASSISTANT_NAME hello` in your registered chat.
>
> **Tip:** In your main channel, you don't need the `@` prefix — just send `hello` and the agent will respond.

Check the logs:
```bash
tail -f logs/nanoclaw.log
```

The user should receive a response in WhatsApp.

## Troubleshooting

**Service not starting**: Check `logs/nanoclaw.error.log`

**Container agent fails with "Claude Code process exited with code 1"**:
- Ensure the container runtime is running:
  - Apple Container: `container system start`
  - Docker: `docker info` (start Docker Desktop on macOS, or `sudo systemctl start docker` on Linux)
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**Container agent fails with EACCES permission errors on `/home/node/.claude`**:
- This happens when Docker bind mounts create directories as root but Claude Code runs as the `node` user (UID 1000) inside the container.
- The `container-runner.ts` automatically runs `chown -R 1000:1000` on writable mounts before spawning containers.
- If the issue persists, manually fix: `chown -R 1000:1000 data/sessions/`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Main channel doesn't require a prefix — all messages are processed
- Personal/solo chats with `requiresTrigger: false` also don't need a prefix
- Check that the chat JID is in the database: `sqlite3 store/messages.db "SELECT * FROM registered_groups"`
- **Verify JID is correct:** Compare with the WhatsApp-reported number in logs: `grep "myPN" logs/nanoclaw.log | tail -1`
- Check `logs/nanoclaw.log` for errors

**WhatsApp 515 stream errors during auth**:
- This is a known Baileys issue. The `wa-auth-server.ts` script handles this automatically by reconnecting.
- If using `npm run auth` directly, the connection may fail after QR scan. Use `wa-auth-server.ts` instead.

**WhatsApp disconnected**:
- On macOS: The service will show a macOS notification
- Run `npm run auth` (or `npx tsx src/wa-auth-server.ts` on headless) to re-authenticate
- Restart the service:
  - Linux: `systemctl restart nanoclaw`
  - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

**Stop/unload service**:
- Linux: `systemctl stop nanoclaw` / `systemctl disable nanoclaw`
- macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
