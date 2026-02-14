---
name: add-claude-mem
description: Add persistent memory (claude-mem) to NanoClaw agent containers. Creates systemd services for the worker daemon and Docker bridge, configures env vars. Run once after claude-mem plugin is installed.
---

# Add Claude-Mem to Agent Containers

Run all commands automatically. Only pause if a step fails.

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text.

## How It Works

The claude-mem worker daemon runs on the host (port 37777) and stores observations in a SQLite + vector DB at `/root/.claude-mem/`. A socat bridge exposes it to Docker containers via 172.17.0.1:37777.

**Auto-capture:** The agent-runner (`container/agent-runner/src/index.ts`) has a built-in `PostToolUse` SDK hook. When `CLAUDE_MEM_URL` is set, every tool use (Bash, Read, MCP calls, etc.) is automatically saved to the database via `POST /api/memory/save`. No additional setup is needed — setting the env var enables it.

**Search:** Container agents use the `claude-mem` agent skill (`plugins/claude-mem/skills/SKILL.md`) to search past observations via `GET /api/search?query=...&project=nanoclaw-mem`.

**Manual save:** Agents can also explicitly save facts via `POST /api/memory/save` with `project=nanoclaw-mem`.

## 1. Verify Prerequisites

Check that claude-mem is installed:

```bash
# Check claude-mem database exists
ls /root/.claude-mem/claude-mem.db
```

If the database does not exist, **stop and tell the user**:
> Claude-mem is not installed. Run `claude plugin add @thedotmack/claude-mem` first, complete the initial setup wizard, then re-run `/add-claude-mem`.

Verify a plugin version exists:

```bash
ls /root/.claude/plugins/cache/thedotmack/claude-mem/*/scripts/worker-service.cjs 2>/dev/null | head -1
```

If nothing is found, **stop and tell the user** the plugin files are missing.

Check Bun is installed:

```bash
BUN_PATH=$(which bun 2>/dev/null || echo "/root/.bun/bin/bun")
$BUN_PATH --version
```

## 2. Kill Orphaned Worker Processes

The claude-mem plugin hooks spawn detached worker processes. Kill them before creating a systemd service to avoid port conflicts:

```bash
pkill -f 'worker-service.cjs.*--daemon' 2>/dev/null || true
sleep 2
# Verify port 37777 is free
curl -s --max-time 2 http://127.0.0.1:37777/api/health >/dev/null 2>&1 && echo "WARNING: Port 37777 still in use" || echo "Port 37777 is free"
```

If the port is still in use, find and kill the process:

```bash
lsof -ti :37777 | xargs kill -9 2>/dev/null || true
sleep 1
```

## 3. Install socat

```bash
which socat >/dev/null 2>&1 && echo "socat already installed" || (apt-get update && apt-get install -y socat)
```

## 4. Create Wrapper Scripts

These scripts dynamically resolve the plugin version at runtime, so the service survives plugin upgrades without manual edits.

```bash
mkdir -p /root/.claude-mem

cat > /root/.claude-mem/run-worker.sh << 'EOF'
#!/bin/bash
# Dynamically find the claude-mem worker script from the latest installed plugin version
PLUGIN_DIR="/root/.claude/plugins/cache/thedotmack/claude-mem"
WORKER=$(ls -td "$PLUGIN_DIR"/*/scripts/worker-service.cjs 2>/dev/null | head -1)

if [ -z "$WORKER" ]; then
  echo "Error: claude-mem worker script not found in $PLUGIN_DIR" >&2
  exit 1
fi

echo "Starting worker from: $WORKER"
exec /root/.bun/bin/bun "$WORKER" start
EOF

cat > /root/.claude-mem/stop-worker.sh << 'EOF'
#!/bin/bash
# Dynamically find the claude-mem worker script from the latest installed plugin version
PLUGIN_DIR="/root/.claude/plugins/cache/thedotmack/claude-mem"
WORKER=$(ls -td "$PLUGIN_DIR"/*/scripts/worker-service.cjs 2>/dev/null | head -1)

if [ -z "$WORKER" ]; then
  # No script found, try to stop via API directly
  curl -s -X POST http://127.0.0.1:37777/api/admin/shutdown 2>/dev/null
  exit 0
fi

exec /root/.bun/bin/bun "$WORKER" stop
EOF

chmod +x /root/.claude-mem/run-worker.sh /root/.claude-mem/stop-worker.sh
```

