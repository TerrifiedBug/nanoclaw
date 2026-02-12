# Community Fork Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adopt 5 security fixes, bug fixes, and features identified from community forks into our NanoClaw branch.

**Architecture:** Each feature is independent — they can be implemented in any order. All changes stay within existing module boundaries (no new modules except a small utility). Tests use vitest (existing test infrastructure).

**Tech Stack:** TypeScript, Claude Agent SDK (hooks), Baileys (WhatsApp), Docker, vitest

**Sources:**
- #1 Env sanitization: colevscode/microclaw
- #3 Message dedup: Poseima/dawnclaw
- #4 Env value quoting: Buzcpg/nanobuz
- #6 Heartbeat typing: bsakel/nanoclaw
- #7 Media download: Poseima/dawnclaw

---

### Task 1: PreToolUse env var sanitization

**Files:**
- Modify: `container/agent-runner/src/index.ts`

**Step 1: Add PreToolUse hook that unsets sensitive env vars before Bash commands**

In `container/agent-runner/src/index.ts`, add a `createPreToolUseHook()` function alongside the existing `createPostToolUseHook()` and `createPreCompactHook()`:

```typescript
import { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';

const SENSITIVE_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

function createPreToolUseHook(): HookCallback {
  return async (input) => {
    const h = input as PreToolUseHookInput;
    if (h.tool_name === 'Bash' && typeof h.tool_input === 'object' && h.tool_input !== null) {
      const bashInput = h.tool_input as { command?: string };
      if (bashInput.command) {
        const unsetPrefix = SENSITIVE_VARS.map(v => `unset ${v}`).join('; ');
        bashInput.command = `${unsetPrefix}; ${bashInput.command}`;
      }
    }
    return {};
  };
}
```

**Step 2: Wire the hook into the query options**

In the `hooks` object inside `runQuery()`, add the PreToolUse hook:

```typescript
hooks: {
  PreToolUse: [{ hooks: [createPreToolUseHook()] }],
  PreCompact: [{ hooks: [createPreCompactHook()] }],
  ...(CLAUDE_MEM_URL ? {
    PostToolUse: [{ hooks: [createPostToolUseHook(containerInput.groupFolder)] }],
  } : {}),
},
```

**Step 3: Rebuild container and verify**

```bash
npm run build
./container/build.sh
```

**Step 4: Test manually**

Send a WhatsApp message asking the agent to run `echo $ANTHROPIC_API_KEY` — it should return empty.

**Step 5: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "security: add PreToolUse hook to unset sensitive env vars before Bash commands"
```

---

### Task 2: Env value quoting in container env file

**Files:**
- Modify: `src/container-runner.ts`

**Step 1: Add env value quoting when writing the env file**

In `buildVolumeMounts()`, after filtering env lines and before writing to the file, quote each value:

```typescript
// Quote env values to prevent shell injection (# truncation, $() execution, etc.)
const quotedLines = filteredLines.map((line) => {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) return line;
  const key = line.slice(0, eqIdx);
  const value = line.slice(eqIdx + 1);
  // Single-quote the value, escaping embedded single quotes
  const escaped = value.replace(/'/g, "'\\''");
  return `${key}='${escaped}'`;
});
```

Then write `quotedLines` instead of `filteredLines` to the env file.

**Step 2: Verify the env file format**

```bash
npm run build
# Check that the env file is properly quoted:
cat data/env/env
```

**Step 3: Test that containers still read env vars correctly**

Docker's `--env-file` and shell sourcing both handle single-quoted values. Verify by running a container manually.

**Step 4: Commit**

```bash
git add src/container-runner.ts
git commit -m "security: quote env values in container env file to prevent shell injection"
```

---

### Task 3: Message deduplication fix

**Files:**
- Modify: `src/db.ts`
- Modify: `src/index.ts`
- Modify: `src/__tests__/formatting.test.ts` (or create new test file)

**Step 1: Write failing test for same-second message dedup**

Add a test that stores two messages with the same timestamp and verifies both are returned by `getNewMessages` across two polls.

**Step 2: Change `getNewMessages` to use `>=` comparison**

In `src/db.ts`, change the SQL in `getNewMessages()`:

```sql
-- Before:
WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
-- After:
WHERE timestamp >= ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
```

**Step 3: Add processedIds tracking in `src/index.ts`**

Add a module-level `Set<string>` to track processed message IDs:

```typescript
const processedIds = new Set<string>();
let processedIdsTimestamp = '';
```

In `startMessageLoop()`, after getting messages from `getNewMessages()`:

```typescript
// Filter out already-processed messages (dedup for same-second timestamps)
const freshMessages = messages.filter((m) => !processedIds.has(m.id));
if (freshMessages.length === 0) continue;

