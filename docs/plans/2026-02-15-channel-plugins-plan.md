# Channel Plugin Architecture — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract WhatsApp from core into a plugin, make all channels equal, enable multi-channel support.

**Architecture:** Channel plugins register via `onChannel` hook, core routes messages via `routeOutbound()`. WhatsApp becomes the first (built-in) channel plugin. Claude-mem projects scoped per group folder.

**Tech Stack:** TypeScript (core), JavaScript (plugins), Baileys (WhatsApp), SQLite, Docker containers

**Branch:** `feature/channel-plugins` on tars repo (origin). Do NOT push to nanoclaw or upstream.

**Design doc:** `docs/plans/2026-02-15-channel-plugin-architecture-design.md`

---

### Task 1: Create Feature Branch

**Step 1: Create and checkout branch**

```bash
git checkout -b feature/channel-plugins
```

**Step 2: Commit the design doc**

```bash
git add docs/plans/2026-02-15-channel-plugin-architecture-design.md
git commit -m "docs: channel plugin architecture design"
```

---

### Task 2: Update Channel Interface & Plugin Types

**Files:**
- Modify: `src/types.ts:86-106`
- Modify: `src/plugin-types.ts:1-46`

**Step 1: Update Channel interface in types.ts**

Remove `setTyping` from the interface. Add `refreshMetadata` and `listAvailableGroups` as optional methods:

```typescript
// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  refreshMetadata?(): Promise<void>;
  listAvailableGroups?(): Promise<Array<{ jid: string; name: string }>>;
}
```

**Step 2: Add ChannelPluginConfig and update PluginManifest in plugin-types.ts**

Add `ChannelPluginConfig` type. Expand `PluginManifest` with `channelPlugin`, `authSkill`, `channels`, `groups` fields. Update `onChannel` signature:

```typescript
import type { Logger } from 'pino';
import type { Channel, NewMessage, OnInboundMessage, OnChatMetadata, RegisteredGroup } from './types.js';

/** Plugin manifest (plugin.json) */
export interface PluginManifest {
  name: string;
  description?: string;
  containerEnvVars?: string[];
  hooks?: string[];
  containerHooks?: string[];
  containerMounts?: Array<{ hostPath: string; containerPath: string }>;
  dependencies?: boolean;
  /** True if this plugin provides a channel (WhatsApp, Telegram, etc.) */
  channelPlugin?: boolean;
  /** Skill name for interactive auth setup (e.g. "setup-whatsapp") */
  authSkill?: string;
  /** Which channel types this plugin applies to. Default: ["*"] (all) */
  channels?: string[];
  /** Which group folders get this plugin's container injection. Default: ["*"] (all) */
  groups?: string[];
}

/** Message passed through onInboundMessage hooks */
export type InboundMessage = NewMessage;

/** Config passed to channel plugins so they can feed messages into core */
export interface ChannelPluginConfig {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

/** API surface available to plugins */
export interface PluginContext {
  insertMessage(chatJid: string, id: string, sender: string, senderName: string, text: string): void;
  sendMessage(jid: string, text: string): Promise<void>;
  getRegisteredGroups(): Record<string, RegisteredGroup>;
  getMainChannelJid(): string | null;
  logger: Logger;
}

/** Hook functions a plugin can export */
export interface PluginHooks {
  onStartup?(ctx: PluginContext): Promise<void>;
  onShutdown?(): Promise<void>;
  onInboundMessage?(msg: InboundMessage, channel: string): Promise<InboundMessage>;
  onChannel?(ctx: PluginContext, config: ChannelPluginConfig): Promise<Channel>;
}

/** A loaded plugin instance */
export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  hooks: PluginHooks;
}
```

**Step 3: Build to verify types compile**

```bash
npm run build
```

Expected: Success (no consumers use the new fields yet)

**Step 4: Commit**

```bash
git add src/types.ts src/plugin-types.ts
git commit -m "feat: expand Channel interface and plugin types for channel plugins"
```

---

### Task 3: Update Router — routeOutbound Returns Boolean

**Files:**
- Modify: `src/router.ts:28-43`
- Modify: `src/routing.test.ts` (update tests)

