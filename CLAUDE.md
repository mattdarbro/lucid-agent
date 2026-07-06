# CLAUDE.md — Working memory for Lucid

This file is read first in any session. It records decisions and their *why* so
context isn't lost between sessions.

## Lucid's voice & models (current state as of 2026-07-01)

- **Deployment topology (important).** Lucid's intelligence is split across two
  hosts: **Railway** runs this `lucid-agent` Node app; **the Falcon** is a
  Claude Code server doing some of Lucid's agentic thinking. As of 2026-07-01
  **live chat + Library entries run on the Falcon**, and on Railway everything
  is toggled **off except the weekly self-review** (`ENABLE_SELF_REVIEW=true`).
  So the Railway chat path described below is **staged, not live** — the model
  settings here take effect only if/when chat is started up on Railway again.
  The reasoning depth of the *current* live chat is a Falcon (Claude Code)
  setting, not this repo.
- **Chat (Railway path)** runs on **Sonnet 5** with **adaptive thinking at
  `medium` effort**
  (validation default in `chat.validation.ts` + all profiles in
  `src/types/profiles.ts` + `chat.service.ts` DEFAULT_CONFIG). Matt wanted chat
  to reason a little more before replying — the fast/lean Sonnet 4.6 chat felt
  "a little too quick." Sonnet 5 keeps the reflective "Library voice" lineage
  and adds real reasoning; `medium` is the deliberate middle ground (more than
  the old no-thinking chat, less latency than `high`).
  - **Why the migration needed more than a string swap:** Sonnet 5 rejects
    non-default `temperature`/`top_p`/`top_k` (400) and removed the fixed
    `budget_tokens` thinking mode. `chat.service.ts` now drops temperature and
    turns on `thinking:{type:'adaptive'}` + `output_config:{effort:'medium'}`
    for the reasoning-model family (`claude-(opus-4-[78]|sonnet-5|fable-5)`),
    keeping the old temperature path for legacy models. `max_tokens` was raised
    (validation default 2000→8000, cap 4096→16000; profiles 600→8000) because
    adaptive-thinking tokens count toward `max_tokens` and would otherwise
    truncate the reply.
  - **SDK bump:** `@anthropic-ai/sdk` `0.68.0 → 0.109.0`. 0.68 predated adaptive
    thinking / `output_config`; without the bump the only way to reason on
    Sonnet 5 was to omit `thinking` (implicit `high` effort, not tunable).
  - **iOS caveat:** if the iOS client sends an explicit `model` in the chat
    request it overrides the server default — the app must omit `model` (or send
    `claude-sonnet-5`) to actually get Sonnet 5.
  - **Latency watch:** this reintroduces some per-turn thinking latency, the
    thing PR #164 removed. `medium` is the compromise; dial `effort` down (or to
    `low`) in `chat.service.ts` if iOS waits feel long again.
- **Deep work stays on Opus 4.8**: deep-thoughts (`thought.service.ts`) and the
  monthly self-review / code review (`self-review-loop.service.ts` `deepModel`).
  Background loops (autonomous synthesis, versus, summaries, research,
  state-check, quick self-review) are still on **Sonnet 4.6** — deliberately not
  migrated in this pass (Matt scoped it to chat only).
- **Word cap removed.** There used to be TWO muzzles: a "50-150 words" prompt
  rule AND a hard server-side `enforceWordLimit()` that truncated every reply
  mid-thought. Both are gone. Reply length is now bounded only by `max_tokens`
  (chat request default **8000**, schema max 16000). The core_identity prompt
  tells Lucid to "let your response find its own length."

## OPEN IDEA — reconnect the reasoning channel (DO NOT do yet)

**The problem Matt misses:** the in-chat moment where Lucid says *"I wrote more
about this in the Library"* and links to his own deeper reasoning. That phrase is
hardcoded in `thought.service.ts:515`, but **chat.service never calls
thought.service** — so it can NEVER fire from live chat today.

**Why it's disconnected:** PR #164 (`bfba76a`, "Strip chat path for speed")
removed the deep-thinking pipeline from chat because it made up to 5 LLM calls
per turn and caused **long iOS waits**. Chat is now: store → build prompt → one
call → reply.

**The real tension:** reconnecting the deep-thinking channel brings back the
"I wrote more in the Library" moment AND the latency #164 was created to kill.
These trade directly against each other.

**Matt's decision (2026-06-01):** live with the current fast/lean Lucid first
(Sonnet chat, no cap) and feel it for a while BEFORE reconnecting more. The long
waits were the original pain — don't reintroduce them casually.

**If/when we do reconnect, design notes:**
- Don't restore the full pre-#164 5-call path. Instead make depth *selective*:
  only trigger deep-thinking when a message genuinely warrants it (a triage
  signal), not every turn.
