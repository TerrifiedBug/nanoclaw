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

Detect the installed plugin path dynamically (handles version upgrades):

```bash
WORKER_SCRIPT=$(ls /root/.claude/plugins/cache/thedotmack/claude-mem/*/scripts/worker-service.cjs 2>/dev/null | head -1)
echo "Worker script: $WORKER_SCRIPT"
```

If `WORKER_SCRIPT` is empty, **stop and tell the user** the plugin files are missing.

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

## 4. Create systemd Service for Claude-Mem Worker

Use the dynamically detected `WORKER_SCRIPT` path from step 1. Write the service file:

```bash
WORKER_SCRIPT=$(ls /root/.claude/plugins/cache/thedotmack/claude-mem/*/scripts/worker-service.cjs 2>/dev/null | head -1)
BUN_PATH=$(which bun 2>/dev/null || echo "/root/.bun/bin/bun")

cat > /etc/systemd/system/claude-mem-worker.service << EOF
[Unit]
Description=Claude-Mem Worker Daemon
After=network.target

[Service]
Type=simple
ExecStart=${BUN_PATH} ${WORKER_SCRIPT} --daemon
WorkingDirectory=/root/.claude-mem
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=PATH=/root/.bun/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF
```

## 5. Create systemd Service for socat Bridge

The bridge binds ONLY to the Docker bridge gateway IP (172.17.0.1), not 0.0.0.0. This means the API is only reachable from Docker containers, not from the broader network.

```bash
cat > /etc/systemd/system/claude-mem-bridge.service << EOF
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

## 6. Enable and Start Services

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

## 7. Test Connectivity from a Container

```bash
docker run --rm --entrypoint node nanoclaw-agent:latest \
  -e "fetch('http://172.17.0.1:37777/api/health').then(r=>r.json()).then(d=>console.log('OK:',JSON.stringify(d))).catch(e=>console.error('FAIL:',e.message))"
```

If this prints `OK: {"status":"ok",...}` then connectivity is working.

## 8. Add Environment Variable

Add `CLAUDE_MEM_URL` to the project `.env` file:

```bash
grep -q "^CLAUDE_MEM_URL=" .env 2>/dev/null || echo "CLAUDE_MEM_URL=http://172.17.0.1:37777" >> .env
```

## 9. Update Container Runner

Add `'CLAUDE_MEM_URL'` to the `allowedVars` array in `src/container-runner.ts` (around line 185). This is a one-line edit — just append it to the existing array.

Then rebuild and restart:

```bash
npm run build
systemctl restart nanoclaw
```

## 10. Verify End-to-End

Tell the user:
> Setup is complete. Test it by sending a WhatsApp message like "remember that my favorite coffee is a flat white" and then in a new conversation ask "what's my favorite coffee?"

## Troubleshooting

- **Worker not starting:** `journalctl -u claude-mem-worker -f`
- **Bridge not working:** Verify Docker bridge IP: `docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'`
- **Port conflict:** `lsof -i :37777`
- **Plugin upgraded (version changed):** Stop worker, re-run this skill to regenerate the systemd service with the new path
- **Services status:** `systemctl status claude-mem-worker claude-mem-bridge`
