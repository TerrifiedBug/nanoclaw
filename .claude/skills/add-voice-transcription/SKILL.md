---
name: add-voice-transcription
description: Add voice message transcription to NanoClaw using OpenAI's Whisper API. Automatically transcribes WhatsApp voice notes so the agent can read and respond to them.
---

# Add Voice Message Transcription

This skill adds automatic voice message transcription as a plugin using OpenAI's Whisper API. When users send voice notes in WhatsApp, the `onInboundMessage` hook transcribes them before the agent sees the message.

**Architecture:** The transcription plugin uses the `onInboundMessage` hook to intercept voice messages, download the audio buffer, send it to OpenAI's Whisper API, and replace the message content with the transcribed text. No core source files are modified.

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## Prerequisites

**USER ACTION REQUIRED**

**Use the AskUserQuestion tool** to present this:

> You'll need an OpenAI API key for Whisper transcription.
>
> Get one at: https://platform.openai.com/api-keys
>
> Cost: ~$0.006 per minute of audio (~$0.003 per typical 30-second voice note)
>
> Once you have your API key, we'll configure it securely.

Wait for user to confirm they have an API key before continuing.

---

## Implementation

### Step 1: Create Transcription Configuration

Create a configuration file for transcription settings (without the API key):

Write to `.transcription.config.json`:

```json
{
  "provider": "openai",
  "openai": {
    "apiKey": "",
    "model": "whisper-1"
  },
  "enabled": true,
  "fallbackMessage": "[Voice Message - transcription unavailable]"
}
```

Add this file to `.gitignore` to prevent committing API keys:

```bash
echo ".transcription.config.json" >> .gitignore
```

**Use the AskUserQuestion tool** to confirm:

> I've created `.transcription.config.json` in the project root. You'll need to add your OpenAI API key to it manually:
>
> 1. Open `.transcription.config.json`
> 2. Replace the empty `"apiKey": ""` with your key: `"apiKey": "sk-proj-..."`
> 3. Save the file
>
> Let me know when you've added it.

Wait for user confirmation.

### Step 2: Create Plugin

Create the `plugins/transcription/` directory with `plugin.json`, `package.json`, and `index.js`.

```bash
mkdir -p plugins/transcription
```

#### 2a. Create `plugins/transcription/plugin.json`

```json
{
  "name": "transcription",
  "description": "Voice message transcription via OpenAI Whisper",
  "containerEnvVars": [],
  "hooks": ["onInboundMessage"],
  "dependencies": true
}
```

The `"dependencies": true` flag tells the plugin loader to look for a `package.json` and ensure `node_modules` is installed.

#### 2b. Create `plugins/transcription/package.json`

```json
{
  "name": "nanoclaw-plugin-transcription",
  "private": true,
  "type": "module",
  "dependencies": {
    "openai": "^4.77.0"
  }
}
```

#### 2c. Create `plugins/transcription/index.js`

This is the plugin's hook code. It intercepts inbound voice messages via the `onInboundMessage` hook, transcribes them using OpenAI Whisper, and replaces the message content with the transcription.

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const configPath = path.join(__dirname, '..', '..', '.transcription.config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { provider: 'openai', enabled: false, fallbackMessage: '[Voice Message - transcription unavailable]' };
  }
}

async function transcribeWithOpenAI(audioBuffer, config) {
  if (!config.openai?.apiKey || config.openai.apiKey === '') return null;

  const openaiModule = await import('openai');
  const OpenAI = openaiModule.default;
  const { toFile } = openaiModule;

  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const file = await toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: config.openai.model || 'whisper-1',
    response_format: 'text',
  });

  return /** @type {string} */ (transcription);
}

/**
 * onInboundMessage hook -- transcribe voice notes.
 * The WhatsApp channel sets audioBuffer and mediaType on voice messages.
 */