**Step 1: Update routeOutbound in router.ts**

Change `routeOutbound` to return `Promise<boolean>` instead of throwing, and add a logger import:

```typescript
import { logger } from './logger.js';
import { Channel, NewMessage } from './types.js';

// ... existing escapeXml, formatMessages, stripInternalTags, formatOutbound unchanged ...

export async function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<boolean> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) {
    logger.warn({ jid }, 'No connected channel for JID, message dropped');
    return false;
  }
  await channel.sendMessage(jid, text);
  return true;
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
```

**Step 2: Update routing.test.ts for new return type**

Update tests to expect boolean returns and test the "no channel" case logs instead of throwing.

**Step 3: Run tests**

```bash
npx vitest run src/routing.test.ts
```

**Step 4: Commit**

```bash
git add src/router.ts src/routing.test.ts
git commit -m "feat: routeOutbound returns boolean, logs warning instead of throwing"
```

---

### Task 4: Update Plugin Loader — Parse New Manifest Fields, Pass ChannelPluginConfig

**Files:**
- Modify: `src/plugin-loader.ts:21-47` (parseManifest)
- Modify: `src/plugin-loader.ts:130-172` (PluginRegistry)

**Step 1: Update parseManifest to handle new fields**

Add `channelPlugin`, `authSkill`, `channels`, `groups` to the parseManifest function:

```typescript
export function parseManifest(raw: Record<string, unknown>): PluginManifest {
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error('Plugin manifest must have a "name" field');
  }
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    containerEnvVars: Array.isArray(raw.containerEnvVars)
      ? raw.containerEnvVars.filter((v): v is string => typeof v === 'string')
      : [],
    hooks: Array.isArray(raw.hooks)
      ? raw.hooks.filter((v): v is string => typeof v === 'string')
      : [],
    containerHooks: Array.isArray(raw.containerHooks)
      ? raw.containerHooks.filter((v): v is string => typeof v === 'string')
      : [],
    containerMounts: Array.isArray(raw.containerMounts)
      ? raw.containerMounts.filter(
          (v): v is { hostPath: string; containerPath: string } =>
            typeof v === 'object' && v !== null &&
            typeof (v as any).hostPath === 'string' &&
            typeof (v as any).containerPath === 'string',
        )
      : [],
    dependencies: raw.dependencies === true,
    channelPlugin: raw.channelPlugin === true,
    authSkill: typeof raw.authSkill === 'string' ? raw.authSkill : undefined,
    channels: Array.isArray(raw.channels)
      ? raw.channels.filter((v): v is string => typeof v === 'string')
      : undefined,
    groups: Array.isArray(raw.groups)
      ? raw.groups.filter((v): v is string => typeof v === 'string')
      : undefined,
  };
}
```

**Step 2: Update PluginRegistry.startup to pass ChannelPluginConfig**

The `startup` method currently calls `onChannel(ctx)`. Change it to accept and pass `ChannelPluginConfig`. Also rename the channel initialization to a separate method since channels need to be initialized before `onStartup`:

```typescript
import type {
  ChannelPluginConfig,
  InboundMessage,
  LoadedPlugin,
  PluginContext,
  PluginHooks,
  PluginManifest,
} from './plugin-types.js';

// In PluginRegistry class:

  /** Get plugins that declare channelPlugin: true */
  getChannelPlugins(): LoadedPlugin[] {
    return this.plugins.filter(p => p.manifest.channelPlugin);
  }

  /** Initialize channel plugins — call before startup() */
  async initChannels(ctx: PluginContext, config: ChannelPluginConfig): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks.onChannel) {
        const channel = await plugin.hooks.onChannel(ctx, config);
        this._channels.push(channel);
        logger.info({ plugin: plugin.manifest.name, channel: channel.name }, 'Plugin channel registered');
      }
    }
  }

  /** Call onStartup on all plugins */
  async startup(ctx: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks.onStartup) {
        await plugin.hooks.onStartup(ctx);
        logger.info({ plugin: plugin.manifest.name }, 'Plugin started');
      }
    }
  }
```

