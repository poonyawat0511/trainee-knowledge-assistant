# AI Usage Journal

This project was built through a subagent-driven workflow: I (the human) collaborated with a controller AI session (Claude) that ran design discussions with me directly, then dispatched a fresh implementer AI subagent per task and a separate reviewer AI subagent per task, iterating on findings before moving to the next task. This journal reflects that actual pattern — orchestration and review decisions — rather than a single-person "ask AI a question, get code" loop, since that isn't how this project was actually built. Each entry below is a real session from this build, not backfilled from memory afterward.

## Session 1: Reading the exam and understanding Part 1's scope

**Prompt:** "ช่วยอ่านและทำความเข้าใจโจทย์โดย focus ไปที่ part ที่ 1" (asked the AI to read the exam PDF and summarize Part 1's requirements)

**AI Response:** Summarized the 4 required features (login, upload, chat, chat-with-file-context, token counter), the scoring breakdown (required features, bonus features capped at 20, code quality, git history), and the 4 deliverables (repo, README, AI_JOURNAL, DECISIONS).

**My Adjustment:** None needed at this stage — used this summary as the shared reference point for the rest of the build.

## Session 2: Brainstorming the design

**Prompt:** Told the AI to go ahead and start; it invoked its brainstorming skill and asked a sequence of questions one at a time: which AI provider, which database, session management approach, and which bonus features to target.

**AI Response:** Proposed OpenRouter as one option among several for the AI provider question, SQLite/PostgreSQL/JSON-file as DB options, JWT-cookie vs server-side-session for auth, and a bonus feature set sized to the 20-point cap.

**My Adjustment:** Chose OpenRouter free tier (skip RAG for the initial pass), SQLite, JWT-in-httpOnly-cookie, and asked to add Rate Limiting to the AI's proposed bonus set (Markdown, Streaming, Conversation history, Docker healthcheck, Unit tests) to hit the cap exactly at 20.

## Session 3: Architecture style — pushing back on the AI's default proposal

**Prompt:** "อยากได้เป็น clean architechtuer module" — rejected the AI's first-draft architecture (a simpler route → service → repository layering) in favor of a stricter clean-architecture split.

**AI Response:** Revised the proposal to per-feature `domain/application/infrastructure` folders (`auth`, `documents`, `chat`), with an explicit dependency rule (domain imports nothing, application imports only domain + its own ports, infrastructure implements the ports) and a small factory-function composition pattern instead of a DI container.

**My Adjustment:** Approved this structure as presented — no further changes needed to the architecture itself.

## Session 4: Catching exam-framing leaking into the spec document

**Prompt:** "ไม่เขียนเรื่องการให้คะแนนลงใน spec ทั้งหมดเขียนเหมือน spec ที่ควรจะเป็น" — the AI's first draft of the design spec referenced exam point values ("65 points", "cap 20") throughout; told it to rewrite as a normal engineering spec instead.

**AI Response:** Rewrote the entire spec document removing all scoring/exam references, keeping only the actual technical requirements and design decisions.

**My Adjustment:** This was itself the adjustment — the AI's first pass conflated "what the grader wants to see" with "what the spec should say," and it needed correcting toward writing documentation for its own sake rather than for the grader's eyes.

## Session 5: Task 1 (project setup) — clean run

**Prompt:** Controller dispatched an implementer subagent with the task brief for dependency installation, `.env.example`, the shared `Result` type, and the SQLite bootstrap client.

**AI Response:** Implemented all of it via TDD for the `Result` type, ran the seed/test commands, committed. A reviewer subagent then checked the diff and approved it with only cosmetic minor notes (an unrequested comment in schema.sql, CJS instead of ESM in vitest.config.ts).

**My Adjustment:** None — accepted the minor findings as deferred/non-blocking rather than spending a fix round on cosmetics.

## Session 6: Task 6 (PDF upload) — the AI caught a real environment mismatch itself

**Prompt:** Dispatched the implementer with the brief's literal `pdf-parse` v1-style code sample.

**AI Response:** The implementer discovered mid-task that the actually-installed `pdf-parse` version (2.4.5) has a completely different API than the brief's sample code assumed (a class-based API, not a default-export function), and that the underlying `pdfjs-dist` dependency needed a worker-path resolution workaround to run under Next.js's Turbopack bundler. It implemented the fix, documented the root cause in detail, and flagged it as DONE_WITH_CONCERNS rather than silently deviating.

**My Adjustment:** Reviewed the deviation via a reviewer subagent, which independently verified the claim against the actual installed package files (not just trusting the report). Approved keeping the v2-compatible code, but asked for two follow-ups: a code comment documenting an edge case the implementer found (the worker setup permanently caches a failure until process restart), and pinning `pdf-parse`'s exact version so a future dependency bump can't silently reintroduce the same mismatch.

## Session 7: Task 9 (chat route) — reviewer caught a real security bug

**Prompt:** Dispatched the implementer with the brief's literal chat-route code, which — as written in the plan itself — never checked whether a `conversationId` the client sent actually belonged to the logged-in user.

**AI Response:** The task reviewer subagent traced the code path and found a genuine cross-user IDOR: any authenticated user could pass another user's `conversationId` and both read AI-generated context derived from that user's messages and write into their conversation. This was a gap in the plan's own sample code, not something the implementer introduced.

**My Adjustment:** Confirmed the fix should happen immediately rather than deferring it, and had the implementer wire in the already-built `ConversationRepository.findById(id, userId)` ownership check. Also proactively applied the same fix to Task 11's streaming route before it was even reviewed, since it shared the same brief-era gap.

## Session 8: Task 10 (chat UI) — reviewer caught a real functional gap, not just a bug

**Prompt:** Dispatched the implementer with the brief's chat page code, which had no way to load a past conversation's messages when switching conversations in the sidebar — the plan simply never included that endpoint.

**AI Response:** The reviewer flagged this as a real functional shortfall (the "conversation history" feature, from the project's own bonus feature list, wasn't actually functional beyond listing titles), alongside an unrelated but real bug (no error handling around the chat fetch call, which could leave the UI stuck on "Sending…" forever on a network failure).

**My Adjustment:** For the missing error handling, there was only one reasonable answer (fix it). For the missing history-load feature, given a genuine choice between "just reset the UI state on switch" (cheap, still incomplete) versus "build the actual missing endpoint" (more work, but actually delivers the feature), chose to build it properly — added `GET /api/conversations/[id]/messages` with the same ownership-check pattern as the IDOR fix from Session 7.

## Session 9: Task 8 — a plan-mandated design choice that didn't match its own stated intent

**Prompt:** Dispatched the implementer with the brief's `OpenRouterProvider` retry logic, which retried on any thrown error.

**AI Response:** The reviewer noticed the code comment said "one retry on network failure" but the actual code retried on HTTP error statuses too (a 400/401/429 would be retried even though it can never succeed), and flagged this as a plan-mandated inconsistency between stated intent and actual behavior.

**My Adjustment:** Chose to fix the behavior to match the stated intent (retry only genuine network failures, not HTTP error responses) rather than leave the more wasteful literal-brief behavior in place, since the brief's own comment made clear what was actually intended.

## Session 10: Task 12 — the AI over-fixed a review finding

**Prompt:** Asked the implementer to fix a review finding about the rate-limiting logic.

**AI Response:** The implementer's first fix attempt reformatted the entire touched files (quote style, string-escaping style, stripped trailing newlines) as a side effect of making the actual small logic change — turning a ~10-line intended diff into 27+56 changed lines.

**My Adjustment:** Sent it back specifically to make the diff minimal and revert all unrelated formatting, keeping only the real rate-limit logic as the visible change. This was a case of the AI doing more than asked rather than doing something wrong — worth catching so the git history stays readable.

## Session 11: Task 13 (Docker) — a real blocker, accepted rather than chased indefinitely

**Prompt:** Asked the implementer to build and live-verify the Docker Compose deployment, not just statically review it.

**AI Response:** The implementer found and fixed a real bug (a missing `.dockerignore` was causing the wrong-architecture native binary to get bundled), but then hit a genuine, unresolved container crash (SIGSEGV) the first time the app touched the SQLite native binding — reproduced identically across two different base images, ruled out as an out-of-memory kill, and ultimately reported back as BLOCKED after a second attempt with a different base image didn't resolve it.

**My Adjustment:** Given the sandbox's own Docker daemon was independently unstable throughout this session (dropped and had to be relaunched multiple times, unrelated to the app), decided not to keep spending time chasing a possibly sandbox-specific issue. Accepted it as a documented Known Issue in the README rather than as a blocking defect, since the Dockerfile/compose structure itself was independently verified correct (no secrets baked in, correct healthcheck target, sound stage separation) even though the live end-to-end run couldn't be confirmed in this environment.

## Reflection

The overall pattern across this build: the AI caught more real bugs during its own review passes (the pdf-parse version mismatch, the cross-user IDOR, the missing conversation-history endpoint, the retry-logic/comment mismatch, the reformatting scope creep) than it introduced. My role was mostly adjudicating genuine trade-offs it surfaced rather than catching mistakes it tried to hide — the one recurring theme worth naming honestly is that several of the real defects (the IDOR, the missing history endpoint, the retry-intent mismatch) originated in the *plan I approved*, not in what any individual implementer subagent invented — which is exactly why running an independent review pass per task, rather than trusting the plan or the implementer's self-report, mattered here.
