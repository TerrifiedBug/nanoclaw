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

async function transcribeWithOpenAI(audioPath, config) {
  if (!config.openai?.apiKey || config.openai.apiKey === '') return null;

  const openaiModule = await import('openai');
  const OpenAI = openaiModule.default;
  const { toFile } = openaiModule;

  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  const buffer = fs.readFileSync(audioPath);
  const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: config.openai.model || 'whisper-1',
    response_format: 'text',
  });

  return /** @type {string} */ (transcription);
}

/**
 * onInboundMessage hook -- transcribe voice notes.
 * The WhatsApp channel saves audio files to mediaPath. This hook reads the
 * saved file and transcribes it. Voice notes have mediaType 'audio' and
 * content containing '[audio: /workspace/group/media/...]'.
 */
export async function onInboundMessage(msg, channel) {
  // Only process audio messages that have a saved media file
  if (msg.mediaType !== 'audio' || !msg.mediaPath) return msg;

  // Resolve the host path from the container-relative path
  // mediaPath is like /workspace/group/media/xyz.ogg — map to groups/<folder>/media/xyz.ogg
  const hostPath = msg.mediaPath.replace(/^\/workspace\/group\//, path.join(process.cwd(), 'groups', msg.chat_jid.replace(/@.*$/, ''), ''));
  if (!fs.existsSync(hostPath)) return msg;

  const config = loadConfig();
  if (!config.enabled) return msg;

  try {
    let transcript = null;
    if (config.provider === 'openai') {
      transcript = await transcribeWithOpenAI(hostPath, config);
    }

    if (transcript) {
      const trimmed = transcript.trim();
      // Replace the [audio: path] annotation with the transcription
      msg.content = msg.content.replace(/\[audio: [^\]]+\]/, `[Voice: ${trimmed}]`);
    }
  } catch (err) {
    console.error('Transcription plugin error:', err);
  }

  return msg;
}