## 5. Create systemd Service for Claude-Mem Worker

The worker uses `Type=oneshot` with `RemainAfterExit=yes` because the `start` subcommand spawns a detached daemon process and exits.

```bash
cat > /etc/systemd/system/claude-mem-worker.service << 'EOF'
[Unit]
Description=Claude-Mem Worker Daemon
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/root/.claude-mem/run-worker.sh
ExecStop=/root/.claude-mem/stop-worker.sh
WorkingDirectory=/root/.claude-mem
Environment=HOME=/root
Environment=PATH=/root/.bun/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF
```

## 6. Create systemd Service for socat Bridge

The bridge binds ONLY to the Docker bridge gateway IP (172.17.0.1), not 0.0.0.0. This means the API is only reachable from Docker containers, not from the broader network.

```bash
cat > /etc/systemd/system/claude-mem-bridge.service << 'EOF'
[Unit]
Description=Claude-Mem Docker Bridge (socat)
After=claude-mem-worker.service docker.service
Requires=claude-mem-worker.service

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:37777,bind=172.17.0.1,reuseaddr,fork TCP:127.0.0.1:37777
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

## 7. Enable and Start Services

```bash
systemctl daemon-reload
systemctl enable claude-mem-worker claude-mem-bridge
systemctl start claude-mem-worker
```

Wait 3 seconds, then verify the worker is healthy:

```bash
sleep 3
curl -s http://127.0.0.1:37777/api/health
```

If the worker is healthy, start the bridge:

```bash
systemctl start claude-mem-bridge
```

Verify both services are running:

```bash
systemctl status claude-mem-worker --no-pager -l
systemctl status claude-mem-bridge --no-pager -l
```

## 8. Test Connectivity from a Container

```bash
docker run --rm --entrypoint node nanoclaw-agent:latest \
  -e "fetch('http://172.17.0.1:37777/api/health').then(r=>r.json()).then(d=>console.log('OK:',JSON.stringify(d))).catch(e=>console.error('FAIL:',e.message))"
```

If this prints `OK: {"status":"ok",...}` then connectivity is working.

## 9. Add Environment Variable

Add `CLAUDE_MEM_URL` to the project `.env` file:

```bash
grep -q "^CLAUDE_MEM_URL=" .env 2>/dev/null || echo "CLAUDE_MEM_URL=http://172.17.0.1:37777" >> .env
```

## 10. Create Plugin Directory

Create the plugin directory with `plugin.json` and the agent skill:

```bash
mkdir -p plugins/claude-mem/skills

cat > plugins/claude-mem/plugin.json << 'PLUGIN_EOF'
{
  "name": "claude-mem",
  "description": "Persistent cross-session memory",
  "containerEnvVars": ["CLAUDE_MEM_URL"],
  "hooks": []
}
PLUGIN_EOF

cat > plugins/claude-mem/skills/SKILL.md << 'SKILL_EOF'
---
name: claude-mem
description: Search the claude-mem persistent database for past context. Tool use is auto-captured — use this skill to search and recall. Standing rules and preferences go in MEMORY.md instead.
allowed-tools: Bash(curl:*)
---

# Persistent Memory

You have a persistent memory database that survives across sessions. Requires `$CLAUDE_MEM_URL` environment variable. If not configured, run `/add-claude-mem` on the host to set it up.

**Important:** Always use `project=nanoclaw-mem` in all API calls to keep memories isolated from other systems.

## What's Captured Automatically

Every tool use (Bash, Read, WebSearch, MCP calls, etc.) is automatically saved to the database with the tool name, input, and output. You don't need to manually save tool results — they're already searchable.

## Where to Store What

| What | Where | Why |
|------|-------|-----|
| Standing rules ("always use metric") | **MEMORY.md** | Auto-loaded every session, always visible |
| Personal facts ("user likes flat whites") | **MEMORY.md** | Should be available without searching |
| Preferences and routines | **MEMORY.md** | Persistent across all conversations |
| Important conclusions from this conversation | **claude-mem save** | Searchable later, not needed every session |
| "Remember this for later" (user request) | **claude-mem save** | Explicit user request to persist a fact |
| Tool outputs and actions taken | **Auto-captured** | Already saved, no action needed |

