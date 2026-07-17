# Phase 1 Runbook — Move lucid-agent from Railway to the Falcon

**Goal:** run the existing lucid-agent Node app on the Falcon behind a Cloudflare
tunnel, point the iOS app at it, and shut down Railway. Nothing else changes:
same code, same Supabase database, same Dispatch push notifications. This is a
lift-and-shift — the app doesn't know it moved.

**End state:**

```
iOS app ──HTTPS──▶ Cloudflare tunnel (lucid.<your-domain>)
                        │
                        ▼
                  Falcon: node dist/index.js  (port 4000)
                        │
                        ▼
                  Supabase (unchanged, Phase 2 moves this)
```

**Savings:** $20/mo (Railway). Supabase is untouched until Phase 2.

**Estimated time:** 1–2 hours, most of it verification.

---

## 0. Prerequisites

- [ ] Falcon has **Node 20 LTS or newer** (`node --version`) and git.
- [ ] `cloudflared` is already running on the Falcon for Major Domo (we'll add
      a hostname to it, not build anything new).
- [ ] You can log into the Railway dashboard (to copy env values, and later to
      stop the service).
- [ ] Pick the public hostname now, e.g. `lucid.<your-domain>`.
- [ ] Confirm port `4000` is free on the Falcon (`lsof -i :4000`). If Major
      Domo or anything else owns it, pick another port and use it consistently
      below.

---

## 1. Copy the environment out of Railway

