/**
 * Text-to-speech — the one place Lucid's voice is configured.
 *
 * Both consumers go through here: LibraryAudioService banks whole entries as
 * MP3 on demand, and POST /v1/tts stream-proxies PCM to the phone so the app
 * never needs an ElevenLabs key of its own.
 *
 * Two engines (2026-08-07):
 *
 *   kokoro (default) — a resident local model on falcon, free at any volume.
 *     This is what made pre-generating the whole library possible: the archive
 *     is 4.5M characters, which is ~$1,361 of ElevenLabs and $0 here.
 *   elevenlabs      — Kieron on Flash v2.5, kept as an explicit fallback and
 *     for anything that needs to ship at commercial quality.
 *
 * LUCID_TTS_ENGINE sets the default both consumers use. Library banking can
 * override it per call (2026-08-08): see LibraryAudioService for the three-day
 * premium window, where an entry Matt taps while it is still new is rendered on
 * ElevenLabs and everything else falls to Kokoro.
 */

export type TTSEngine = 'kokoro' | 'elevenlabs';

export const ENGINE: TTSEngine =
  (process.env.LUCID_TTS_ENGINE as TTSEngine) === 'elevenlabs' ? 'elevenlabs' : 'kokoro';

// --- ElevenLabs ------------------------------------------------------------
export const VOICE_ID = process.env.LUCID_VOICE_ID || 'BWGwF36RwZsLxWHtzZ3e';
// Flash v2.5 bills 0.5 credits/char — half the v2/v3 tiers, ~150ms to first byte.
const ELEVEN_MODEL_ID = process.env.LUCID_TTS_MODEL || 'eleven_flash_v2_5';
const ELEVEN_VOICE_NAME = process.env.LUCID_VOICE_NAME || 'Kieron';

/** Kieron already carries the gentle English warmth Lucid reads in, so these
 *  only need to hold him even across a long passage rather than act. */
export const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

const BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// --- Kokoro ----------------------------------------------------------------
/** kokoro-tts.service, resident on falcon. Localhost only — it has no auth of
 *  its own and this server is what carries it. */
const KOKORO_URL = process.env.KOKORO_TTS_URL || 'http://127.0.0.1:8081/speak';
const KOKORO_VOICE = process.env.LUCID_KOKORO_VOICE || 'bm_daniel';
const KOKORO_MODEL_ID = 'kokoro-v1.0';

/**
 * Playback rate for banked library narration (2026-08-08). Kokoro's 1.0 reads a
 * written entry a shade faster than it wants to be heard; 0.92 gives the prose
 * room to breathe without tipping into a deliberate, slowed-down delivery.
 *
 * Library only. Live chat on the phone stays at 1.0 — a conversational reply
 * slowed to reading pace feels sluggish to talk to, and the two paths are meant
 * to differ here even though they share a voice.
 */
const KOKORO_LIBRARY_SPEED = Number(process.env.LUCID_KOKORO_LIBRARY_SPEED ?? 0.92);
const KOKORO_STREAM_SPEED = 1.0;

/** Reported into metadata.audio so a banked file always says what made it. */
export const VOICE_NAME = ENGINE === 'kokoro' ? KOKORO_VOICE : ELEVEN_VOICE_NAME;
export const MODEL_ID = ENGINE === 'kokoro' ? KOKORO_MODEL_ID : ELEVEN_MODEL_ID;
/** ElevenLabs has no speed control on this path, so it reports its native 1.0. */
export const LIBRARY_SPEED = ENGINE === 'kokoro' ? KOKORO_LIBRARY_SPEED : 1.0;

/** What a given engine stamps into metadata.audio, so a banked file always says
 *  what made it — and so the premium tier stays identifiable years later, when
 *  ENGINE may well be pointing somewhere else entirely. */
export function engineIdentity(engine: TTSEngine): {
  voice: string;
  model: string;
  speed: number;
} {
  return engine === 'kokoro'
    ? { voice: KOKORO_VOICE, model: KOKORO_MODEL_ID, speed: KOKORO_LIBRARY_SPEED }
    : { voice: ELEVEN_VOICE_NAME, model: ELEVEN_MODEL_ID, speed: 1.0 };
}

