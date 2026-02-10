---
name: claude-mem
description: Search and save to the claude-mem persistent database. Use for facts, event history, and learnings you might need to recall later. NOT for standing rules or preferences — those go in MEMORY.md.
allowed-tools: Bash(curl:*)
---

# Persistent Memory

You have access to a persistent memory system that survives across sessions. Use it to remember important information about the user and recall context from previous conversations.

**Important:** Always use `project=nanoclaw-mem` in all API calls to keep memories isolated from other systems.

## When to Search Memory

- User asks about something discussed previously
- User references a person, project, or recurring topic
- User says "remember when...", "last time...", or "did I tell you..."
- You need context about user preferences, routines, or schedules
- Before making assumptions about recurring topics

## When to Save Memory

- User states a preference ("I prefer morning meetings")
- User shares a schedule change ("I'm taking the 10:19 train today instead")
- You learn a new fact about the user's life, work, or relationships
- User explicitly asks you to remember something
- A decision or plan is made that will be relevant later
- Important dates, events, or deadlines mentioned

## When NOT to Save

- Trivial greetings or small talk
- Transient info ("what's the weather right now")
- Information already in your CLAUDE.md files
- Duplicate of something already saved (search first!)

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

## Save a Memory

```bash
curl -s -X POST "$CLAUDE_MEM_URL/api/memory/save" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "User prefers morning meetings before 10am. Mentioned during scheduling discussion.",
    "title": "Meeting time preference",
    "project": "nanoclaw-mem"
  }' | jq .
```

## Tips

- Keep saved memories concise but include enough context to be useful later
- Include dates when relevant ("Mentioned on Feb 10")
- Use descriptive titles for easy scanning in search results
- **Always search before saving** to avoid duplicates
- Search queries should be broad enough to find related memories
- You don't need to save everything -- focus on facts that will matter in future conversations
- Be proactive -- search memory at the start of conversations about recurring topics
