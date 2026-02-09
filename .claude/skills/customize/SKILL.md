---
name: customize
description: Add new capabilities or modify NanoClaw behavior. Use when user wants to add channels (Telegram, Slack, email input), change triggers, add integrations, modify the router, or make any other customizations. This is an interactive skill that asks questions to understand what the user wants.
---

# NanoClaw Customization

This skill helps users add capabilities or modify behavior. Use AskUserQuestion to understand what they want before making changes.

## Workflow

1. **Understand the request** - Ask clarifying questions
2. **Plan the changes** - Identify files to modify
3. **Implement** - Make changes directly to the code
4. **Test guidance** - Tell user how to verify

## Key Files

| File | Purpose |
|------|---------|
| `src/config.ts` | Assistant name, trigger pattern, directories |
| `src/index.ts` | Message routing, WhatsApp connection, agent invocation |
| `src/db.ts` | Database initialization and queries |
| `src/types.ts` | TypeScript interfaces |
| `src/whatsapp-auth.ts` | Standalone WhatsApp authentication script |
| `.mcp.json` | MCP server configuration (reference) |
| `groups/CLAUDE.md` | Global memory/persona |

## Adding Skills to NanoClaw Agents

**Important distinction:** `.claude/skills/` in the project root are for Claude Code in this terminal (setup, debug, customize). Agent skills live in `container/skills/` and are auto-discovered inside containers.

### How agent skills work

Skills in `container/skills/{name}/SKILL.md` are mounted read-only at `/workspace/.claude/skills/` inside the container. Claude Code's walk-up discovery finds them automatically — no rebuild needed.

The agent also loads knowledge from:
1. **`groups/global/CLAUDE.md`** — shared across ALL groups
2. **`groups/{folder}/CLAUDE.md`** — specific to one group

### Adding a skill for all groups

Create `container/skills/{name}/SKILL.md` with standard Claude Code skill frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it.
allowed-tools: Bash(tool-name:*)
---

# Skill instructions here
```

No container rebuild needed — just add the file and restart NanoClaw.

### Adding knowledge for one group only

Add a section to that group's `groups/{folder}/CLAUDE.md`.

### Importing skills from OpenClaw or external sources

1. Fetch the skill content (e.g., from `https://github.com/openclaw/openclaw/blob/main/skills/{name}/SKILL.md`)
2. Save it as `container/skills/{name}/SKILL.md` (keep the frontmatter — the agent uses it)
3. If the skill requires system packages (e.g., `ffmpeg`) not in the container, add them to `container/Dockerfile` and rebuild with `./container/build.sh`
4. If the skill requires npm packages, install them in `container/agent-runner/` and rebuild
5. Restart NanoClaw

## Common Customization Patterns

### Adding a New Input Channel (e.g., Telegram, Slack, Email)

Questions to ask:
- Which channel? (Telegram, Slack, Discord, email, SMS, etc.)
- Same trigger word or different?
- Same memory hierarchy or separate?
- Should messages from this channel go to existing groups or new ones?

Implementation pattern:
1. Find/add MCP server for the channel
2. Add connection and message handling in `src/index.ts`
3. Store messages in the database (update `src/db.ts` if needed)
4. Ensure responses route back to correct channel

### Adding a New MCP Integration

Questions to ask:
- What service? (Calendar, Notion, database, etc.)
- What operations needed? (read, write, both)
- Which groups should have access?

Implementation:
1. Add MCP server to the `mcpServers` config in `src/index.ts`
2. Add tools to `allowedTools` array
3. Document in `groups/CLAUDE.md`

### Changing Assistant Behavior

Questions to ask:
- What aspect? (name, trigger, persona, response style)
- Apply to all groups or specific ones?

Simple changes → edit `src/config.ts`
Persona changes → edit `groups/CLAUDE.md`
Per-group behavior → edit specific group's `CLAUDE.md`

### Adding New Commands

Questions to ask:
- What should the command do?
- Available in all groups or main only?
- Does it need new MCP tools?

Implementation:
1. Add command handling in `processMessage()` in `src/index.ts`
2. Check for the command before the trigger pattern check

### Changing Deployment

Questions to ask:
- Target platform? (Linux server, Docker, different Mac)
- Service manager? (systemd, Docker, supervisord)

Implementation:
1. Create appropriate service files
2. Update paths in config
3. Provide setup instructions

## After Changes

Rebuild and restart. Detect the platform first:

```bash
npm run build
# Linux (systemd):
systemctl restart nanoclaw
# macOS (launchd):
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Example Interaction

User: "Add Telegram as an input channel"

1. Ask: "Should Telegram use the same @Andy trigger, or a different one?"
2. Ask: "Should Telegram messages create separate conversation contexts, or share with WhatsApp groups?"
3. Find Telegram MCP or library
4. Add connection handling in index.ts
5. Update message storage in db.ts
6. Tell user how to authenticate and test
