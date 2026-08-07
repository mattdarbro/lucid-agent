import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { z } from 'zod';
import { logger } from '../logger';
import {
  synthesizeStreamPcm,
  synthesizeMp3,
  preprocessForTTS,
  isConfigured,
  TTSNotConfiguredError,
  TTSTooLongError,
  STREAM_SAMPLE_RATE,
  VOICE_NAME,
  MODEL_ID,
  MAX_TTS_CHARS,
} from '../services/tts.service';

const router = Router();

const speakSchema = z.object({
  text: z.string().min(1),
  format: z.enum(['pcm', 'mp3']).optional().default('pcm'),
});

/**
 * POST /v1/tts
 *
 * Speak arbitrary text in Lucid's voice. The phone posts here instead of
 * calling ElevenLabs directly, so the API key stays on falcon and the voice is
 * configured in exactly one place.
 *
 * format=pcm (default) streams raw 16-bit LE mono at STREAM_SAMPLE_RATE for
 * StreamingPCMPlayer — playback starts on the first packet. format=mp3 returns
 * a complete file for AVAudioPlayer.
 *
 * Library entries do NOT use this — they are banked to disk and served by
 * GET /v1/library/:id/audio so replays cost nothing.
 */
router.post('/', async (req: Request, res: Response) => {
  const parsed = speakSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  const text = preprocessForTTS(parsed.data.text);
  if (text.length === 0) {
    return res.status(400).json({ error: 'No speakable text' });
  }

  try {
    if (parsed.data.format === 'mp3') {
      const mp3 = await synthesizeMp3(text);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(mp3.length));
      return res.end(mp3);
    }

    const upstream = await synthesizeStreamPcm(text);
    res.setHeader('Content-Type', 'audio/L16');
    res.setHeader('X-Sample-Rate', String(STREAM_SAMPLE_RATE));
    res.setHeader('Cache-Control', 'no-store');

    logger.info(`[TTS] Streaming ${text.length} chars (${VOICE_NAME}/${MODEL_ID})`);

    const node = Readable.fromWeb(upstream as any);
    // A client that hangs up mid-sentence should stop the generation too.
    res.on('close', () => node.destroy());
    node.on('error', (err: any) => {
      logger.error('[TTS] Stream error', { error: err.message });
      if (!res.headersSent) res.status(502).json({ error: 'TTS stream failed' });
      else res.end();
    });
    node.pipe(res);
  } catch (err: any) {
    if (err instanceof TTSNotConfiguredError) {
      return res.status(503).json({ error: err.message, code: 'not_configured' });
    }
    if (err instanceof TTSTooLongError) {
      return res.status(413).json({ error: err.message, code: 'too_long', limit: MAX_TTS_CHARS });
    }
    logger.error('[TTS] Synthesis failed', { error: err.message });
    return res.status(502).json({ error: 'TTS synthesis failed', details: err.message });
  }
});

/**
 * GET /v1/tts/voice
 *
 * What voice the app is about to hear, so it can label the UI without
 * hardcoding a second copy of the config.
 */
router.get('/voice', (_req: Request, res: Response) => {
  res.json({
    voice: VOICE_NAME,
    model: MODEL_ID,
    sample_rate: STREAM_SAMPLE_RATE,
    max_chars: MAX_TTS_CHARS,
    configured: isConfigured(),
  });
});

export default router;
