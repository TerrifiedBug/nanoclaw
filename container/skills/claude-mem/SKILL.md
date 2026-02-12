---
name: claude-mem
description: Search the claude-mem persistent database for past context. Conversations are captured automatically — use this skill to search and recall. Standing rules and preferences go in MEMORY.md instead.
allowed-tools: Bash(curl:*)
---

# Persistent Memory

Your conversations are automatically captured into a persistent memory database that survives across sessions. Use this skill to **search** for past context when needed. Requires `$CLAUDE_MEM_URL` environment variable. If not configured, run `/add-claude-mem` on the host to set it up.

For standing rules and personal preferences, use `MEMORY.md` in your workspace instead — it's auto-loaded every session.

**Important:** Always use `project=nanoclaw-mem` in all API calls to keep memories isolated from other systems.

## When to Search Memory

- User asks about something discussed previously
- User references a person, project, or recurring topic
- User says "remember when...", "last time...", or "did I tell you..."
- You need context about past decisions or plans
- Before making assumptions about recurring topics
- Be proactive — search memory at the start of conversations about recurring topics

## Search Memory

```bash
# Search for memories matching a query
curl -s "$CLAUDE_MEM_URL/api/search?query=morning+routine+preferences&project=nanoclaw-mem" | jq -r '.content[0].text // .'
```

Search returns an index with observation IDs and titles. If you need full details for specific results, fetch them by ID.

## Get Full Details

```bash
# Fetch complete details for specific observation IDs found in search
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

- Search queries should be broad enough to find related memories
- Use timeline to understand the context around a specific memory
- If you learn a new standing rule or personal fact, save it to `MEMORY.md` — not here
- Conversations are captured automatically — you rarely need to manually save
