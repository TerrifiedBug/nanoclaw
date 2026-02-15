# Plugin System

NanoClaw plugins are runtime-loaded extensions that add capabilities to agent containers without modifying core source code. A plugin can provide container skills, MCP server configs, environment variables, SDK hooks, additional filesystem mounts, host-side hooks, or even entirely new messaging channels.

Plugins are discovered at startup by scanning the `plugins/` directory. Each subdirectory with a `plugin.json` manifest is loaded into a `PluginRegistry` that the rest of the system queries for container configuration.

## Directory Structure

```
plugins/{name}/
  plugin.json              # Required — manifest declaring capabilities
  index.js                 # Host-side hook implementations (if hooks declared)
  mcp.json                 # MCP server config fragment (merged into container)
  container-skills/        # Agent skill files mounted into containers
    SKILL.md               # Claude Code skill (instructions + allowed-tools)
  hooks/                   # SDK hook scripts run inside containers
    post-tool-use.js       # Example: hook that runs after each tool call
```

Only `plugin.json` is required. Everything else is optional depending on what the plugin does.

## Plugin Manifest (`plugin.json`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique plugin identifier |
| `description` | `string` | No | Human-readable description |
| `containerEnvVars` | `string[]` | No | Env var names from `.env` to pass into agent containers |
| `hooks` | `string[]` | No | Host-side hook function names exported by `index.js` |
| `containerHooks` | `string[]` | No | JS files (relative paths) loaded as SDK hooks inside containers |
| `containerMounts` | `Array<{hostPath, containerPath}>` | No | Additional read-only mounts for containers |
| `dependencies` | `boolean` | No | Whether the plugin has its own `package.json`/`node_modules` |

### Examples

Minimal plugin (container skill only):

```json
{
  "name": "weather",
  "description": "Weather forecasts and current conditions",
  "containerEnvVars": [],
  "hooks": []
}
```

Plugin with env vars and MCP config:

```json
{
  "name": "homeassistant",
  "description": "Home Assistant smart home integration via MCP",
  "containerEnvVars": ["HA_URL", "HA_TOKEN"],
  "hooks": []
}
```

Plugin with host-side hooks:

```json
{
  "name": "webhook",
  "description": "HTTP webhook endpoint for external event ingestion",
  "containerEnvVars": ["NANOCLAW_WEBHOOK_URL", "NANOCLAW_WEBHOOK_SECRET"],
  "hooks": ["onStartup", "onShutdown"]
}
```

Plugin with container hooks and env vars:

```json
{
  "name": "claude-mem",
  "description": "Persistent cross-session memory",
  "containerEnvVars": ["CLAUDE_MEM_URL"],
  "containerHooks": ["hooks/post-tool-use.js"],
  "hooks": []
}
```

Plugin with additional container mounts:

```json
{
  "name": "calendar",
  "description": "Calendar access via gog CLI and CalDAV",
  "containerEnvVars": ["GOG_KEYRING_PASSWORD", "GOG_ACCOUNT", "CALDAV_ACCOUNTS"],
  "containerMounts": [
    {
      "hostPath": "/data/nanoclaw/data/gogcli",
      "containerPath": "/home/node/.config/gogcli"
    }
  ],
  "hooks": []
}
```

## Hook Lifecycle

Plugins can export four hook functions, declared in the `hooks` array and implemented in `index.js`.

### `onStartup(ctx: PluginContext)`

Called once during NanoClaw startup, after the plugin is loaded. Use for starting servers, initializing connections, or any setup that needs to happen before message processing begins.

The `PluginContext` provides:

| Method/Property | Description |
|----------------|-------------|
| `ctx.insertMessage(chatJid, id, sender, senderName, text)` | Inject a message into the processing queue |
| `ctx.sendMessage(jid, text)` | Send a message to any registered chat |
| `ctx.getRegisteredGroups()` | Get all registered groups |
| `ctx.getMainChannelJid()` | Get the main (admin) channel JID |
| `ctx.logger` | Pino logger instance |

### `onShutdown()`

Called during graceful shutdown. Clean up servers, connections, timers. Errors are caught and logged without blocking other plugins from shutting down.

### `onInboundMessage(msg: InboundMessage, channel: string)`

Called for every inbound message before it reaches the agent. Hooks run in plugin load order (alphabetical by directory name). Each hook receives the message and returns a (potentially modified) message. This enables message transformation, filtering, enrichment, or logging.

The `InboundMessage` has the same shape as `NewMessage`: `id`, `chat_jid`, `sender`, `sender_name`, `content`, `timestamp`, plus optional `is_from_me`, `is_bot_message`, `mediaType`, and `mediaPath`.

### `onChannel(ctx: PluginContext)`

Return a `Channel` object to register an entirely new messaging channel (e.g., Telegram, Slack). The channel must implement: `name`, `connect()`, `sendMessage(jid, text)`, `isConnected()`, `ownsJid(jid)`, `disconnect()`, and optionally `setTyping(jid, isTyping)`.

### Execution Order