**Step 3: Build to verify**

```bash
npm run build
```

**Step 4: Run existing plugin-loader tests**

```bash
npx vitest run src/plugin-loader.test.ts
```

**Step 5: Commit**

```bash
git add src/plugin-loader.ts
git commit -m "feat: plugin loader parses channel manifest fields, supports ChannelPluginConfig"
```

---

### Task 5: Add DB Migration — Channel Column on registered_groups

**Files:**
- Modify: `src/db.ts:78-107` (add migration block)

**Step 1: Add channel column migration**

Add after the existing `is_bot_message` migration block (~line 107):

```typescript
  // Add channel column to registered_groups (identifies which channel plugin owns this group)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN channel TEXT`,
    );
    // Backfill: all existing groups are WhatsApp
    database.exec(
      `UPDATE registered_groups SET channel = 'whatsapp' WHERE channel IS NULL`,
    );
  } catch {
    /* column already exists */
  }
```

**Step 2: Update setRegisteredGroup to include channel**

Find the `setRegisteredGroup` function and add the `channel` parameter:

```typescript
export function setRegisteredGroup(
  jid: string,
  group: RegisteredGroup,
  channel?: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    channel || null,
  );
}
```

**Step 3: Build and test**

```bash
npm run build && npx vitest run src/db.test.ts
```

**Step 4: Commit**

```bash
git add src/db.ts
git commit -m "feat: add channel column to registered_groups with WhatsApp backfill"
```

---

### Task 6: Add CHANNELS_DIR to Config

**Files:**
- Modify: `src/config.ts:30`

**Step 1: Add CHANNELS_DIR constant**

After `DATA_DIR`:

```typescript
export const CHANNELS_DIR = path.resolve(DATA_DIR, 'channels');
```

**Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat: add CHANNELS_DIR config constant"
```

---

### Task 7: Create WhatsApp Plugin Directory & Manifest

**Files:**
- Create: `plugins/whatsapp/plugin.json`

**Step 1: Create plugin manifest**

```json
{
  "name": "whatsapp",
  "description": "WhatsApp channel via Baileys",
  "hooks": ["onChannel"],
  "channelPlugin": true,
  "authSkill": "setup-whatsapp"
}
```

**Step 2: Commit**

```bash
git add plugins/whatsapp/plugin.json
git commit -m "feat: WhatsApp plugin manifest"
```

---

### Task 8: Extract WhatsApp Channel to Plugin

This is the largest task. Convert `src/channels/whatsapp.ts` (TypeScript) into `plugins/whatsapp/index.js` (JavaScript) that exports an `onChannel` hook.

**Files:**
- Create: `plugins/whatsapp/index.js` (converted from `src/channels/whatsapp.ts`)
- Delete: `src/channels/whatsapp.ts`
- Delete: `src/channels/whatsapp.test.ts` (move to plugin or rewrite)
- Delete: `src/channels/` directory

**Step 1: Create plugins/whatsapp/index.js**

Convert `WhatsAppChannel` from TypeScript to JavaScript. Wrap it in an `onChannel` export that receives `(ctx, config)` and returns a `Channel` object. Key changes:

- Import Baileys from top-level `node_modules` (stays in main `package.json`)
- Constructor takes `(config, logger)` instead of `WhatsAppChannelOpts`
- `onMessage` callback comes from `config.onMessage`
- `onChatMetadata` comes from `config.onChatMetadata`
- `registeredGroups` comes from `config.registeredGroups`
- `STORE_DIR`, `GROUPS_DIR`, `ASSISTANT_NAME`, `ASSISTANT_HAS_OWN_NUMBER` read from env/config imports
- `setTyping` stays as internal method (called inside message processing) but NOT on Channel interface
- `downloadMedia` stays internal (populates `mediaType`/`mediaPath`/`mediaHostPath` before calling `onMessage`)
- `syncGroupMetadata` becomes the `refreshMetadata()` method
- Auth state path changes from `store/auth/` to `data/channels/whatsapp/auth/`

The `onChannel` export:

```javascript
export async function onChannel(ctx, config) {
  const channel = new WhatsAppChannel(config, ctx.logger);
  return channel;
}
```

