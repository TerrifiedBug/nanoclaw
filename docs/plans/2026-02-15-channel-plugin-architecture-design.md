# Channel Plugin Architecture Design

**Date**: 2026-02-15
**Status**: Draft
**Approach**: Big Bang — extract WhatsApp, refactor core, all at once

## Problem

WhatsApp is hardcoded as the only channel in NanoClaw. Adding Discord, Telegram, or any other messaging platform requires modifying core source code (`index.ts`, `router.ts`, etc.). The plugin system has an `onChannel` hook but it's incomplete — outbound messages are hardcoded to WhatsApp, and plugin channels can't fully participate in the message loop.

## Goals

- All channels are plugins — including WhatsApp
- Multiple channels can run simultaneously
- Each group maps to exactly one channel (no bridging)
- Groups can be moved between channels without losing memory
- `/setup` dynamically discovers available channel plugins
- Claude-mem projects are scoped per group, not global
- Adding a new channel should never require modifying source code

## Key Concepts

- **Channel** = a messaging platform (WhatsApp, Telegram, Discord). Handles connection, auth, sending/receiving, media. A channel plugin.
- **Group** = a conversation context. Has a folder (`groups/family/`), CLAUDE.md, claude-mem project, agent sessions, IPC namespace. The agent's home.
- Each group belongs to exactly one channel. Multiple groups can be on the same channel. Multiple channels run simultaneously.
- The **folder** is the group's identity — if you move a group between channels, the folder, memory, and claude-mem project all stay.