// Track new IDs; clear set when timestamp advances
if (newTimestamp > processedIdsTimestamp) {
  processedIds.clear();
  processedIdsTimestamp = newTimestamp;
}
for (const m of freshMessages) {
  processedIds.add(m.id);
}
```

Use `freshMessages` instead of `messages` for the rest of the loop body.

**Step 4: Apply same fix to `getMessagesSince`**

Change `timestamp > ?` to `timestamp >= ?` in `getMessagesSince()`. The callers (`processGroupMessages` and `recoverPendingMessages`) use `lastAgentTimestamp` which has the same dedup issue.

For `processGroupMessages`, add processedIds tracking per-group:

```typescript
const agentProcessedIds = new Map<string, Set<string>>();
```

Filter out already-processed IDs when calling `getMessagesSince`, and update the set after processing.

**Step 5: Run tests**

```bash
npm test
```

**Step 6: Commit**

```bash
git add src/db.ts src/index.ts src/__tests__/formatting.test.ts
git commit -m "fix: prevent message loss when multiple messages share same-second timestamp"
```

---

### Task 4: Heartbeat-based typing indicator

**Files:**
- Modify: `src/index.ts`

**Step 1: Replace always-on typing with heartbeat in processGroupMessages**

Remove the `setTyping(true)` at the start. Instead, add a typing heartbeat that activates on output:

```typescript
// Heartbeat typing: only show "typing" when agent is producing output
let typingActive = false;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
const TYPING_PAUSE_MS = 5000;

const pulseTyping = async () => {
  if (!typingActive) {
    typingActive = true;
    await whatsapp.setTyping(chatJid, true);
  }
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(async () => {
    typingActive = false;
    await whatsapp.setTyping(chatJid, false);
  }, TYPING_PAUSE_MS);
};
```

In the `onOutput` callback, call `pulseTyping()` alongside the idle timer reset:

```typescript
if (text) {
  await pulseTyping();
  await whatsapp.sendMessage(chatJid, `${ASSISTANT_NAME}: ${text}`);
  outputSentToUser = true;
}
resetIdleTimer();
```

At the end (after `runAgent` returns), ensure typing is stopped:

```typescript
if (typingTimer) clearTimeout(typingTimer);
if (typingActive) await whatsapp.setTyping(chatJid, false);
```

**Step 2: Build and verify**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: heartbeat typing indicator - only shows typing during active output"
```

---

### Task 5: WhatsApp media download

**Files:**
- Modify: `src/channels/whatsapp.ts`

**Step 1: Add media download utility**

Import `downloadMediaMessage` from Baileys and add a helper function:

```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

async function downloadMedia(
  msg: WAMessageProto,
  groupFolder: string,
  groupsDir: string,
): Promise<{ path: string; type: string; mimeType: string } | null> {
  const mediaTypes = [
    { key: 'imageMessage', type: 'image', ext: 'jpg' },
    { key: 'videoMessage', type: 'video', ext: 'mp4' },
    { key: 'documentMessage', type: 'document', ext: '' },
    { key: 'audioMessage', type: 'audio', ext: 'ogg' },
  ];

  for (const mt of mediaTypes) {
    const mediaMsg = msg.message?.[mt.key];
    if (!mediaMsg) continue;

    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const ext = mt.ext || mediaMsg.fileName?.split('.').pop() || 'bin';
      const filename = `${msg.key.id}.${ext}`;
      const mediaDir = path.join(groupsDir, groupFolder, 'media');
      fs.mkdirSync(mediaDir, { recursive: true });
      const filePath = path.join(mediaDir, filename);
      fs.writeFileSync(filePath, buffer);
      return {
        path: `/workspace/group/media/${filename}`,
        type: mt.type,
        mimeType: mediaMsg.mimetype || `${mt.type}/${ext}`,
      };
    } catch (err) {
      logger.warn({ err, msgId: msg.key.id }, `Failed to download ${mt.type}`);
    }
  }
  return null;
}
```

**Step 2: Integrate into messages.upsert handler**

In the `messages.upsert` handler, after extracting text content, check for media:

```typescript
// Download media if present
let mediaRef = '';
const hasMedia = msg.message?.imageMessage || msg.message?.videoMessage ||
  msg.message?.documentMessage || msg.message?.audioMessage;
if (hasMedia && groups[chatJid]) {
  const media = await downloadMedia(msg, groups[chatJid].folder, GROUPS_DIR);
  if (media) {
    mediaRef = `\n[${media.type}: ${media.path}]`;
  }
}

const fullContent = content + mediaRef;
```

Use `fullContent` instead of `content` in the `onMessage` call.

**Step 3: Pass GROUPS_DIR to WhatsApp channel**

The channel needs to know where to save media. Add `groupsDir` to `WhatsAppChannelOpts`:

```typescript
export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  groupsDir: string;
}
```

Update `index.ts` to pass `GROUPS_DIR` when constructing the channel.

**Step 4: Build and verify**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/channels/whatsapp.ts src/index.ts
git commit -m "feat: download WhatsApp media (images, videos, documents, audio) to group folder"
```

---

## Implementation Order

Recommended order (security first, then bugs, then features):
1. Task 1: PreToolUse env sanitization (security)
2. Task 2: Env value quoting (security)
3. Task 3: Message deduplication (bug fix)
4. Task 4: Heartbeat typing (feature)
5. Task 5: Media download (feature)

Tasks 1-2 can be done in parallel. Tasks 3-5 are independent of each other and of 1-2.
