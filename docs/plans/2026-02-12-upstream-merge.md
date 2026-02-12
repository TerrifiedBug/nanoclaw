# Upstream Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge all 5 upstream commits into our fork so we are 0 commits behind, while preserving every custom feature (Docker, webhooks, HA alerts, headless auth, claude-mem, etc.).

**Architecture:** Start from upstream's modular structure (Channel interface, extracted `ipc.ts`, `router.ts`, `types.ts`). Port our custom features into the upstream modules rather than re-monolithing. The upstream refactored `src/index.ts` (1088 → 516 lines) by extracting `WhatsAppChannel`, IPC, and router. Our fork's `index.ts` (1247 lines) has all those features inline. After the merge, our `index.ts` will be ~500-600 lines (slim orchestrator) with custom code living in the extracted modules.

**Tech Stack:** TypeScript, Docker, Baileys, vitest, Claude Agent SDK

**Key decisions:**
- Single WhatsApp connection (personal or business, user picks during setup — not both simultaneously)
- Docker only (no Apple Container runtime)
- Keep Telegram support from upstream
- Extend upstream modules with our code (not the other way around)

---

## Pre-flight

Before starting, verify:
```bash
git remote -v | grep upstream  # Must show qwibitai/nanoclaw
git fetch upstream
git stash                       # Save any uncommitted work
```