**Step 2: Move auth state directory**

Create migration logic: if `store/auth/` exists and `data/channels/whatsapp/auth/` doesn't, copy/symlink.

```bash
mkdir -p data/channels/whatsapp
# Symlink for backwards compat during testing
ln -s ../../../store/auth data/channels/whatsapp/auth
```

**Step 3: Move wa-auth-server.ts to plugin**

```bash
cp src/wa-auth-server.ts plugins/whatsapp/auth-server.js
```

Convert from TypeScript to JavaScript. Update paths to use `data/channels/whatsapp/auth/`.

**Step 4: Move whatsapp-auth.ts to plugin**

```bash
cp src/whatsapp-auth.ts plugins/whatsapp/auth-cli.js
```

Convert from TypeScript to JavaScript. Update paths.

**Step 5: Delete old source files**

```bash
rm src/channels/whatsapp.ts
rm src/channels/whatsapp.test.ts
rm src/wa-auth-server.ts
rm src/whatsapp-auth.ts
rmdir src/channels/
```

**Step 6: Build to verify core compiles without WhatsApp imports**

```bash
npm run build
```

Expected: FAIL — index.ts still imports WhatsApp. That's Task 9.

**Step 7: Commit the plugin extraction (without index.ts changes)**

```bash
git add plugins/whatsapp/ && git rm src/channels/whatsapp.ts src/channels/whatsapp.test.ts src/wa-auth-server.ts src/whatsapp-auth.ts
git commit -m "feat: extract WhatsApp channel to plugins/whatsapp/"
```

---

### Task 9: Refactor index.ts — Remove WhatsApp, Use Channel-Agnostic Routing

This is the critical integration task. Replace all direct WhatsApp references with channel-agnostic routing.

**Files:**
- Modify: `src/index.ts` (all 554 lines affected)

**Step 1: Remove WhatsApp import and variable**

Remove:
```typescript
import { WhatsAppChannel } from './channels/whatsapp.js';
// ...
let whatsapp: WhatsAppChannel;
```

Add:
```typescript
import { routeOutbound } from './router.js';
import type { Channel } from './types.js';
import type { ChannelPluginConfig } from './plugin-types.js';
// ...
let channels: Channel[] = [];
```

**Step 2: Refactor processGroupMessages — remove typing, use routeOutbound**

In `processGroupMessages()`:

- Remove the entire `pulseTyping` function and typing timer logic (lines 182-196)
- Replace `whatsapp.sendMessage(chatJid, text)` on line 214 with `routeOutbound(channels, chatJid, text)`
- Replace `whatsapp.setTyping(chatJid, false)` on line 223 — remove entirely
- Replace `whatsapp.sendMessage` on line 240 with `routeOutbound(channels, chatJid, ...)`
- Remove all `typingActive`, `typingTimer` variables and cleanup

**Step 3: Refactor startMessageLoop — remove typing**

In the message loop:
- Remove `whatsapp.setTyping(chatJid, true)` on line 432 — remove entirely

**Step 4: Refactor getAvailableGroups — delegate to channels**

Replace the hardcoded `@g.us` filter:

```typescript
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  // Only return chats that some channel claims ownership of
  return chats
    .filter((c) => c.jid !== '__group_sync__' && channels.some(ch => ch.ownsJid(c.jid)))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}
```

**Step 5: Refactor main() — channel initialization via plugins**

Replace the WhatsApp instantiation block (lines 488-536) with:

```typescript
  // Initialize channel plugins
  channels = [];
  for (const plugin of plugins.getChannelPlugins()) {
    const channelConfig: ChannelPluginConfig = {
      onMessage: async (chatJid, msg) => {
        const transformed = await plugins.runInboundHooks(msg, plugin.manifest.name);
        storeMessage(transformed);
      },
      onChatMetadata: (chatJid, timestamp, name) => storeChatMetadata(chatJid, timestamp, name),
      registeredGroups: () => registeredGroups,
    };
    // pluginCtx needs to be created first (see below)
    const channel = await plugin.hooks.onChannel!(pluginCtx, channelConfig);
    channels.push(channel);
    await channel.connect();
  }
```

