/**
 * Pre-generate narration for the whole library.
 *
 * Run:  nice -n 15 npx tsx scripts/narrate-library.ts [--concurrency 3] [--limit N] [--dry-run]
 *
 * This exists because narration became free. On ElevenLabs the archive was
 * ~4.5M credits, so audio was banked only for entries Matt actually opened;
 * with the local Kokoro engine there is no reason not to have all of it ready.
 *
 * Resume-safety is not implemented here on purpose — it comes from
 * ensureAudio(), which already skips any entry whose banked MP3 matches the
 * current content hash and GENERATION_VERSION. Re-running after a crash, a
 * reboot, or a Ctrl-C simply re-walks the list and regenerates only what is
 * missing. That also means a GENERATION_VERSION bump turns this into a full
 * re-narration pass with no extra flag.
 */

import 'dotenv/config';
import { pool } from '../src/db';
import { getLibraryAudio, AudioUnavailableError } from '../src/services/library-audio.service';
import { ENGINE, VOICE_NAME, MODEL_ID, LIBRARY_SPEED } from '../src/services/tts.service';
import { PREMIUM_WINDOW_DAYS } from '../src/services/library-audio.service';

interface Args {
  concurrency: number;
  limit: number | null;
  maxNew: number | null;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    concurrency: Math.max(1, Number(get('--concurrency') ?? 1)),
    limit: get('--limit') ? Number(get('--limit')) : null,
    // --limit caps how many entries are *considered* (already-banked ones are
    // skipped instantly, so it would keep re-scanning the same head of the
    // list). --max-new caps how many are actually synthesized, which is what a
    // nightly slice wants.
    maxNew: get('--max-new') ? Number(get('--max-new')) : null,
    dryRun: argv.includes('--dry-run'),
  };
}

function hms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Newest first, because that is the order the library is actually read. The
  // backfill takes about a month, so ordering it oldest-first would leave every
  // recent entry — the ones most likely to be opened — waiting the longest,
  // each one paying an on-demand render on tap. This way the queue converges on
  // what gets used, and the tail is old material nobody is waiting on.
  // Entries inside the premium window are skipped entirely (2026-08-08). Their
  // first few days are Matt's to claim in Kieron; if he doesn't, they fall
  // through to a later night's slice and get the free voice like everything
  // else. ensureAudio enforces the same rule, so this is only here to keep the
  // slice from spending its quota on entries it will refuse anyway.
  const { rows } = await pool.query<{ id: string; chars: number }>(
    `SELECT id, length(content) AS chars
       FROM library_entries
      WHERE content IS NOT NULL AND length(trim(content)) > 0
        AND created_at < now() - ($1 || ' days')::interval
      ORDER BY created_at DESC
      ${args.limit ? `LIMIT ${args.limit}` : ''}`,
    [String(PREMIUM_WINDOW_DAYS)]
  );

  const totalChars = rows.reduce((n, r) => n + Number(r.chars), 0);
  console.log(
    `[narrate-library] ${rows.length} entries, ${totalChars.toLocaleString()} chars\n` +
      `[narrate-library] engine=${ENGINE} voice=${VOICE_NAME} model=${MODEL_ID} ` +
      `speed=${LIBRARY_SPEED} concurrency=${args.concurrency}`
  );
  if (ENGINE !== 'kokoro') {
    console.error(
      `[narrate-library] REFUSING: engine is "${ENGINE}", not kokoro. A full pass on a paid ` +
        `engine would cost roughly ${totalChars.toLocaleString()} credits. ` +
        `Set LUCID_TTS_ENGINE=kokoro, or narrate individual entries on demand instead.`
    );
    process.exitCode = 1;
    return;
  }
  if (args.dryRun) {
    console.log('[narrate-library] --dry-run: nothing synthesized');
    return;
  }

  const audio = getLibraryAudio();
  const started = Date.now();
  let generated = 0;
  let cached = 0;
  let done = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  // Set by SIGINT/SIGTERM: stop handing out new work, let in-flight finish so
  // no entry is left with a half-written MP3.
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      console.log(`\n[narrate-library] ${sig} — finishing in-flight entries, then stopping.`);
    });
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (!stopping) {
      // Checked before claiming an index so workers stop together rather than
      // each starting one more entry past the quota.
      if (args.maxNew !== null && generated >= args.maxNew) return;
      const index = cursor++;
      if (index >= rows.length) return;
      const { id } = rows[index];
      try {
        const res = await audio.ensureAudio(id, 'backfill');
        res.cached ? cached++ : generated++;
      } catch (err: any) {
        const reason =
          err instanceof AudioUnavailableError ? `${err.code}: ${err.message}` : String(err?.message ?? err);
        failures.push({ id, reason });
      }
      done++;

      if (generated > 0 && (generated % 10 === 0 || done === rows.length)) {
        const elapsed = (Date.now() - started) / 1000;
        // Rate is measured over entries actually synthesized; cached ones return
        // instantly and would otherwise inflate the estimate into nonsense.
        const rate = generated > 0 ? elapsed / generated : 0;
        const remaining = rows.length - done;
        console.log(
          `[narrate-library] ${done}/${rows.length}  ` +
            `new=${generated} cached=${cached} failed=${failures.length}  ` +
            `elapsed=${hms(elapsed)} eta=${rate ? hms(remaining * rate) : '--:--'}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `\n[narrate-library] ${stopping ? 'STOPPED EARLY' : 'COMPLETE'} in ${hms(elapsed)}\n` +
      `  generated : ${generated}\n` +
      `  cached    : ${cached}\n` +
      `  failed    : ${failures.length}`
  );
  if (failures.length) {
    console.log('\n  failures (re-run to retry — successes are skipped):');
    for (const f of failures.slice(0, 40)) console.log(`    ${f.id}  ${f.reason}`);
    if (failures.length > 40) console.log(`    ... and ${failures.length - 40} more`);
  }

  const remaining = await pool.query<{ n: string }>(
    `SELECT count(*) AS n
       FROM library_entries
      WHERE content IS NOT NULL AND length(trim(content)) > 0
        AND coalesce(metadata->'audio'->>'status', '') <> 'ready'`
  );
  console.log(`  still to do: ${remaining.rows[0].n} entries`);

  await pool.end();

  // A nightly slice finishing its quota is success, and individual failures get
  // retried on the next pass, so neither should page anyone. Only a run that
  // was interrupted, or one where nothing at all succeeded, is unhealthy.
  const totalFailure = failures.length > 0 && generated === 0;
  process.exitCode = stopping || totalFailure ? 1 : 0;
}

main().catch((err) => {
  console.error('[narrate-library] fatal:', err);
  process.exit(1);
});
