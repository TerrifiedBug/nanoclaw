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

**Search:** Container agents use the `claude-mem` container skill (`container/skills/claude-mem/SKILL.md`) to search past observations via `GET /api/search?query=...&project=nanoclaw-mem`.

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

## 10. Update Container Runner

Add `'CLAUDE_MEM_URL'` to the `allowedVars` array in `src/container-runner.ts` (around line 185). This is a one-line edit — just append it to the existing array.

Then rebuild and restart:

```bash
npm run build
systemctl restart nanoclaw
```

## 11. Verify End-to-End

Tell the user:
> Setup is complete. Test it by sending a WhatsApp message like "remember that my favorite coffee is a flat white" and then in a new conversation ask "what's my favorite coffee?"

## Troubleshooting

- **Worker not starting:** `journalctl -u claude-mem-worker -f` and check `/root/.claude-mem/logs/`
- **Bridge not working:** Verify Docker bridge IP: `docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'`
- **Port conflict:** `lsof -i :37777` — kill orphaned workers first
- **Plugin upgraded:** No action needed — wrapper scripts auto-resolve the latest version
- **Services status:** `systemctl status claude-mem-worker claude-mem-bridge`
