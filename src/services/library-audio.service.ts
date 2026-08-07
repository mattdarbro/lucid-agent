import { Pool } from 'pg';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool as sharedPool } from '../db';
import {
  synthesizeMp3,
  preprocessForTTS,
  isConfigured,
  VOICE_NAME,
  MODEL_ID,
  MAX_TTS_CHARS,
} from './tts.service';
import { logger } from '../logger';

/**
 * LibraryAudioService
 *
 * Narration audio for library entries, generated ON DEMAND and banked forever.
 *
 * The first time the phone asks for an entry's audio we synthesize it with
 * ElevenLabs and write the MP3 to AUDIO_DIR; every later play streams that same
 * file straight off disk for free. Nothing sweeps the backlog in the background
 * — the archive is 4.5M characters and pre-generating all of it would cost
 * several months of the ElevenLabs allocation, so we only ever pay for entries
 * Matt actually listens to.
 *
 * Entries are re-synthesized only when the content changes (hash mismatch) or
 * GENERATION_VERSION is bumped (voice/model change).
 *
 * metadata.audio = { status, url, duration_sec, size_bytes, voice, model,
 *                    generation_version, content_hash, generated_at,
 *                    last_error?, last_attempt_at? }
 */

export const AUDIO_DIR = process.env.LIBRARY_AUDIO_DIR || '/home/matt/lucid_media/library';

// Bump to invalidate every banked MP3 (voice or model change).
// 1 = Gemini / Enceladus (retired 2026-08-06), 2 = ElevenLabs / Kieron.
const GENERATION_VERSION = 2;

interface EntryRow {
  id: string;
  content: string | null;
  metadata: any;
}

export interface AudioResult {
  path: string;
  cached: boolean;
}

export type AudioFailureCode =
  | 'not_found'
  | 'not_speakable'
  | 'too_long'
  | 'not_configured'
  | 'synthesis_failed';

export class AudioUnavailableError extends Error {
  code: AudioFailureCode;
  constructor(code: AudioFailureCode, message: string) {
    super(message);
    this.name = 'AudioUnavailableError';
    this.code = code;
  }
}

export class LibraryAudioService {
  private pool: Pool;
  /** Concurrent requests for the same entry share one synthesis. */
  private inFlight = new Map<string, Promise<AudioResult>>();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  start(): void {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    if (!isConfigured()) {
      logger.warn('[LIBRARY-AUDIO] ELEVENLABS_API_KEY not set — narration will 503 until it is');
      return;
    }
    logger.info(
      `[LIBRARY-AUDIO] On-demand narration ready (${VOICE_NAME}/${MODEL_ID}, dir ${AUDIO_DIR})`
    );
  }

  stop(): void {
    // Nothing scheduled — kept so the shutdown path stays uniform.
  }

  /**
   * Return the banked MP3 for an entry, synthesizing it first if this is the
   * first play (or the content changed since it was banked).
   */
  async ensureAudio(entryId: string): Promise<AudioResult> {
    const existing = this.inFlight.get(entryId);
    if (existing) return existing;

    const { rows } = await this.pool.query<EntryRow>(
      'SELECT id, content, metadata FROM library_entries WHERE id = $1',
      [entryId]
    );
    const row = rows[0];
    if (!row) throw new AudioUnavailableError('not_found', 'Entry not found');

    const text = preprocessForTTS(row.content || '');
    if (text.length === 0) {
      throw new AudioUnavailableError('not_speakable', 'Entry has no speakable text');
    }

    const filePath = path.join(AUDIO_DIR, `${entryId}.mp3`);
    const hash = sha256Hex(row.content || '');
    const banked = row.metadata?.audio;
    const isFresh =
      banked?.status === 'ready' &&
      banked.content_hash === hash &&
      Number(banked.generation_version) === GENERATION_VERSION &&
      fs.existsSync(filePath);

    if (isFresh) return { path: filePath, cached: true };

    if (!isConfigured()) {
      throw new AudioUnavailableError('not_configured', 'ELEVENLABS_API_KEY not set');
    }
    if (text.length > MAX_TTS_CHARS) {
      throw new AudioUnavailableError(
        'too_long',
        `Entry is ${text.length} chars, over the ${MAX_TTS_CHARS} limit`
      );
    }

    const job = this.generate(entryId, text, hash, filePath).finally(() => {
      this.inFlight.delete(entryId);
    });
    this.inFlight.set(entryId, job);
    return job;
  }