Note: There's a circular dependency between `pluginCtx` (needs `routeOutbound(channels, ...)`) and channel initialization (needs `pluginCtx`). Solve by creating `pluginCtx` first with a closure that captures `channels` by reference:

```typescript
  const pluginCtx: PluginContext = {
    insertMessage: insertExternalMessage,
    sendMessage: (jid, text) => routeOutbound(channels, jid, text).then(() => {}),
    getRegisteredGroups: () => registeredGroups,
    getMainChannelJid: () => {
      const mainEntry = Object.entries(registeredGroups).find(
        ([, g]) => g.folder === MAIN_GROUP_FOLDER,
      );
      return mainEntry ? mainEntry[0] : null;
    },
    logger,
  };

  // Now initialize channels
  await plugins.initChannels(pluginCtx, /* see loop above */);
  // Then start non-channel plugins
  await plugins.startup(pluginCtx);
```

**Step 6: Refactor shutdown**

Replace `await whatsapp.disconnect()` with:

```typescript
  for (const ch of channels) {
    await ch.disconnect();
  }
```

**Step 7: Refactor scheduler and IPC callbacks**

Replace scheduler `sendMessage` callback:
```typescript
  sendMessage: async (jid, rawText) => {
    const text = formatOutbound(rawText);
    if (text) await routeOutbound(channels, jid, text);
  },
```

Replace IPC `sendMessage` callback:
```typescript
  sendMessage: (jid, text) => routeOutbound(channels, jid, text).then(() => {}),
```

Replace IPC `syncGroupMetadata`:
```typescript
  syncGroupMetadata: async (force) => {
    for (const ch of channels) {
      if (ch.refreshMetadata) await ch.refreshMetadata(force);
    }
  },
```

Note: `refreshMetadata` signature may need to accept a `force` boolean — update the Channel interface if needed, or have the WhatsApp plugin always refresh when called.

**Step 8: Startup health check**

Add after channel initialization:

```typescript
  // Warn about registered groups with no channel
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (!channels.some(ch => ch.ownsJid(jid))) {
      logger.warn({ jid, group: group.name }, 'Registered group has no connected channel');
    }
  }
```

**Step 9: Build**

```bash
npm run build
```

Expected: Success

**Step 10: Commit**

```bash
git add src/index.ts
git commit -m "feat: index.ts fully channel-agnostic, routes via routeOutbound"
```

---

### Task 10: Update package.json — Remove auth Script

**Files:**
- Modify: `package.json`

**Step 1: Remove the `auth` script**

The `"auth": "tsx src/whatsapp-auth.ts"` script no longer exists. Remove it. The WhatsApp plugin provides its own auth mechanism.

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: remove whatsapp-auth script from package.json (moved to plugin)"
```

---

### Task 11: Update Claude-Mem — Dynamic Project Naming

**Files:**
- Modify: `plugins/claude-mem/hooks/post-tool-use.js:8`
- Modify: `container/skills/memory/SKILL.md`

**Step 1: Update post-tool-use.js**

The hook receives `ctx` with `session_id` but needs `groupFolder`. Check what context is available in SDK hooks. The group folder is available via the container's environment or working directory.

If `ctx` doesn't have `groupFolder` directly, the container runner already sets `GROUP_FOLDER` as an env var (verify in container-runner.ts). The hook can read it from `process.env.GROUP_FOLDER`:

```javascript
const PROJECT = `nanoclaw-${process.env.GROUP_FOLDER || 'main'}`;
```

Replace the hardcoded `const PROJECT = 'nanoclaw-mem';` on line 8.

**Step 2: Update SKILL.md**

Update instructions to tell agents to use `project=nanoclaw-{groupFolder}` instead of `project=nanoclaw-mem`.

**Step 3: Commit**

```bash
git add plugins/claude-mem/hooks/post-tool-use.js container/skills/memory/SKILL.md
git commit -m "feat: claude-mem uses per-group project naming (nanoclaw-{folder})"
```

---

### Task 12: Integration Test — Run NanoClaw With WhatsApp Plugin

**Step 1: Create data/channels/whatsapp/ directory and symlink auth state**

```bash
mkdir -p data/channels/whatsapp
ln -s ../../../store/auth data/channels/whatsapp/auth
```

**Step 2: Build and start**

```bash
npm run build && npm run dev
```

**Step 3: Verify in logs**

Expected log output:
- `Plugin loaded` with `plugin: "whatsapp"`
- `Plugin channel registered` with `channel: "whatsapp"`
- WhatsApp connects and receives messages
- Agent responses route through `routeOutbound`
- No `whatsapp.setTyping` calls in logs
- Scheduled tasks fire and send via router

**Step 4: Test sending a message**

Send a test message to the main WhatsApp group. Verify the agent receives it, processes it, and responds through the channel plugin.

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: integration fixes for WhatsApp channel plugin"
```

