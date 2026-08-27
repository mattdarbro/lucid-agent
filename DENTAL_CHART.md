# DENTAL_CHART — lucid-agent

_The health record for this repo. Dr. D (Donald) keeps it. Append-only — newest visit last._

## Patient info (intake)
kind:            Node / TypeScript backend service
purpose:         Lucid's backend — the chat API, memory, and vector search behind Matt's flourishing companion. Presence (chat) lives here and on Railway.
stack:           TypeScript, Node, Postgres + pgvector, Anthropic (Sonnet 5 chat), Voyage embeddings, Railway
struggles:       A 6/19 self-review found real integrity bugs in the chat path (an empty assistant turn could be saved; a user message got persisted before the API call succeeded, so a failed call left an orphaned message). The clean config/security fixes were salvaged, but those chat.service.ts fixes were never ported and should be re-checked against the current Sonnet-5 code.
goals:           Keep chat reliable and correct; close real security holes; no dead code. Presence stays on this codebase.
do-not-touch:    The autonomous/circadian job loops — those moved to Falcon and are meant to stay OFF here (Falcon is the sole autonomous owner). Don't propose re-enabling them.
pr-conventions:  Base branch is main. Push from Falcon is over SSH. Code changes come as a branch + PR that Matt merges — never a direct commit to main.

## Visit log (append-only, newest last)

### 2026-07-03 — Checkup
**Overall:** Mostly healthy, but the two things you came in worried about are both real and both still here. The good news: neither is exotic, and they're the ordinary "fix-it" kind, not a rebuild. Your chat path is well cared for otherwise — I even found some nice defensive work already guarding against bad data. But those two chat-integrity bugs from the June self-review never got fixed, and they're the kind that quietly make a mess over time.

**Diagnosed:**
- [high] When Lucid's answer comes back empty, the app saves the empty answer and shows the person a blank message anyway — and that blank can jam up the next messages too. In `chat.service.ts`, the reply text (`assistantResponse`) starts out as an empty string and there's no check that it actually has words before it gets saved near the end of `chat()`. It can stay empty if the model uses up all its room "thinking," or if it keeps reaching for tools and never writes a reply (the tool loop stops after 5 tries). This is the "empty assistant turn" from your June review — still open.
- [high] If the call to the AI fails, the person's own message has already been saved with nothing next to it — an orphan. In `chat.service.ts`, the user's message is written to the database at the very top of `chat()`, *before* the AI is ever called. When the AI call fails (after its retries), the error is passed up and that saved message is just left sitting there. If the phone then retries, you get two copies of the same message. Worse, a lonely user message with no reply can leave the conversation in a shape the AI later refuses (I'm inferring the last part, but it fits the same "poisoned history" pattern your code already fights elsewhere). This is the "orphaned message" from June — still open.

**Watching:**
- The reply budget (8000 tokens) has to cover *both* Lucid's private "thinking" and the actual answer. On a heavy thinking pass the answer can get cut short — the code already notices this and logs a warning. Fine for now, but it's the same doorway that lets an empty answer slip through, so fixing the item above covers it too.
- Some genuinely good defensive work is already here: before sending text to the AI, the code strips out broken half-emoji that would otherwise crash the call. That's the same family of problem as the two bugs above — bad data gumming up the chat — so I'm glad to see the instinct is already in the house. Not worried.
- This is my first visit, so there are no old watch-items to check yet. Starting the chart clean.

**Referred:**
- Nothing to refer. Both fixes keep Lucid exactly the same Lucid — small, safe changes to when things get saved and one "don't save a blank" guard. No rewrites, and I didn't need to go near the autonomous loops you told me to leave off.

### 2026-07-03 — Surgery
**Did:** I fixed the two chat-integrity bugs in chat.service.ts. First, right before Lucid's answer gets saved, I added a check: if the answer came back empty (just blanks), we don't save it — we stop with an error instead. Second, I made the person's own message get cleaned up if anything goes wrong: it's still saved up top, but now if the AI call (or the empty-answer check) fails, we delete it so it isn't left sitting there alone. Because the empty answer now stops with an error, it flows through that same cleanup, so a blank answer removes the lonely message too and the phone can safely try again.

**Changes:**
- src/services/chat.service.ts — Moved the user-message variable up so I can reach it in the error handler. Added a guard just before saving the reply: if the assembled answer has no real words, log a warning and throw instead of saving a blank. Added rollback in the catch block: if we already saved the user's message and then something failed, delete that message (with its own small try/catch so a delete problem can't hide the real error).
- (environment only, no source change) Ran `npm install` because the installed node_modules held the old Anthropic SDK (0.68.0) while package.json and package-lock already ask for 0.109.0. This only synced the folder to the lockfile that was already there; git shows no change to package.json or package-lock.json.

**Tests:** npm run build (tsc): passed clean — but only after `npm install`; with the stale SDK it failed on a pre-existing type error at line 288 (the adaptive-thinking code I never touched). npm test: 294 passed (16 files). Note: there is no chat.service test file, so these two exact changes are not directly covered by a test — the suite passing just tells me I didn't break anything else.

**Confidence:** 0.82 — In favor: the change is small, lives in one method (chat()), does exactly the two things you asked, and goes nowhere near the autonomous/circadian loops on do-not-touch. Build is green and all 294 tests pass. Against: there's no test that actually exercises chat.service.ts, so the empty-reply path and the rollback path aren't proven by an automated test — I reasoned through them by reading the code, I didn't watch them run against a real DB or API. One thing worth your eye: the empty-reply case now returns an error to the phone (via the existing catch → generic 500) rather than a gentle fallback message. I judged an error is safer than showing a blank, and it keeps the message-cleanup consistent — but if you'd rather the person see a soft "let me try that again" bubble instead of an error, that's a deliberate choice to make at chat.service.ts:435 and in src/routes/chat.ts.

**PR:** https://github.com/mattdarbro/lucid-agent/pull/190