During startup, the registry processes each plugin in load order:
1. `onChannel` is called first (if present) to register the channel
2. `onStartup` is called second (if present)

During message processing:
1. All `onInboundMessage` hooks run in sequence before the message reaches the agent

During shutdown:
1. All `onShutdown` hooks run; errors are caught per-plugin so one failure does not block others

## Container Integration

Plugins affect agent containers through five mechanisms, all managed by the `PluginRegistry` and applied by `container-runner.ts` when spawning containers.

### Environment Variables

Each plugin declares which env var names from the host `.env` should be passed into containers via `containerEnvVars`. These are merged with the core set (`ANTHROPIC_API_KEY`, `ASSISTANT_NAME`, `CLAUDE_MODEL`) and deduplicated. Only lines matching declared var names are extracted from `.env` and written to a filtered env file mounted into the container.

### Container Skills (`container-skills/`)

If a plugin has a `container-skills/` subdirectory, it is mounted read-only into the container at:

```
/workspace/.claude/skills/{plugin-name}/
```

This makes skill files (like `SKILL.md`) available to Claude Code inside the container. Skills define instructions and `allowed-tools` that the agent can use.

### MCP Config (`mcp.json`)

If a plugin has an `mcp.json` file, its `mcpServers` entries are merged with the root `.mcp.json` (if present) and any other plugins' MCP configs. The merged result is written to `data/merged-mcp.json` on the host and mounted read-only at `/workspace/.mcp.json` inside the container.

Example `mcp.json`:

```json
{
  "mcpServers": {
    "home-assistant": {
      "type": "http",
      "url": "${HA_URL}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${HA_TOKEN}"
      }
    }
  }
}
```

### Container Hooks (`containerHooks`)

JS files declared in `containerHooks` are mounted into the container at:

```
/workspace/plugin-hooks/{plugin-name}--{filename}
```

These are SDK hook scripts (e.g., `post-tool-use.js`) that the agent-runner loads at startup inside the container. They run in the container's Node.js process, not on the host.

### Container Mounts (`containerMounts`)

Additional host directories declared in `containerMounts` are mounted read-only into the container at the specified `containerPath`. Paths that do not exist on the host are skipped with a warning.

## How Skills Create Plugins

Installation skills live in `.claude/skills/add-{name}/` and contain a `SKILL.md` that guides Claude Code through creating a plugin. The typical pattern is:

1. The skill's `SKILL.md` contains step-by-step instructions
2. Steps create `plugins/{name}/` with all necessary files (manifest, skills, MCP config, etc.)
3. Environment variables are added to `.env`
4. The project is rebuilt (`npm run build`) and the service restarted

Example from `add-brave-search`:

```
Step 1: Check if already configured
Step 2: Get API key from user
Step 3: Save BRAVE_API_KEY to .env
Step 4: Create plugins/brave-search/ with plugin.json and container-skills/
Step 5: Test the key
Step 6: Build and restart
```

This pattern means skills are idempotent install scripts. The skill contains the knowledge; the plugin directory is the artifact.

## Plugin Discovery and Loading

The `loadPlugins()` function:

1. Scans `plugins/` for subdirectories containing `plugin.json`
2. Parses and validates each manifest via `parseManifest()`
3. If the manifest declares `hooks`, imports `index.js` from the plugin directory and extracts the named functions
4. Registers each plugin in the `PluginRegistry`

Plugins are loaded in filesystem order (alphabetical by directory name). The registry is set on the container runner via `setPluginRegistry()` so that all subsequent container spawns include plugin configuration.

## Removal

To fully uninstall a plugin:

1. Remove the plugin directory:
   ```bash
   rm -rf plugins/{name}/
   ```

2. Remove any env vars the plugin added to `.env` (check `containerEnvVars` in the manifest first):
   ```bash
   sed -i '/^VAR_NAME=/d' .env
   ```

3. If the plugin had an `mcp.json`, the merged config will be regenerated on next startup without it.

4. Rebuild and restart:
   ```bash
   npm run build
   # Then restart the service
   ```

## Example: Complete Minimal Plugin

A weather plugin that gives agents access to weather data via a container skill, using free public APIs (no API key required).

### `plugins/weather/plugin.json`

```json
{
  "name": "weather",
  "description": "Weather forecasts and current conditions",
  "containerEnvVars": [],
  "hooks": []
}
```

### `plugins/weather/container-skills/SKILL.md`

```markdown
---
name: weather
description: Get weather forecasts and current conditions for any location.
allowed-tools: Bash(curl:*)
---

# Weather Lookup

Use curl for weather lookups (no API key needed):

```bash
curl -s "wttr.in/CityName?format=3"          # One-line summary
curl -s "wttr.in/CityName?T"                  # Full forecast
```

Tips:
- URL-encode spaces (`New+York`)
- `?m` metric, `?u` USCS
- `?1` today only, `?0` current only
```

That is the entire plugin. On startup, NanoClaw discovers `plugins/weather/plugin.json`, sees the `container-skills/` directory, and mounts it into every agent container at `/workspace/.claude/skills/weather/`. Agents can then answer weather questions using the skill instructions.
