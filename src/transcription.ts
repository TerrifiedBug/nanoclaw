import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TranscriptionConfig {
  provider: string;
  openai?: {
    apiKey: string;
    model: string;
  };
  enabled: boolean;
  fallbackMessage: string;
}

function loadConfig(): TranscriptionConfig {
  const configPath = path.join(__dirname, '../.transcription.config.json');
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (err) {
    logger.error({ err }, 'Failed to load transcription config');
    return {
      provider: 'openai',
      enabled: false,
      fallbackMessage: '[Voice Message - transcription unavailable]',
    };
  }
}

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  if (!config.openai?.apiKey || config.openai.apiKey === '') {
    logger.warn('OpenAI API key not configured for transcription');
    return null;
  }

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

  // When response_format is 'text', the SDK returns a plain string
  return transcription as unknown as string;
}

/**
 * Transcribe an audio buffer using the configured provider.
 * Returns the transcribed text, a fallback message, or null if disabled.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  const config = loadConfig();

  if (!config.enabled) {
    return config.fallbackMessage;
  }

  try {
    let transcript: string | null = null;

    switch (config.provider) {
      case 'openai':
        transcript = await transcribeWithOpenAI(audioBuffer, config);
        break;
      default:
        logger.error({ provider: config.provider }, 'Unknown transcription provider');
        return config.fallbackMessage;
    }

    if (!transcript) {
      return config.fallbackMessage;
    }

    return transcript.trim();
  } catch (err) {
    logger.error({ err }, 'Transcription error');
    return config.fallbackMessage;
  }
}