---

### Task 13: Update Plugin Loader — Plugin Scoping (channels/groups filtering)

**Files:**
- Modify: `src/plugin-loader.ts` (collectContainerEnvVars, collectSkillPaths, etc.)
- Modify: `src/container-runner.ts` (pass group's channel name when requesting plugin data)

**Step 1: Add scope-filtering helpers to PluginRegistry**

Add methods that filter plugins by channel and group:

```typescript
  /** Get plugins applicable to a specific group on a specific channel */
  getPluginsForGroup(channelName: string, groupFolder: string): LoadedPlugin[] {
    return this.plugins.filter(p => {
      const channelMatch = !p.manifest.channels || p.manifest.channels.includes('*') || p.manifest.channels.includes(channelName);
      const groupMatch = !p.manifest.groups || p.manifest.groups.includes('*') || p.manifest.groups.includes(groupFolder);
      return channelMatch && groupMatch;
    });
  }

  /** Get container env vars for a specific group */
  getContainerEnvVarsForGroup(channelName: string, groupFolder: string): string[] {
    const vars = new Set(CORE_ENV_VARS);
    for (const plugin of this.getPluginsForGroup(channelName, groupFolder)) {
      for (const v of plugin.manifest.containerEnvVars || []) {
        vars.add(v);
      }
    }
    return [...vars];
  }
```

Add similar scoped versions of `getSkillPaths`, `getContainerHookPaths`, `getContainerMounts`, `getMergedMcpConfig`.

**Step 2: Update container-runner.ts to use scoped plugin data**

Where `container-runner.ts` calls `pluginRegistry.getContainerEnvVars()`, pass the group's channel and folder to use the scoped version. This requires knowing which channel a group belongs to — look it up from `registered_groups.channel` column or from `findChannel(channels, jid)`.

**Step 3: Build and test**

```bash
npm run build && npx vitest run
```

**Step 4: Commit**

```bash
git add src/plugin-loader.ts src/container-runner.ts
git commit -m "feat: plugin scoping by channel and group folder"
```

---

### Task 14: Update Skills & Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/setup/SKILL.md`
- Modify: `.claude/skills/customize/SKILL.md`
- Modify: `docs/DIVERGENCES.md`

**Step 1: Update CLAUDE.md key files table**

Remove `src/channels/whatsapp.ts` entry. Add `plugins/whatsapp/index.js`. Update description to reflect channel-agnostic architecture.

**Step 2: Update setup skill**

Rewrite the channel setup section to dynamically discover channel plugins from `plugins/*/plugin.json` where `channelPlugin: true`. Present available channels. Invoke the selected channel's `authSkill`.

**Step 3: Update customize skill**

Replace references to `src/channels/whatsapp.ts` with the plugin pattern. Update the "add a channel" section to describe creating a channel plugin.

**Step 4: Update DIVERGENCES.md**

Add the channel plugin extraction as a divergence. Remove `src/channels/whatsapp.ts` entries (file no longer exists in this form).

**Step 5: Commit**

```bash
git add CLAUDE.md .claude/skills/setup/SKILL.md .claude/skills/customize/SKILL.md docs/DIVERGENCES.md
git commit -m "docs: update skills and docs for channel plugin architecture"
```

---

### Task 15: Claude-Mem Migration Script

**Step 1: Create a one-time migration script**

Create `scripts/migrate-claude-mem-project.sh`:

```bash
#!/bin/bash
# One-time migration: rename nanoclaw-mem → nanoclaw-main in claude-mem DB
# Run ONCE after deploying channel plugin architecture

CLAUDE_MEM_DB="/root/.claude-mem/claude-mem.db"

if [ ! -f "$CLAUDE_MEM_DB" ]; then
  echo "Claude-mem DB not found at $CLAUDE_MEM_DB"
  exit 1
fi

echo "Migrating claude-mem project: nanoclaw-mem → nanoclaw-main"
sqlite3 "$CLAUDE_MEM_DB" "UPDATE observations SET project = 'nanoclaw-main' WHERE project = 'nanoclaw-mem';"
echo "Done. $(sqlite3 "$CLAUDE_MEM_DB" "SELECT count(*) FROM observations WHERE project = 'nanoclaw-main';") observations now in nanoclaw-main"
```

Note: ChromaDB metadata also needs updating. The claude-mem worker stores project in ChromaDB metadata. This may require a Python script or API call to update. Document this as a manual step.

**Step 2: Commit**

```bash
chmod +x scripts/migrate-claude-mem-project.sh
git add scripts/migrate-claude-mem-project.sh
git commit -m "feat: claude-mem project migration script (nanoclaw-mem → nanoclaw-main)"
```

---

### Task 16: Update Test Files

**Files:**
- Modify: `src/formatting.test.ts`
- Modify: `src/routing.test.ts`

**Step 1: Update formatting.test.ts**

Replace WhatsApp JID examples with generic ones where appropriate. Keep `@g.us` JIDs for WhatsApp-specific tests but add multi-channel JID examples.

**Step 2: Update routing.test.ts**

Add tests for multi-channel routing:
- WhatsApp channel owns `@g.us` JIDs
- Fake channel owns `test:*` JIDs
- `routeOutbound` routes to correct channel
- `routeOutbound` returns false when no channel matches
- `findChannel` returns undefined when no match

**Step 3: Run all tests**

```bash
npx vitest run
```

**Step 4: Commit**

```bash
git add src/formatting.test.ts src/routing.test.ts
git commit -m "test: multi-channel routing tests"
```

---

### Task 17: Push Feature Branch

**Step 1: Push to origin (tars) only**

```bash
git push -u origin feature/channel-plugins
```

Do NOT push to nanoclaw or upstream. This is a tars-only feature branch.

---

### Task 18: Manual Testing Checklist

Before merging to main, verify:

- [ ] `npm run build` succeeds
- [ ] `npx vitest run` all tests pass
- [ ] NanoClaw starts and connects to WhatsApp via plugin
- [ ] Sending a message to main group triggers agent and gets response
- [ ] Scheduled tasks fire and send responses
- [ ] IPC commands work (register_group, refresh_groups)
- [ ] Error handling works (disconnect WhatsApp, verify reconnection)
- [ ] Service restart works (systemctl restart nanoclaw)
- [ ] Voice transcription still works (if enabled)
- [ ] Claude-mem observations saved with `nanoclaw-main` project
- [ ] Run migration script for claude-mem
- [ ] Logs show no `whatsapp.setTyping` or direct WhatsApp references

---

## Migration Steps (Production Cutover)

When ready to switch from main to the feature branch:

1. **Stop nanoclaw service**: `systemctl stop nanoclaw`
2. **Backup**: `cp -r store/ store-backup/ && cp -r data/ data-backup/`
3. **Switch branch**: `git checkout feature/channel-plugins`
4. **Build**: `npm run build`
5. **Create channels dir**: `mkdir -p data/channels/whatsapp && ln -s ../../../store/auth data/channels/whatsapp/auth`
6. **Run claude-mem migration**: `./scripts/migrate-claude-mem-project.sh`
7. **Start service**: `systemctl start nanoclaw`
8. **Verify**: Check logs, send test message
9. **If broken**: `git checkout main && npm run build && systemctl start nanoclaw` (instant rollback)