The 5 upstream commits to merge (chronological):
1. `2b56fec` — Refactor index (#156): Channel interface, ipc.ts, router.ts, types.ts, tests, Telegram
2. `8eb80d4` — Fix infinite message replay on container timeout (#164): grace period, timeout tests
3. `4647353` — Add /groups/ and /launchd/ to CODEOWNERS
4. `a354997` — Apple Container networking docs (#178)
5. `6863c0b` — WhatsApp connector tests (#182)

Our fork-only files to preserve:
- `src/webhook-server.ts` — webhook HTTP endpoint
- `src/wa-auth-server.ts` — headless WhatsApp QR auth
- `src/wa-auth-business.ts` — WhatsApp Business auth
- All `container/` customizations (Docker build, skills, agent-runner hooks)
- All `.claude/skills/` setup skills
- `groups/` memory files
- `.env`, `.mcp.json`, systemd configs

---

### Task 1: Create merge branch and run git merge

**Files:**
- All files in repo (merge operation)

**Step 1: Create the merge branch**

```bash
git checkout -b merge-upstream main
```

**Step 2: Run git merge**

```bash
git merge upstream/main --no-edit
```

Expected: Conflicts in 3 files:
- `src/index.ts` (major — our monolith vs upstream's slim version)
- `src/task-scheduler.ts` (minor — both added similar timeout logic)
- `package-lock.json` (auto-resolve later)

**Step 3: Identify all conflicts**

```bash
git diff --name-only --diff-filter=U
```

Record the exact conflict markers for each file.

**Step 4: Resolve package-lock.json**

Accept either side, we'll regenerate it:
```bash
git checkout --theirs package-lock.json
```

**Step 5: Resolve src/task-scheduler.ts**

The conflict is minor. Both versions added timeout handling. Our fork has additional features:
- `claimTask()` — prevents race conditions by setting `next_run = NULL`
- `assistantName` parameter support
- `context_mode` in scheduled tasks

Strategy: Start with upstream's version, then add our extras in Task 3.

```bash
git checkout --theirs src/task-scheduler.ts
```

**Step 6: Resolve src/index.ts**

This is the big one. Upstream refactored to ~516 lines by extracting modules. Our fork is ~1247 lines with everything inline.

Strategy: Accept upstream's slim `index.ts` as the base. Our custom features will be ported into the extracted modules (ipc.ts, router.ts, whatsapp.ts, types.ts) in subsequent tasks.

```bash
git checkout --theirs src/index.ts
```

**Step 7: Stage and commit the merge**

```bash
git add -A
git commit -m "merge upstream/main (5 commits: refactor, timeout fix, tests, docs)"
```

This commit will compile but NOT work yet — our custom features are missing. The subsequent tasks add them back.

**Step 8: Verify merge state**

```bash
git log --oneline HEAD..upstream/main  # Should show nothing (0 behind)
npm run build 2>&1 | head -20          # May have type errors — that's expected
```

---

### Task 2: Port Docker runtime to container-runner.ts

**Files:**
- Modify: `src/container-runner.ts`
- Reference: `src/container-runner.ts` (our fork's current version on `main`)

Our fork replaces Apple Container (`container` CLI) with Docker (`docker` CLI). The upstream container-runner uses `spawn('container', ...)`. We need to make it use `spawn('docker', ...)` with our Docker-specific logic.

**Step 1: Read both versions**

Read the upstream version (now on merge-upstream branch) and our fork's version (on main):

```bash
git show main:src/container-runner.ts > /tmp/fork-container-runner.ts
cat src/container-runner.ts > /tmp/upstream-container-runner.ts
```

**Step 2: Port Docker changes**

Key differences to port from our fork:
1. Replace `container` CLI with `docker` CLI in `spawn()` calls
2. Add `chown -R 1000:1000` on writable host mount paths before spawning (Docker bind mount permissions fix)
3. Replace `container stop` with `docker stop` in abort/cleanup
4. Add `docker rm` cleanup for stopped containers
5. Keep upstream's `hadStreamingOutput` timeout logic (equivalent to our `hadSuccessfulResponse`)
6. Add our `allowedVars` array with all env vars: `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_MEM_URL`, `N8N_URL`, `N8N_API_KEY`, `NANOCLAW_WEBHOOK_URL`, `NANOCLAW_WEBHOOK_SECRET`, `NATIONAL_RAIL_TOKEN`, `HA_URL`, `HA_TOKEN`, `BRAVE_API_KEY`, etc.
7. Port Docker volume mount syntax (`-v host:container`) vs Apple Container syntax

**Step 3: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

**Step 4: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat: port Docker runtime to container-runner"
```

---

### Task 3: Port task-scheduler improvements

**Files:**
- Modify: `src/task-scheduler.ts`
- Modify: `src/db.ts`
- Reference: `src/task-scheduler.ts` on `main` branch (our fork's version)

Our fork added several improvements to the task scheduler that upstream doesn't have.

**Step 1: Read both versions**

```bash
git show main:src/task-scheduler.ts > /tmp/fork-task-scheduler.ts
git show main:src/db.ts > /tmp/fork-db.ts
```

**Step 2: Port task-scheduler improvements**

Add to `src/task-scheduler.ts`:
1. `claimTask()` in db.ts — sets `next_run = NULL` when a task starts executing, preventing the scheduler from re-enqueueing it while the container is still running
2. `assistantName` parameter — pass the group's assistant name to the container
3. `context_mode` support for scheduled tasks
4. `hadSuccessfulResponse` / silent completion detection — don't report "sorry, couldn't complete" when agent used `send_message` and wrapped recap in `<internal>` tags

**Step 3: Port db.ts additions**

Add to `src/db.ts`:
1. `storeWebhookMessage()` function — stores messages with `sender: "webhook:{source}"` for the webhook server
2. `claimTask()` function
3. Keep upstream's `storeMessageDirect()` (used by non-Baileys channels)
4. Keep upstream's `createSchema()` extraction for testability
5. Database migration for `context_mode` column

**Step 4: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

**Step 5: Commit**

```bash
git add src/task-scheduler.ts src/db.ts
git commit -m "feat: port task scheduler improvements and db extensions"
```

---

### Task 4: Port webhook server and alert formatting

**Files:**
- Copy from main: `src/webhook-server.ts`
- Modify: `src/router.ts` (add alert formatting)
- Modify: `src/index.ts` (import and start webhook server)
- Modify: `src/types.ts` (if needed for webhook types)

**Step 1: Copy webhook-server.ts**

```bash
git show main:src/webhook-server.ts > src/webhook-server.ts
```

**Step 2: Add alert formatting to router.ts**

Upstream's `router.ts` has `formatMessages()`. Add our alert formatting logic:

```typescript
// In formatMessages():
if (m.sender.startsWith('webhook:')) {
  return `<alert source="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</alert>`;
}
```

**Step 3: Wire webhook server into index.ts**

Add import and startup call for the webhook server in `src/index.ts`. The webhook server needs access to `storeWebhookMessage` and `processGroupMessages`.

**Step 4: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

**Step 5: Commit**

```bash
git add src/webhook-server.ts src/router.ts src/index.ts
git commit -m "feat: port webhook server and alert formatting"
```

---

### Task 5: Port WhatsApp customizations to Channel

**Files:**
- Modify: `src/channels/whatsapp.ts`
- Modify: `src/index.ts`
- Copy from main: `src/wa-auth-server.ts`
- Copy from main: `src/wa-auth-business.ts`

**Step 1: Copy auth files**

```bash
git show main:src/wa-auth-server.ts > src/wa-auth-server.ts
git show main:src/wa-auth-business.ts > src/wa-auth-business.ts
```

**Step 2: Port WhatsApp channel customizations**

Add to `src/channels/whatsapp.ts`:
1. Read receipts sending (our fork sends read receipts on processed messages)
2. Any Baileys connection options we added (e.g., business-specific auth state)
3. Ensure `connect()` works with both personal and business auth state directories

**Step 3: Port index.ts WhatsApp setup**

Add to `src/index.ts`:
1. Docker container cleanup on startup (`docker ps`, `docker rm`)
2. Read receipts configuration
3. Business auth state path selection
4. Registered groups JSON loading (our fork uses `data/registered_groups.json`)

**Step 4: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

**Step 5: Commit**

```bash
git add src/channels/whatsapp.ts src/index.ts src/wa-auth-server.ts src/wa-auth-business.ts
git commit -m "feat: port WhatsApp customizations and headless auth"
```

---

### Task 6: Port IPC and routing customizations

**Files:**
- Modify: `src/ipc.ts`
- Modify: `src/router.ts`
- Modify: `src/types.ts`

**Step 1: Read upstream modules**

```bash
cat src/ipc.ts
cat src/router.ts
cat src/types.ts
```

**Step 2: Port IPC customizations**

Add to `src/ipc.ts`:
1. Webhook message handling (messages from webhook server go through same pipeline)
2. Available groups JSON sync (`/workspace/ipc/available_groups.json`)
3. Group refresh task handling (`refresh_groups` IPC task type)
4. Any custom IPC task types we added

**Step 3: Port routing customizations**

Add to `src/router.ts`:
1. Alert formatting (if not done in Task 4)
2. `escapeXml` utility (if upstream doesn't have it)
3. Our custom `formatMessages` with `<alert>` tag support

**Step 4: Port type extensions**

Add to `src/types.ts`:
1. Any custom types needed for webhook, Docker, or business auth

**Step 5: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

**Step 6: Commit**

```bash
git add src/ipc.ts src/router.ts src/types.ts
git commit -m "feat: port IPC and routing customizations"
```

---

### Task 7: Regenerate package-lock.json and verify dependencies

**Files:**
- Modify: `package.json`
- Regenerate: `package-lock.json`

**Step 1: Port package.json additions**

Our fork adds:
- `qrcode` + `@types/qrcode` — for headless QR code generation
- `auth-business` npm script

Upstream adds:
- `vitest` + `@vitest/coverage-v8` — test framework
- Test scripts (`test`, `test:watch`)

Both should be kept.

**Step 2: Merge package.json**

Read both versions and combine:
```bash
git show main:package.json > /tmp/fork-package.json
cat package.json > /tmp/upstream-package.json
```

Add our fork's dependencies to upstream's package.json. Keep upstream's test infrastructure.

**Step 3: Regenerate lock file**

```bash
rm package-lock.json
npm install
```

**Step 4: Verify build**

```bash
npm run build
```

**Step 5: Run upstream's tests**

```bash
npm test
```

Tests may need adaptation for Docker runtime. Fix any failures.

**Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: merge dependencies and regenerate lockfile"
```

---

### Task 8: Final integration test and cleanup

**Files:**
- All modified files
- `container/build.sh` — verify Docker build still works

**Step 1: Full build**

```bash
npm run build
```

Must complete with zero errors.

**Step 2: Run all tests**

```bash
npm test
```

Fix any test failures. Some upstream tests may reference Apple Container patterns — adapt for Docker.

**Step 3: Verify Docker container builds**

```bash
./container/build.sh
```

**Step 4: Verify all skills still exist**

```bash
ls container/skills/
ls .claude/skills/
```

**Step 5: Verify fork-only files are preserved**

```bash
git show merge-upstream:src/webhook-server.ts | head -5   # Must exist
git show merge-upstream:src/wa-auth-server.ts | head -5    # Must exist
git show merge-upstream:src/wa-auth-business.ts | head -5  # Must exist
git diff main..merge-upstream -- container/ | head -5       # No regressions
```

**Step 6: Check merge state**

```bash
git log --oneline HEAD..upstream/main    # Must be empty (0 behind)
git log --oneline upstream/main..HEAD    # Shows our custom commits + merge
```

**Step 7: Commit any final fixes**

```bash
git add -A
git commit -m "fix: integration cleanup after upstream merge"
```

Only if there are changes to commit.

---

## Post-Merge

After all tasks pass:

1. **Review on branch**: `git log --oneline merge-upstream | head -20`
2. **Merge to main**: `git checkout main && git merge merge-upstream`
3. **Rebuild and restart**: `npm run build && systemctl restart nanoclaw`
4. **Smoke test**: Send a WhatsApp message, verify TARS responds

## Rollback

If the merge goes badly:
```bash
git checkout main          # Go back to working state
git branch -D merge-upstream  # Delete failed branch
```

Main branch is never touched until the merge branch is verified.