### Manual Save

Use the save endpoint for important conclusions or facts the user shares that aren't from a tool call:

```bash
curl -s -X POST "$CLAUDE_MEM_URL/api/memory/save" \
  -H "Content-Type: application/json" \
  -d '{"text": "User prefers flat white coffee", "project": "nanoclaw-mem"}'
```

## When to Search Memory

- User asks about something discussed previously
- User references a person, project, or recurring topic
- User says "remember when...", "last time...", or "did I tell you..."
- You need context about past decisions or plans
- Before making assumptions about recurring topics
- Be proactive — search memory at the start of conversations about recurring topics

## Search Memory

```bash
curl -s "$CLAUDE_MEM_URL/api/search?query=morning+routine+preferences&project=nanoclaw-mem" | jq -r '.content[0].text // .'
```

Search returns an index with observation IDs and titles. If you need full details for specific results, fetch them by ID.

## Get Full Details

```bash
curl -s -X POST "$CLAUDE_MEM_URL/api/observations/batch" \
  -H "Content-Type: application/json" \
  -d '{"ids": [42, 43]}' | jq '.[].narrative // .[].text'
```

## Get Timeline Context

See what happened around a specific observation:

```bash
curl -s "$CLAUDE_MEM_URL/api/timeline?anchor=42&project=nanoclaw-mem"
```

## Tips

- Use broad search queries to find related memories (e.g., "coffee preferences" not just "flat white")
- Use timeline to understand the context around a specific observation
- **MEMORY.md** = things you need every session (rules, preferences, personal facts)
- **claude-mem save** = things you might need later (decisions, conclusions, user requests to remember)
- **Don't manually save** tool outputs — they're already auto-captured
SKILL_EOF
```

Then rebuild and restart:

```bash
npm run build
systemctl restart nanoclaw
```

## 11. Verify End-to-End

Tell the user:
> Setup is complete. Test it by sending a WhatsApp message like "remember that my favorite coffee is a flat white" and then in a new conversation ask "what's my favorite coffee?"

## Version Management

The wrapper scripts (`run-worker.sh` / `stop-worker.sh`) dynamically resolve the plugin version at runtime by picking the newest directory under `/root/.claude/plugins/cache/thedotmack/claude-mem/*/`. This means:

- **Plugin upgrades** (`claude plugin update @thedotmack/claude-mem`) don't break the service — no manual edits needed
- **After upgrading**, restart the worker to pick up the new version:
  ```bash
  systemctl stop claude-mem-worker
  # Kill any hook-spawned orphans from the old version
  pkill -f 'worker-service.cjs' 2>/dev/null; sleep 2
  systemctl start claude-mem-worker
  ```
- **Verify the running version** matches the installed version:
  ```bash
  curl -s http://127.0.0.1:37777/api/health | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])"
  ```

## Uninstall

1. Stop and disable the systemd services:
```bash
systemctl stop claude-mem-bridge claude-mem-worker
systemctl disable claude-mem-bridge claude-mem-worker
rm /etc/systemd/system/claude-mem-worker.service /etc/systemd/system/claude-mem-bridge.service
systemctl daemon-reload
```

2. Remove the plugin directory:
```bash
rm -rf plugins/claude-mem/
```

3. Remove from `.env`:
```bash
sed -i '/^CLAUDE_MEM_URL=/d' .env
```

4. Rebuild and restart:
```bash
npm run build
systemctl restart nanoclaw
```

5. Optionally remove the wrapper scripts and data:
```bash
rm -f /root/.claude-mem/run-worker.sh /root/.claude-mem/stop-worker.sh
# To also remove all memory data (irreversible):
# rm -rf /root/.claude-mem/
```

## Troubleshooting

- **Worker not starting:** `journalctl -u claude-mem-worker -f` and check `/root/.claude-mem/logs/`
- **Bridge not working:** Verify Docker bridge IP: `docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'`
- **Port conflict:** `lsof -i :37777` — kill orphaned workers first, then `systemctl start claude-mem-worker`
- **Orphaned processes:** Plugin hooks auto-spawn detached workers. After manual restarts, clean up with `pkill -f 'worker-service.cjs'` then restart via systemd
- **Services status:** `systemctl status claude-mem-worker claude-mem-bridge`
