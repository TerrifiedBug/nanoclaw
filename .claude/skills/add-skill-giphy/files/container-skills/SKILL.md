---
name: gif-search
description: Search and send GIFs using the Giphy API. Use sparingly for humor.
allowed-tools: Bash(python3:*), Bash(curl:*)
---

# GIF Search

Search for GIFs via Giphy. Requires `$GIPHY_API_KEY` environment variable.

## When to Send GIFs

- Only when humor is appropriate (check your humor setting)
- To emphasize a reaction, not as a replacement for a real answer
- Sparingly — one GIF per conversation at most, never multiple in a row
- Never during serious or sensitive topics

## How to Search

```bash
python3 /workspace/.claude/skills/gif-search/scripts/gif-search.py "deal with it"
```

Returns JSON array with mp4 URLs and descriptions. Pick the most relevant result.

## How to Send

Download the mp4 and send via IPC:

```bash
curl -sL "<mp4_url>" -o /workspace/group/media/reaction.mp4
```

Then write a send_file IPC message:

```bash
cat > /workspace/ipc/messages/gif-$(date +%s).json << 'GIFJSON'
{"type":"send_file","chatJid":"CHAT_JID","filePath":"/workspace/group/media/reaction.mp4","caption":""}
GIFJSON
```

## Tips

- Use specific search terms ("mind blown explosion" not "funny")
- Always download the mp4 variant, not .gif (better cross-platform compatibility)
- If the search returns no results, don't mention it — just skip the GIF