  private async generate(
    entryId: string,
    text: string,
    hash: string,
    filePath: string
  ): Promise<AudioResult> {
    const started = Date.now();
    logger.info(`[LIBRARY-AUDIO] Synthesizing ${entryId} (${text.length} chars, ${VOICE_NAME})`);

    try {
      const mp3 = await synthesizeMp3(text);
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, mp3);
      fs.renameSync(tmpPath, filePath);

      const sizeBytes = mp3.length;
      const durationSec = await probeDuration(filePath);

      await this.writeAudioMetadata(entryId, {
        status: 'ready',
        url: `/v1/library/${entryId}/audio`,
        duration_sec: durationSec,
        size_bytes: sizeBytes,
        voice: VOICE_NAME,
        model: MODEL_ID,
        generation_version: GENERATION_VERSION,
        content_hash: hash,
        generated_at: new Date().toISOString(),
      });

      logger.info(
        `[LIBRARY-AUDIO] Banked ${entryId}: ${durationSec}s, ${Math.round(sizeBytes / 1024)}KB, ` +
          `${Math.round(text.length / 2)} credits, ${Math.round((Date.now() - started) / 1000)}s`
      );

      return { path: filePath, cached: false };
    } catch (err: any) {
      logger.error(`[LIBRARY-AUDIO] Failed ${entryId}`, { error: err.message });
      await this.writeAudioMetadata(entryId, {
        status: 'failed',
        last_error: String(err.message).slice(0, 300),
        last_attempt_at: new Date().toISOString(),
        generation_version: GENERATION_VERSION,
      }).catch(() => {});
      throw new AudioUnavailableError('synthesis_failed', err.message);
    }
  }

  private async writeAudioMetadata(id: string, audio: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE library_entries
       SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{audio}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(audio), id]
    );
  }
}

let instance: LibraryAudioService | null = null;

/** Shared instance — both server startup and the audio route use this one. */
export function getLibraryAudio(): LibraryAudioService {
  if (!instance) instance = new LibraryAudioService(sharedPool);
  return instance;
}

// --- helpers ---

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Duration in whole seconds via ffprobe; 0 if it can't be read. */
function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let out = '';
    ff.stdout.on('data', (d) => (out += d.toString()));
    ff.on('error', () => resolve(0));
    ff.on('close', () => {
      const seconds = parseFloat(out.trim());
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : 0);
    });
  });
}

/**
 * The iOS app only routes playback to the server when metadata.audio.status is
 * "ready" (see LibraryEntry+Audio.swift), so with on-demand banking an entry
 * that has never been played would advertise nothing and the app would fall
 * back to on-device TTS — and never reach ElevenLabs at all.
 *
 * So advertise every speakable entry as playable. The URL is real: hitting it
 * synthesizes and banks on the spot. Entries already banked and fresh are left
 * exactly as they are, so their real generated_at keeps keying the phone cache.
 */
export function advertiseAudio<T extends { id: string; content?: string | null; metadata?: any }>(
  entry: T
): T {
  const content = entry.content || "";
  const text = preprocessForTTS(content);
  if (text.length === 0 || text.length > MAX_TTS_CHARS) return entry;

  const hash = sha256Hex(content);
  const banked = entry.metadata?.audio;
  if (
    banked?.status === "ready" &&
    banked.content_hash === hash &&
    Number(banked.generation_version) === GENERATION_VERSION
  ) {
    return entry;
  }

  return {
    ...entry,
    metadata: {
      ...(entry.metadata || {}),
      audio: {
        status: "ready",
        url: `/v1/library/${entry.id}/audio`,
        banked: false,
        voice: VOICE_NAME,
        model: MODEL_ID,
        generation_version: GENERATION_VERSION,
        // Stable per content, so the phone re-downloads only after an edit.
        generated_at: `pending-${hash.slice(0, 16)}`,
      },
    },
  };
}