export async function onInboundMessage(msg, channel) {
  // Only process voice notes (audio with ptt flag, indicated by mediaType)
  if (!msg.audioBuffer || msg.mediaType !== 'voice') return msg;

  const config = loadConfig();
  if (!config.enabled) {
    msg.content = msg.content
      ? `${msg.content}\n${config.fallbackMessage}`
      : config.fallbackMessage;
    return msg;
  }

  try {
    let transcript = null;
    if (config.provider === 'openai') {
      transcript = await transcribeWithOpenAI(msg.audioBuffer, config);
    }

    if (transcript) {
      const trimmed = transcript.trim();
      msg.content = msg.content
        ? `${msg.content}\n[Voice: ${trimmed}]`
        : `[Voice: ${trimmed}]`;
    } else {
      msg.content = msg.content
        ? `${msg.content}\n${config.fallbackMessage}`
        : config.fallbackMessage;
    }
  } catch (err) {
    console.error('Transcription plugin error:', err);
    msg.content = msg.content
      ? `${msg.content}\n[Voice Message - transcription failed]`
      : '[Voice Message - transcription failed]';
  }

  // Clear the buffer so it's not held in memory
  delete msg.audioBuffer;
  return msg;
}
```

### Step 3: Install Dependencies

The OpenAI SDK requires Zod v3 as an optional peer dependency, but NanoClaw uses Zod v4. This conflict is guaranteed, so always use `--legacy-peer-deps`:

```bash
cd plugins/transcription && npm install --legacy-peer-deps
```

### Step 4: Build and Restart

```bash
npm run build
```

Restart the service:

```bash
# Linux
systemctl restart nanoclaw

# macOS
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist && launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Step 5: Test Voice Transcription

Tell the user:

> Voice transcription is ready! Test it by:
>
> 1. Open WhatsApp on your phone
> 2. Go to a registered group chat
> 3. Send a voice note using the microphone button
> 4. The agent should receive the transcribed text and respond
>
> In the database and agent context, voice messages appear as:
> `[Voice: <transcribed text here>]`

Watch for transcription in the logs:

```bash
tail -f logs/nanoclaw.log | grep -i "voice\|transcri"
```

---

## Configuration Options

### Enable/Disable Transcription

To temporarily disable without removing the plugin, edit `.transcription.config.json`:

```json
{
  "enabled": false
}
```

### Change Fallback Message

Customize what's stored when transcription fails:

```json
{
  "fallbackMessage": "[Voice note - transcription unavailable]"
}
```

### Switch to Different Provider (Future)

The architecture supports multiple providers. To add Groq, Deepgram, or local Whisper:

1. Add provider config to `.transcription.config.json`
2. Implement provider function in `plugins/transcription/index.js` (similar to `transcribeWithOpenAI`)
3. Add a branch to the provider check in `onInboundMessage`

---

## Troubleshooting

### "Transcription unavailable" or "Transcription failed"

Check logs for specific errors:
```bash
tail -100 logs/nanoclaw.log | grep -i transcription
```

Common causes:
- API key not configured or invalid
- No API credits remaining
- Network connectivity issues
- Audio format not supported by Whisper

### Voice messages not being detected

- Ensure you're sending actual voice notes (microphone button), not audio file attachments
- The plugin checks for `msg.mediaType === 'voice'` -- regular audio attachments are not transcribed

### Dependency conflicts (Zod versions)

The OpenAI SDK requires Zod v3, but NanoClaw uses Zod v4. This conflict is guaranteed -- always use:
```bash
cd plugins/transcription && npm install --legacy-peer-deps
```

---

## Security Notes

- The `.transcription.config.json` file contains your API key and should NOT be committed to version control
- It's added to `.gitignore` by this skill
- Audio files are sent to OpenAI for transcription - review their data usage policy
- No audio files are stored locally after transcription
- Transcripts are stored in the database like regular text messages

---

## Cost Management

Monitor usage in your OpenAI dashboard: https://platform.openai.com/usage

Tips to control costs:
- Set spending limits in OpenAI account settings
- Disable transcription during development/testing with `"enabled": false`
- Typical usage: 100 voice notes/month (~3 minutes average) = ~$1.80

---

## Removal

1. Remove the plugin:
```bash
rm -rf plugins/transcription/
```

2. Delete the config file:
```bash
rm -f .transcription.config.json
```

3. Rebuild and restart NanoClaw.

---

## Future Enhancements

Potential additions:
- **Local Whisper**: Use `whisper.cpp` or `faster-whisper` for offline transcription
- **Groq Integration**: Free tier with Whisper, very fast
- **Deepgram**: Alternative cloud provider
- **Language Detection**: Auto-detect and transcribe non-English voice notes
- **Cost Tracking**: Log transcription costs per message
- **Speaker Diarization**: Identify different speakers in voice notes
