# iOS Brief — Point the Lucid app at the Falcon

**Audience:** iOS team
**What this is:** the Lucid backend is moving off Railway to a self-hosted box
("the Falcon") behind a Cloudflare tunnel. **Same code, same database, same API.**
The only things that change in the app are the **base URL** and the **auth header**.
No data migration, no endpoint changes, no request/response shape changes.

---

## TL;DR — two changes

1. **Base URL** → `https://lucid.loopsymphony.com`
   (replace the current Railway base URL wherever it's configured).
2. **Auth header on every request** → `Authorization: Bearer <LUCID_API_TOKEN>`.

That's it. Everything under `/v1/*` is identical to today.

> ⚠️ **The auth header is the one that will bite us.** On Railway the API token
> was not enforced, so the app may not be sending an `Authorization` header at
> all. The Falcon **enforces** it: any `/v1/*` request without a valid Bearer
> token gets **`401 Unauthorized`**. If chat/library/facts suddenly 401 after
> the base-URL swap, it's a missing or wrong token — not a routing problem.

---

## The token

- Single shared secret, held by the app (Lucid is single-user).
- Sent as `Authorization: Bearer <token>` on **every** request to `/v1/*`.
- **Delivered out-of-band** (not in this doc / not in the repo). Matt will hand
  it over securely. Store it the way we store other client secrets — do **not**
  commit it.
- Comparison is exact and constant-time; a wrong token is a 401 with body
  `{"error":"Unauthorized","message":"Valid Bearer token required"}`.

---

## What does NOT need a token

`GET /health` and `GET /` are open (used for connectivity/health checks). Handy
for a reachability probe before showing a hard error:

```
GET https://lucid.loopsymphony.com/health   → 200 {"status":"ok","timestamp":"…"}
```

Everything else (`/v1/...`) requires the Bearer token.

---

## API surface — unchanged

Same routes, same prefixes as today. All live under `/v1`. Non-exhaustive, just
to confirm nothing moved:

```
/v1/chat            /v1/conversations       /v1/messages
/v1/library         /v1/facts               /v1/people
/v1/seeds           /v1/summaries           /v1/insights
/v1/devices         /v1/profiles            /v1/tasks
… (all existing /v1/* routes, identical paths and payloads)
```

**Chat caveat (unchanged, but worth re-confirming):** do **not** send an
explicit `model` field in chat requests. If the app sends `model`, it overrides
the server default. Omit it so the server picks the configured model.

---

## Quick verification (paste-and-run)

Replace `<token>` with the real value.

```bash
# 1. Reachable + DB healthy (no auth) — expect 200
curl -s https://lucid.loopsymphony.com/health

# 2. Auth is enforced — expect 401
curl -s -o /dev/null -w "%{http_code}\n" https://lucid.loopsymphony.com/v1/conversations

# 3. With the token — expect NOT 401 (200, or 404 on a list-less path — both mean auth passed)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <token>" \
  https://lucid.loopsymphony.com/v1/conversations

# 4. A real chat turn — expect 200 + a reply
curl -s -X POST https://lucid.loopsymphony.com/v1/chat \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"message":"Hey Lucid — testing the Falcon endpoint."}'
```

Do these from **cellular**, not home wifi, to prove the public path.

---

## Safe to ship anytime — it's reversible

- The Falcon and Railway point at the **same Supabase database**. During the
  overlap, whichever host the app talks to writes to the same data. No sync, no
  migration, nothing stranded.
- **Rollback = flip the base URL back to Railway.** Because the DB never moved,
  that's the entire rollback. (Railway stays running until the app is confirmed
  happy on the Falcon.)

---

## Coordination with Matt

1. Ship the base-URL + auth-header change (TestFlight/dev build is fine to start).
2. Use Lucid normally for a bit — chat, open the Library, check facts.
3. **Tell Matt once it's confirmed working through the Falcon.** That's his
   green light to stop the Railway service. Don't need a store release first;
   a build on Matt's phone pointing at the Falcon is enough to decommission.

---

## Gotchas / known behavior

- **Home-hosted now:** the Falcon is on a home network. If the box or tunnel is
  down, requests return **502** (or fail to connect), same failure class as a
  Railway outage. Keep the existing graceful-offline handling — no new logic
  needed, just don't assume 100% uptime.
- **A 401 after cutover is almost always the token**, not the URL. Check the
  header first.
- **Nothing else changes** — same prompts, same models, same behavior. If Lucid
  *feels* different after the move, it's a server-side env difference, not the app.