- Consider doing it ASYNC: reply fast in chat now, generate the deep entry in
  the background, then surface "I wrote more about this" via a follow-up
  message / push notification once it's ready — so Matt never waits mid-chat.
- `conversation-review.service.ts` already writes Library entries ~30 min after a
  conversation goes idle, but silently and in **Haiku's** voice. An alternative
  is to upgrade that path (better model, in-chat notification) rather than
  rebuilding the synchronous pipeline.

## Embedding outage + Library blindness (found 2026-07-06)

- **What happened:** every library entry and chat message written via the
  Railway app since ~2026-07-02 has `embedding = NULL` — OpenAI embedding
  calls fail and every write path swallows the error with a `logger.warn`.
  Falcon-written entries (`metadata.source = 'falcon'`) kept getting
  embeddings, so the break is Railway-side env/infra, not the OpenAI account
  (Matt verified the key; ada-002 is NOT retired on OpenAI's platform, only
  Azure's). Timing matches the 2026-07-01 Falcon-migration env reshuffle.
  Matt re-copied the key 2026-07-06; verify by checking `embedding IS NULL`
  on a fresh message.
- **Why it blinded chat:** `search_library` embedded the *query* first, so an
  OpenAI failure hard-failed the whole tool → Lucid told Matt he couldn't
  access the Library at all. NULL-embedding rows were also invisible forever.
- **Fixes (2026-07-06):** `search_library`/`search_conversations` are hybrid
  (vector + ILIKE keyword fallback, never hard-fail); new
  `get_recent_library_entries` tool (no embedding dependency); backfill job
  re-embeds NULL rows every 15 min (`ENABLE_EMBEDDING_BACKFILL=false` to
  disable); `GET /v1/library/search` moved above `/:id` (was unreachable);
  PATCH re-embeds on edit.

## Env toggles are now real kill switches (2026-07-06)

- Until now `ENABLE_AUTONOMOUS_AGENTS` / `ENABLE_WEB_RESEARCH` were read into
  config but **never checked** — the only gate was the per-user profile in
  `user_profiles` (Matt's says `autonomousAgents: true`), which is why turning
  everything off in Railway variables didn't stop the daily briefings /
  curiosity / consolidation entries.
- Now enforced server-side in `background-jobs.service.ts` +
  `agent-job.service.ts`: `ENABLE_AUTONOMOUS_AGENTS` gates the circadian
  loops AND conversation review; `ENABLE_SELF_REVIEW` gates self-review
  independently (runs through the same job runner); `ENABLE_WEB_RESEARCH`
  gates the research executor; `ENABLE_FACT_EXTRACTION=false` opts out of
  fact extraction (default on — it's memory infra for chat, not a voice).
- **The Falcon's loops are separate.** Its entries (`source: falcon`) come
  from the Claude Code server, not this repo — Railway variables can never
  stop those; they have to be disabled on the Falcon itself. Note: since
  ~Jul 2 the Falcon and Railway were BOTH running curiosity/briefing loops,
  writing near-duplicate entries a minute apart.

## Reading websites + YouTube (added 2026-07-06)

- New chat tools in `lucid-tools.service.ts` → `content-reader.service.ts`:
  `read_webpage` (Tavily extract when `TAVILY_API_KEY` set, direct fetch
  fallback, SSRF-guarded) and `watch_youtube_video` (metadata via YouTube
  **Data API v3** when `YOUTUBE_API_KEY` is set — never bot-walled; else
  Innertube/watch-page scrape; oEmbed as the always-works floor; transcript
  from caption tracks, best-effort since YouTube bot-walls datacenter IPs).
- **YouTube key note:** the *Analytics* API Matt enabled is the wrong one
  (OAuth-only, own-channel stats). `watch_youtube_video` needs **YouTube
  Data API v3** enabled + a plain API key in `YOUTUBE_API_KEY`. No OAuth
  token required.

## API auth (added 2026-06-10)

- The API now requires `Authorization: Bearer <LUCID_API_TOKEN>` on everything
  except `/` and `/health` (`src/middleware/auth.ts`). **Enforcement is off
  until the env var is set** — unset token = unauthenticated with a startup
  warning, so deploys can't brick the iOS app before it ships the token.
- **TODO to actually lock the door:** generate a token (`openssl rand -hex 32`),
  set `LUCID_API_TOKEN` on Railway, and add the header to the iOS client.
- Rate limits: 600 req/15min on `/v1`, 60 req/5min on `/v1/chat` and
  `/v1/versus` (the endpoints that spend LLM money).
- Context: there is no per-user layer behind this (Supabase service key, no
  RLS). The bearer token IS the trust boundary — fine for a single-user app.

## Git / workflow notes
- Active feature branch convention: `claude/...`. Default branch is `main`.
- The model identifier the assistant runs on must NOT appear in commits/PRs.