```
Channel: WhatsApp
  └── Group: "main"     (folder: main,   jid: 120363...@g.us)
  └── Group: "family"   (folder: family, jid: 987654...@g.us)

Channel: Telegram
  └── Group: "dev-team" (folder: dev-team, jid: telegram:-100123...)

Channel: Discord
  └── Group: "gaming"   (folder: gaming, jid: discord:guild1:chan1)
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel architecture | All channels as plugins, WhatsApp not special | Clean architecture, no special cases, no source changes for new channels |
| Group-to-channel mapping | One group = one channel, always | Avoids bridging complexity, message context stays coherent |
| Claude-mem project naming | `nanoclaw-{groupFolder}` | Channel-agnostic, survives group moves |
| Existing memory migration | Rename `nanoclaw-mem` → `nanoclaw-main` | Clean cut, main is the only active group |
| Cross-group memory access | Instruction-based isolation now, proxy enforcement later | Agents follow CLAUDE.md, no enumeration API exists |
| Auth flow | Skill-based, not hook-based | Auth is interactive/human-guided, skills are designed for this |
| Channel data storage | `data/channels/{name}/` | Persistent data separate from plugin code |
| Typing indicators | Channel-internal, not in core | Platform-specific UX detail |
| DB schema | Add optional `channel` column to `registered_groups` | Debugging/querying convenience, not authoritative for routing |
| Plugin scoping | `channels` and `groups` fields in plugin manifest | Plugins declare their own scope, defaults to all |
| WhatsApp npm dependencies | Stay in main `package.json` (built-in plugin) | Zero-config first experience, `npm install` just works |
| Third-party plugin deps | Own `package.json`, installed by `add-*` skill | Same pattern as `add-cal` and transcription today |

## Channel Interface

Minimal contract — all platform-specific behavior stays inside the plugin:

```typescript
interface Channel {
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

Removed from interface (handled internally by each channel):
- `setTyping()` — platform-specific UX
- `downloadMedia()` — channels populate `mediaType`/`mediaPath`/`mediaHostPath` on `NewMessage` before calling `onMessage`
- `syncGroupMetadata()` — channels feed updates through `onChatMetadata` callback

## Channel Plugin Hook

```typescript
interface ChannelPluginConfig {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface PluginHooks {
  onChannel?(ctx: PluginContext, config: ChannelPluginConfig): Promise<Channel>;
  // ... existing hooks unchanged
}
```

The key change: `onChannel` receives the same callbacks that WhatsApp currently gets in its constructor. This lets the channel plugin feed messages into the core message loop identically to how WhatsApp does today.

## Plugin Manifest

```json
{
  "name": "whatsapp",
  "description": "WhatsApp channel via Baileys",
  "hooks": ["onChannel"],
  "channelPlugin": true,
  "authSkill": "setup-whatsapp"
}
```

Fields:
- `channelPlugin: true` — identifies this as a channel plugin for `/setup` discovery
- `authSkill` — name of the skill that handles interactive authentication

## Plugin Scoping

Plugins can declare which channels and groups they apply to:

```json
{
  "name": "homeassistant",
  "groups": ["main"],
  "containerEnvVars": ["HASS_URL", "HASS_TOKEN"]
}
```

```json
{
  "name": "transcription",
  "channels": ["whatsapp"],
  "hooks": ["onInboundMessage"]
}
```

- `channels` — which channel types this plugin applies to. Defaults to `["*"]` (all). Plugin loader filters by the group's channel when assembling container mounts and running hooks.
- `groups` — which group folders get this plugin's container injection (env vars, skills, MCP configs). Defaults to `["*"]` (all). Example: `["main"]` for security-sensitive plugins.

This prevents non-main groups from accessing APIs they shouldn't have (Home Assistant, GitHub) and avoids mounting irrelevant skills into groups on the wrong channel.

## JID Namespacing

Each channel owns a non-overlapping JID namespace:

| Channel | JID Format | Example |
|---------|-----------|---------|
| WhatsApp | `*@g.us`, `*@s.whatsapp.net` | `120363336345536173@g.us` |
| Telegram | `telegram:*` | `telegram:-1001234567890` |
| Discord | `discord:*` | `discord:guild123:chan456` |

`Channel.ownsJid(jid)` is the dispatcher — the router calls it to determine which channel handles a given JID.

## Core Routing Changes (`index.ts`)

### Outbound Message Dispatch

All direct `whatsapp.sendMessage()` calls replaced with `routeOutbound()`:

```typescript
async function routeOutbound(channels: Channel[], jid: string, text: string): Promise<boolean> {
  const channel = channels.find(c => c.ownsJid(jid) && c.isConnected());
  if (!channel) {
    logger.warn({ jid }, 'No connected channel for JID, message dropped');
    return false;
  }
  await channel.sendMessage(jid, text);
  return true;
}
```

Returns `boolean` instead of throwing — callers decide how to handle failure.

### Callsite Migration

| Location | Before | After |
|----------|--------|-------|
| Agent response (polling loop) | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| Error notification | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| Piped messages | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| Task scheduler callback | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| IPC watcher callback | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| Plugin context | `whatsapp.sendMessage()` | `routeOutbound(channels, jid, text)` |
| Typing indicators (3 sites) | `whatsapp.setTyping()` | **Removed** |
| Group metadata sync | `whatsapp.syncGroupMetadata()` | Broadcast `channel.refreshMetadata()` to all channels |
| `getAvailableGroups()` | Hardcoded `@g.us` filter | Delegate to each channel's `listAvailableGroups()` |

### Startup Sequence

```typescript
// Load all plugins
const plugins = await loadPlugins();

// Initialize channels from channel plugins
const channels: Channel[] = [];

for (const plugin of plugins.getChannelPlugins()) {
  const channelConfig: ChannelPluginConfig = {
    onMessage: async (chatJid, msg) => {
      const transformed = await plugins.runInboundHooks(msg, channel.name);
      storeMessage(transformed);
    },
    onChatMetadata: (chatJid, timestamp, name) => storeChatMetadata(chatJid, timestamp, name),
    registeredGroups: () => registeredGroups,
  };
  const channel = await plugin.hooks.onChannel(pluginCtx, channelConfig);
  channels.push(channel);
  await channel.connect();
}

// Plugin context uses router, not hardcoded channel
const pluginCtx: PluginContext = {
  sendMessage: (jid, text) => routeOutbound(channels, jid, text),
  // ... rest unchanged
};
```

### Shutdown Sequence

```typescript
for (const channel of channels) {
  await channel.disconnect();
}
```

Each channel plugin manages its own reconnection suppression (e.g. WhatsApp's `shuttingDown` flag).

## Message Polling Loop

The polling loop is already channel-agnostic — it reads from SQLite, not from WhatsApp. Messages enter the DB via each channel's `onMessage` callback → `storeMessage()`. The loop just checks for new rows by `chat_jid` and timestamp.

Changes to the loop:
1. Replace `whatsapp.sendMessage()` → `routeOutbound()`
2. Remove `whatsapp.setTyping()` calls
3. Everything else (message fetching, trigger checking, agent invocation) unchanged

## Error Handling

### No Channel for JID

| Context | Behavior |
|---------|----------|
| Agent response | Log warning, skip send. Agent already ran. |
| Scheduled task | Log error, mark run as failed in `task_run_logs` |
| IPC send | Log warning, return error to IPC caller |
| Plugin context send | Log warning, return rejected promise |

### Startup Health Check

On startup, iterate `registered_groups` and warn about JIDs that no loaded channel claims. Informational only — doesn't block startup.

### Channel Disconnection & Reconnection

Each channel manages reconnection internally — the core doesn't know or care. `channel.isConnected()` checked by router before sending. Messages during downtime are buffered server-side by the platform and delivered when the channel reconnects, flowing through `onMessage` → `storeMessage()` → polling loop as normal.

## Database Changes

### Schema

No structural changes needed. JIDs are opaque strings — different channels use non-overlapping namespaces.

One addition for debugging:

```sql
ALTER TABLE registered_groups ADD COLUMN channel TEXT;
```

Populated from `channel.name` at registration time. Backfill existing rows with `'whatsapp'`.

### Migration

```sql
UPDATE registered_groups SET channel = 'whatsapp' WHERE channel IS NULL;
```

## Claude-Mem Changes

### Project Naming

```javascript
// plugins/claude-mem/hooks/post-tool-use.js
// Before:
const PROJECT = 'nanoclaw-mem';
// After:
const PROJECT = `nanoclaw-${ctx.groupFolder}`;
```

Container skills/SKILL.md updated to use `project=nanoclaw-{groupFolder}`.

### One-Time Migration

```sql
-- In claude-mem SQLite DB
UPDATE observations SET project = 'nanoclaw-main' WHERE project = 'nanoclaw-mem';
```

Plus update ChromaDB metadata for the same records.

### Cross-Group Memory Access

- **Non-main agents**: CLAUDE.md and skill instructions only reference their own project. No enumeration API exists. Instruction-based isolation.
- **Main agent**: CLAUDE.md documents all group projects. Can search any project by passing explicit `project` parameter.
- **Future enhancement**: Per-container proxy that enforces project scope via token/identity. The proxy would sit between the container and claude-mem, injecting/overwriting the `project` parameter based on container identity. Documented here for future implementation.

## Plugin Dependencies

### WhatsApp (Built-in Plugin)

Baileys (`@whiskeysockets/baileys`) stays in the main `package.json`. WhatsApp ships as a built-in plugin — `npm install` works out of the box with no extra steps. The plugin imports Baileys from the top-level `node_modules`.

### Third-Party Channel Plugins (Telegram, Discord, etc.)

Follow the established pattern (same as `add-cal`, transcription):
- Plugin has its own `package.json` in `plugins/{name}/`
- The `add-*` installation skill runs `npm install --prefix plugins/{name}/` during setup
- `"dependencies": true` flag in `plugin.json` declares the plugin has npm deps
- Plugin loader warns at startup if `dependencies: true` but `node_modules/` is missing

## WhatsApp Plugin File Structure

```
plugins/whatsapp/
├── plugin.json          # manifest
├── index.js             # exports onChannel, WhatsAppChannel class
├── media.js             # downloadMedia(), type detection
├── metadata.js          # group metadata sync, LID translation
└── auth/
    └── server.js        # QR code HTTP server (from wa-auth-server.ts)

data/channels/whatsapp/
└── auth/                # Baileys session state (creds.json, keys, LID maps)
```

### Files Removed From Core

| File | Destination |
|------|-------------|
| `src/channels/whatsapp.ts` | `plugins/whatsapp/index.js` |
| `src/channels/whatsapp.test.ts` | `plugins/whatsapp/whatsapp.test.js` (or kept in `src/` referencing plugin) |
| `src/wa-auth-server.ts` | `plugins/whatsapp/auth/server.js` |
| `src/whatsapp-auth.ts` | `plugins/whatsapp/auth/cli.js` |
| `src/channels/` directory | Deleted (empty) |

### Files Modified

| File | Changes |
|------|---------|
| `src/index.ts` | Remove WhatsApp import, use `channels[]` + `routeOutbound()`, remove `setTyping` calls, delegate `getAvailableGroups` to channels |
| `src/router.ts` | `routeOutbound` returns `boolean`, already mostly correct |
| `src/plugin-types.ts` | Expand `onChannel` signature with `ChannelPluginConfig`, add `channels`/`groups` scope fields to manifest |
| `src/plugin-loader.ts` | Pass `ChannelPluginConfig` to `onChannel` hooks, filter plugins by channel/group scope |
| `src/config.ts` | Add `CHANNELS_DIR` path constant |
| `src/db.ts` | Add `channel` column migration |
| `package.json` | Remove `auth` script (moves to plugin), keep Baileys dependency |
| `plugins/claude-mem/hooks/post-tool-use.js` | Dynamic project naming |
| `container/skills/memory/SKILL.md` | Update project instructions |

### Documentation Updates

| File | Changes |
|------|---------|
| `README.md` | WhatsApp is a plugin, multi-channel supported |
| `CLAUDE.md` | Update key files table, remove `src/channels/whatsapp.ts` |
| `docs/SPEC.md` | Generalize architecture to multi-channel |
| `docs/REQUIREMENTS.md` | Update to reflect plugin-based channels |
| `docs/SECURITY.md` | Generalize credential handling, document plugin scoping |
| `docs/DIVERGENCES.md` | Update divergence state |

### Skills Updates

| Skill | Changes |
|-------|---------|
| `setup/SKILL.md` | Dynamic channel discovery, remove hardcoded WhatsApp auth |
| `customize/SKILL.md` | Update to reference plugin patterns instead of `src/channels/` |
| `add-telegram/SKILL.md` | Update to use channel plugin pattern instead of modifying source |
| `add-whatsapp-voice/SKILL.md` | No changes needed (already plugin-based) |

### Test Updates

| File | Changes |
|------|---------|
| `src/channels/whatsapp.test.ts` | Moves with plugin |
| `src/formatting.test.ts` | Use generic JID examples, not just WhatsApp formats |
| `src/routing.test.ts` | Test multi-channel JID routing |

## `/setup` Skill Changes

### First-Time Flow

1. Install dependencies (unchanged)
2. Scan `plugins/` for `channelPlugin: true`
3. Present available channels to user
4. Invoke selected channel's `authSkill`
5. Channel authenticates and connects
6. Call `channel.listAvailableGroups()` to show available groups
7. User selects main group → registered with `folder: 'main'`
8. Start service

### Adding Channels Later

Additive — `/setup` detects existing channels and only configures the new one. No need to reconfigure existing channels or groups.

## Transcription Plugin Impact

**No changes needed.** The transcription plugin only checks `msg.mediaType` and `msg.mediaHostPath` — generic fields on `NewMessage`. Each channel plugin populates these internally via its own media download implementation. The plugin's `channels` scope could optionally be set to `["whatsapp"]` since only WhatsApp currently supports voice notes.

## Group Mobility

Moving a group between channels (e.g. WhatsApp → Telegram):

1. Unregister old JID from `registered_groups`
2. Register new JID with same `folder`
3. All memory (CLAUDE.md, claude-mem project, IPC, sessions) preserved
4. Message history in DB stays under old `chat_jid` (acceptable — agent memory is in CLAUDE.md and claude-mem)

## Security Considerations

- **Plugin scoping**: Security-sensitive plugins (`homeassistant`, `github`) should declare `"groups": ["main"]` to prevent non-main groups from accessing their APIs
- **Plugin dependencies**: Plugin npm packages run in the host process (not containerized). Same trust model as today — plugins are user-installed code
- **Cross-group memory**: Instruction-based isolation. Non-main agents don't know other project names. Future: proxy-based enforcement
- **Channel credentials**: Stored in `data/channels/{name}/` with filesystem permissions. Not mounted into agent containers
- **JID spoofing**: A malicious plugin could claim to own any JID via `ownsJid()`. Mitigated by: plugins are user-installed, not untrusted third-party code

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| WhatsApp breaks during extraction | Test WhatsApp plugin in isolation before cutting over |
| Media download regresses | Transcription plugin serves as integration test |
| Claude-mem migration corrupts data | Backup SQLite + ChromaDB before migration |
| Orphaned scheduled tasks after JID change | Startup health check warns about JIDs with no channel |
| Plugin load order matters | Channel plugins load before `onStartup` hooks (already the case) |
| Baileys import path changes | Stays in main `node_modules`, plugin imports normally |
| Skills reference old file paths | Update all skills that reference `src/channels/whatsapp.ts` |
| `add-telegram` skill modifies source code | Rewrite to use channel plugin pattern instead |
