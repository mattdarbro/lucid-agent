/**
 * ElevenLabs text-to-speech — the one place Lucid's voice is configured.
 *
 * Both consumers go through here: LibraryAudioService banks whole entries as
 * MP3 on demand, and POST /v1/tts stream-proxies PCM to the phone so the app
 * never needs an ElevenLabs key of its own.
 */

export const VOICE_ID = process.env.LUCID_VOICE_ID || 'BWGwF36RwZsLxWHtzZ3e';
export const VOICE_NAME = process.env.LUCID_VOICE_NAME || 'Kieron';
// Flash v2.5 bills 0.5 credits/char — half the v2/v3 tiers, ~150ms to first byte.
export const MODEL_ID = process.env.LUCID_TTS_MODEL || 'eleven_flash_v2_5';

/** Flash v2.5 takes 40k characters per request; the longest library entry is ~13.7k. */
export const MAX_TTS_CHARS = 38_000;

/** Raw 16-bit LE mono, the format StreamingPCMPlayer on iOS consumes directly. */
export const STREAM_SAMPLE_RATE = 24_000;

/** Kieron already carries the gentle English warmth Lucid reads in, so these
 *  only need to hold him even across a long passage rather than act. */
export const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

const BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const REQUEST_TIMEOUT_MS = 300_000;

export class TTSNotConfiguredError extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY not set');
    this.name = 'TTSNotConfiguredError';
  }
}

export class TTSTooLongError extends Error {
  constructor(length: number) {
    super(`Text is ${length} chars, over the ${MAX_TTS_CHARS} limit`);
    this.name = 'TTSTooLongError';
  }
}

export function isConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

async function post(url: string, text: string, accept: string): Promise<Response> {
  if (!isConfigured()) throw new TTSNotConfiguredError();
  if (text.length > MAX_TTS_CHARS) throw new TTSTooLongError(text.length);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      Accept: accept,
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs HTTP ${res.status}: ${detail}`);
  }
  return res;
}

/** Whole-file synthesis — used when banking a library entry to disk. */
export async function synthesizeMp3(text: string): Promise<Buffer> {
  const res = await post(
    `${BASE_URL}/${VOICE_ID}?output_format=mp3_44100_128`,
    text,
    'audio/mpeg'
  );
  const mp3 = Buffer.from(await res.arrayBuffer());
  if (mp3.length === 0) throw new Error('ElevenLabs returned empty audio');
  return mp3;
}

/**
 * Streaming synthesis as raw PCM, for live playback on the phone. Returns the
 * upstream body so the caller can pipe it straight through without buffering —
 * audio starts on the first packet instead of after the whole generation.
 */
export async function synthesizeStreamPcm(text: string): Promise<ReadableStream<Uint8Array>> {
  const res = await post(
    `${BASE_URL}/${VOICE_ID}/stream?output_format=pcm_${STREAM_SAMPLE_RATE}`,
    text,
    'audio/pcm'
  );
  if (!res.body) throw new Error('ElevenLabs returned no stream body');
  return res.body as ReadableStream<Uint8Array>;
}

/** Strips markdown tokens so they aren't read aloud (mirrors the iOS preprocessing). */
export function preprocessForTTS(text: string): string {
  let cleaned = text;
  for (const token of ['***', '**', '*', '___', '__', '_', '~~', '`', '#']) {
    cleaned = cleaned.split(token).join('');
  }
  return cleaned.trim();
}