/** Whether a specific engine can run right now, independent of the default. */
export function engineAvailable(engine: TTSEngine): boolean {
  return engine === 'kokoro' ? true : Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Flash v2.5 takes 40k characters per request; the longest library entry is
 *  ~13.7k. Kokoro has no request ceiling — it chunks internally — but the same
 *  bound is kept so a runaway input fails the same way on either engine. */
export const MAX_TTS_CHARS = 38_000;

/** Raw 16-bit LE mono, the format StreamingPCMPlayer on iOS consumes directly.
 *  Kokoro emits at this rate natively, so no resampling on either path. */
export const STREAM_SAMPLE_RATE = 24_000;

/**
 * ElevenLabs keeps the original 5 minutes — a request hanging longer than that
 * is a network problem worth failing on. Kokoro gets much longer: it renders at
 * roughly 60 chars/sec, so the longest library entry (~13.7k chars) needs ~4
 * minutes on an idle box and more when a story pass is also running. Two
 * entries failed at the 5-minute mark during the first batch; there is no cost
 * to waiting on a local render, only to giving up on one.
 */
const TIMEOUT_KOKORO_MS = 900_000;
const TIMEOUT_ELEVEN_MS = 300_000;

export class TTSNotConfiguredError extends Error {
  constructor(detail = 'ELEVENLABS_API_KEY not set') {
    super(detail);
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
  // Kokoro needs no key. If the service is down the request fails loudly at
  // call time, which is better than reporting "not configured" for something
  // that has no configuration to get wrong.
  if (ENGINE === 'kokoro') return true;
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function guard(text: string, engine: TTSEngine = ENGINE): void {
  if (!engineAvailable(engine)) throw new TTSNotConfiguredError();
  if (text.length > MAX_TTS_CHARS) throw new TTSTooLongError(text.length);
}

async function postKokoro(text: string, format: 'pcm' | 'mp3', speed: number): Promise<Response> {
  const res = await fetch(KOKORO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: KOKORO_VOICE, format, speed }),
    signal: AbortSignal.timeout(TIMEOUT_KOKORO_MS),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Kokoro HTTP ${res.status}: ${detail}`);
  }
  return res;
}

async function postElevenLabs(url: string, text: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      Accept: accept,
    },
    body: JSON.stringify({ text, model_id: ELEVEN_MODEL_ID, voice_settings: VOICE_SETTINGS }),
    signal: AbortSignal.timeout(TIMEOUT_ELEVEN_MS),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs HTTP ${res.status}: ${detail}`);
  }
  return res;
}

/**
 * Whole-file synthesis — used when banking a library entry to disk.
 *
 * The engine is a per-call argument rather than the module default because the
 * library now mixes both tiers on purpose (2026-08-08): a fresh entry Matt taps
 * within its first three days is rendered on ElevenLabs, everything the nightly
 * backfill picks up is Kokoro. Live phone streaming has no such split and keeps
 * using the default.
 */
export async function synthesizeMp3(text: string, engine: TTSEngine = ENGINE): Promise<Buffer> {
  guard(text, engine);
  const res =
    engine === 'kokoro'
      ? await postKokoro(text, 'mp3', KOKORO_LIBRARY_SPEED)
      : await postElevenLabs(`${BASE_URL}/${VOICE_ID}?output_format=mp3_44100_128`, text, 'audio/mpeg');

  const mp3 = Buffer.from(await res.arrayBuffer());
  if (mp3.length === 0) throw new Error(`${engine} returned empty audio`);
  return mp3;
}

/**
 * Streaming synthesis as raw PCM, for live playback on the phone. Returns the
 * upstream body so the caller can pipe it straight through without buffering —
 * audio starts on the first packet instead of after the whole generation.
 */
export async function synthesizeStreamPcm(text: string): Promise<ReadableStream<Uint8Array>> {
  guard(text);
  const res =
    ENGINE === 'kokoro'
      ? await postKokoro(text, 'pcm', KOKORO_STREAM_SPEED)
      : await postElevenLabs(
          `${BASE_URL}/${VOICE_ID}/stream?output_format=pcm_${STREAM_SAMPLE_RATE}`,
          text,
          'audio/pcm'
        );

  if (!res.body) throw new Error(`${ENGINE} returned no stream body`);
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