In the Railway dashboard → lucid-agent service → **Variables**, copy the values
for every variable below into a scratch note (you'll paste them into the
Falcon's `.env` in step 3). This is the complete list the app reads:

**Required (app refuses to boot without these):**

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | unchanged — still pointing at the Lucid-Agent project |
| `SUPABASE_SERVICE_KEY` | unchanged |
| `DATABASE_URL` | unchanged |
| `ANTHROPIC_API_KEY` | chat + all LLM work |
| `OPENAI_API_KEY` | embeddings. Copy it fresh from the OpenAI dashboard, not from Railway — the embedding outage since ~Jul 2 is suspected to be a Railway-side env problem, and this move is our chance to prove it |

**Strongly recommended:**

| Variable | Notes |
|---|---|
| `LUCID_API_TOKEN` | **Do not leave this unset.** On Railway an unset token meant "unauthenticated but obscure URL." Behind your own tunnel the API is still on the public internet — generate one now (`openssl rand -hex 32`) if it isn't already set. The iOS app must send it as `Authorization: Bearer <token>`. |
| `PORT` | `4000` (or your chosen port) |
| `NODE_ENV` | `production` |
| `TZ` | `America/Chicago` — Railway containers ran UTC; the cron loops (daily scheduler, self-review) fire on the system clock, so pin the timezone explicitly rather than inheriting whatever the Falcon is set to |

**Feature toggles — replicate Railway's current live state:**

| Variable | Current Railway value | Notes |
|---|---|---|
| `ENABLE_SELF_REVIEW` | `true` | the only loop currently live |
| `ENABLE_AUTONOMOUS_AGENTS` | `false` | circadian loops + conversation review — the Falcon's own loops cover this |
| `ENABLE_WEB_RESEARCH` | `false` | |
| `ENABLE_FACT_EXTRACTION` | (unset = on) | copy whatever Railway has |
| `ENABLE_EMBEDDING_BACKFILL` | (unset = on) | leave on — it heals the NULL-embedding rows |

> ⚠️ **For first boot on the Falcon, set `ENABLE_SELF_REVIEW=false` temporarily.**
> While Railway and the Falcon run in parallel (step 7), any loop enabled on
> both fires twice — two self-review PRs, duplicate push notifications from the
> dispatch loop. Flip it back to `true` only after Railway is stopped.

**Optional (copy if present on Railway):**

| Variable | Used for |
|---|---|
| `DISPATCH_API_URL` / `DISPATCH_APP_KEY` / `DISPATCH_SENDER_ID` | push notifications — required if you want pushes to keep working |
| `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` | self-review PRs |
| `TAVILY_API_KEY` | web search + `read_webpage` |
| `YOUTUBE_API_KEY` | `watch_youtube_video` |
| `GROK_API_KEY`, `ALPHA_VANTAGE_API_KEY` | grok / market data services |
| `STUDIO_API_URL` / `STUDIO_APP_KEY` | studio session validation |
| `ANTHROPIC_MODEL`, `EMBEDDING_MODEL`, cron overrides, library tuning vars | only if Railway overrides the defaults |

---

## 2. Clone and build on the Falcon

```bash
cd ~   # or wherever you keep services on the Falcon
git clone https://github.com/mattdarbro/lucid-agent.git
cd lucid-agent
npm ci
npm run build
```

`npm run build` runs `tsc` and produces `dist/`. Any build error stops here —
nothing is live yet.

---

## 3. Create the `.env`

```bash
cd ~/lucid-agent
touch .env
chmod 600 .env   # readable only by your user
```

Paste in the variables from step 1. The file lives only on the Falcon — it is
already gitignored, and `chmod 600` keeps other local accounts out. That's the
whole ".env housing" story: your box, your file.

---

## 4. First boot and local verification

Run it in the foreground first:

```bash
npm start
```

Watch the startup log for:

- [ ] No `Configuration errors` (missing required vars throw immediately).
- [ ] **No warning about `LUCID_API_TOKEN` being unset.** If you see that
      warning, stop and set the token before exposing this to the tunnel.
- [ ] Background jobs report the toggle state you expect.

Then from another Falcon terminal:

```bash
# Health (no auth) — proves the app is up AND can reach Supabase (it runs SELECT 1)
curl -s http://localhost:4000/health

# Auth is enforced — should be 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/v1/conversations

# Auth works — should be 200
curl -s -H "Authorization: Bearer $LUCID_API_TOKEN" http://localhost:4000/v1/conversations

# The real thing — a chat turn (this spends a small amount of Anthropic money)
curl -s -X POST http://localhost:4000/v1/chat \
  -H "Authorization: Bearer $LUCID_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hey Lucid — you are running on the Falcon right now. First boot. How does it feel?"}'
```

**Embedding check** (did moving off Railway fix the outage?): after that chat
turn, run against the database:

```sql
SELECT id, created_at, embedding IS NULL AS missing
FROM messages ORDER BY created_at DESC LIMIT 4;
```

`missing = false` on the fresh rows means the outage really was Railway-side
and it's over. If they're still NULL, the OpenAI key itself is the problem —
the app still works either way (search falls back to keyword), but note it for
follow-up.

Stop the foreground process (Ctrl-C) once everything passes.

---

## 5. Run it as a service

Use pm2 — it works the same on macOS and Linux and survives reboots:

```bash
npm install -g pm2
cd ~/lucid-agent
pm2 start dist/index.js --name lucid --time
pm2 save
pm2 startup   # prints one command to copy/paste — makes pm2 start on boot
```

Day-to-day: `pm2 logs lucid`, `pm2 restart lucid`, `pm2 status`.

Deploying an update later:

```bash
cd ~/lucid-agent && git pull && npm ci && npm run build && pm2 restart lucid
```

*(If you'd rather use launchd/systemd directly, that's fine — the only
requirements are "restart on crash" and "start on boot.")*

---

## 6. Add the hostname to your Cloudflare tunnel

Same pattern as Major Domo — one new ingress rule on the tunnel you already run.

**If the tunnel is configured in the Cloudflare dashboard** (Zero Trust →
Networks → Tunnels → your tunnel → Public Hostname): add a public hostname
`lucid.<your-domain>` → service `http://localhost:4000`. Done — DNS is created
automatically.

**If it's configured by file** (`~/.cloudflared/config.yml`), add the rule
above the catch-all:

```yaml
ingress:
  - hostname: lucid.<your-domain>
    service: http://localhost:4000
  # ... existing Major Domo rules ...
  - service: http_status:404
```

Then create the DNS route and restart cloudflared:

```bash
cloudflared tunnel route dns <TUNNEL-NAME> lucid.<your-domain>
# restart however cloudflared runs on the Falcon (launchctl/systemctl/pm2)
```

**Verify from your phone on cellular** (not your home wifi — that proves the
public path):

```bash
curl -s https://lucid.<your-domain>/health
curl -s -H "Authorization: Bearer <token>" https://lucid.<your-domain>/v1/conversations
```

---

## 7. Point the iOS app at the Falcon

Two changes in the app:

1. **Base URL** → `https://lucid.<your-domain>` (wherever the Railway URL is
   configured today).
2. **Auth header** → make sure every request sends
   `Authorization: Bearer <LUCID_API_TOKEN>`. If the app never shipped the
   header (the token was unset on Railway), this is the moment it becomes
   mandatory.

One iOS caveat from CLAUDE.md still applies: if the app sends an explicit
`model` field in chat requests, it overrides the server default — it should
omit `model` to get whatever the server is configured for.

Rebuild, install on your phone, and use Lucid normally for a bit: chat, open
the Library, check facts. Both servers point at the same Supabase database, so
the parallel period is safe — the only hazard is the duplicate-cron issue,
which is why the Falcon's `ENABLE_SELF_REVIEW` is still `false`.

---

## 8. Cut over and decommission Railway

Once the app has run through the Falcon happily for a day or two:

1. **Stop the Railway service** (dashboard → service → remove/stop deployment).
   Don't delete the project yet — it's your rollback for a week.
2. On the Falcon, set `ENABLE_SELF_REVIEW=true` in `.env` and
   `pm2 restart lucid`. The weekly self-review now runs from the Falcon.
3. Watch for the next scheduled events: notification dispatch (every 3 min,
   only matters when a notification is pending), embedding backfill (15 min),
   self-review (Thursday). `pm2 logs lucid` shows them firing.
4. After a clean week: **delete the Railway project**. The $20/mo stops.

**Rollback at any point before deletion:** redeploy on Railway, point the iOS
base URL back, set the Falcon's toggles to `false`. Because the database never
moved, rollback is purely a routing change — no data is stranded.

---

## Final verification checklist

- [ ] `https://lucid.<your-domain>/health` returns ok from cellular
- [ ] Unauthenticated `/v1/*` request returns 401
- [ ] Chat works end-to-end from the iOS app
- [ ] Fresh messages have non-NULL embeddings (or the outage is noted as key-side)
- [ ] Push notifications still arrive (Dispatch vars copied, dispatch loop logging)
- [ ] `pm2 status` shows lucid online; survives a Falcon reboot
- [ ] Railway service stopped; only then `ENABLE_SELF_REVIEW=true` on the Falcon
- [ ] Self-review fires Thursday from the Falcon (check for its PR)
- [ ] Railway project deleted after a clean week

---

## What this phase deliberately does NOT touch

- **Supabase** — the Lucid-Agent project stays exactly as-is. Moving the
  database onto the Falcon (and closing the Supabase project) is Phase 2.
- **The Falcon's own Claude Code loops** — unchanged, separate from this app.
- **App behavior** — same code, same models, same prompts. If Lucid feels
  different after the move, something in the env differs; diff `.env` against
  the Railway variables list.

## Known gotchas

- **Home-network reality:** the Falcon going down now takes Lucid's API with
  it. Cloudflare will return 502s while the tunnel is down; the iOS app should
  fail gracefully (it already handles Railway outages the same way).
- **Two runners, one database:** any overlap window where a cron toggle is
  `true` on both hosts produces duplicates (the July curiosity-loop dupes were
  exactly this). The runbook sequences around it; if you see double Library
  entries or double pushes, check toggles on both hosts first.
- **Egress now comes from your home IP:** Anthropic/OpenAI/Tavily calls
  originate from the Falcon. No action needed, just worth knowing when reading
  API dashboards.
