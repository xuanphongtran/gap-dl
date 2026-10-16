# Release hardening design

Status: approved by the user on 2026-10-16; implementation and functional evidence complete, independent review pending. The user explicitly deferred Attachments because Cloudflare R2 is not configured. This phase follows the completed [sandbox Mentions/WebSocket acceptance](../../SANDBOX_RELEASE_ACCEPTANCE_2026-10-16.md) and implements the remaining frontend-controlled work in [PLAN.md](../../../PLAN.md), section 7.

## Outcome and choice

Make the existing chat recover predictably from unavailable reads and provide repeatable evidence for failures, hosted Search and long-history cost. Users retain drafts, receive a clear retry action, and do not unknowingly duplicate writes. Execution remains native/inline with one independent final review, following the preceding workflow.

Three continuations were considered: release hardening, presence/typing UI, or attachment UI. Release hardening can progress with the current REST contract. Presence/typing still lacks published WebSocket payloads in the AsyncAPI rechecked on 2026-10-16; it needs a separate contract/design phase. Attachments cannot be accepted before R2, scanner and authorized download are ready. This phase adds no new transport or storage dependency.

## Boundaries

Preserve endpoint functions in `src/lib/api.ts`, transport in `src/lib/http.ts`, Vue Query server data and existing keys, session-only Pinia, and pixel/native accessible controls. Keep English source, UI, tests and documentation. Node >=22.18.0, npm, Vue 3, TypeScript, VueUse and existing Vitest/CDP tooling remain the stack; no new runtime dependencies.

Add an explicit workspace read-recovery action beside profile/room-list/invitation read failures. Current workspace queries have bounded automatic retry but no dedicated read retry control. Separate their read feedback from mutation feedback, so a recovered read cannot erase an unrelated failed action. A retry refetches only active workspace reads, never create/join/invite or another write. Disable duplicate retry while it is pending; an observed 429 deadline also disables this explicit action. Successful reads clear read feedback. Logout/account change cancels the operation and prevents stale feedback in the new session. Existing private-query/session cleanup remains authoritative.

This action does not promise a new global rate-limit coordinator. Automatic 429 suppression already owned by Inbox, Search and preferences must remain intact; the verification matrix pins those boundaries. If the browser matrix exposes a new shared-query scheduling defect, record the reproducible case and amend the implementation plan before widening query ownership.

Recovery ownership amendment (2026-10-16): native 1,000-row baseline and a failing mounted regression confirm that switching rooms while REST fallback recovery is pending can leave the new room paused forever. Transfer recovery to the newly authorized room even while the workspace status still describes the old recovery. Preserve account/room generation guards, abort the old work, and leave polling/history policies unchanged.

## Verification deliverables

Provide an opt-in local recovery harness that serves the real app against a deterministic local API fixture. It must never direct mutations to the deployed API. Cover login 503 without automatic POST replay, workspace read failure/retry, mention accepted-response loss and explicit same-key retry, Inbox 429 with Retry-After 5, missing/malformed Retry-After, and logout/account change during delayed recovery. Missing Retry-After permits explicit retry without inventing a countdown. Browser errors and unexpected requests fail the check. Injected responses are labelled simulated; they do not close backend live gates.

Publish a hosted Search follow-up: native query, advancing pagination, edit/tombstone freshness, membership loss, keyboard and mobile interaction, and no implicit room read acknowledgement while Search is open. Retain credentials before fixture mutations, track IDs incrementally, and confirm cleanup. The previous hosted acceptance only verified Search draft/selection preservation, so it does not establish these query journeys.

Measure local deterministic long-history behavior using 40 and 1,000 synthetic messages. Record request counts by route template, rendered row count, elapsed load time and optional heap samples after idle and room switches. Repeat the same scenario three times. Report ranges rather than a service-level objective; missing heap support is explicitly unavailable. Do not add virtual scrolling or change polling budgets until this baseline demonstrates a problem and a separate change is designed.

## Privacy and operations

Artifacts stay in a private temporary directory. Reports contain scenario names, status/counts, timings, build/schema hashes and safe request IDs only. Never persist credentials, JWTs, query-token WebSocket URLs, retry keys, message bodies, raw headers or signed URLs in reports. A separate mode-600 credentials file is allowed only for live fixture cleanup. No production analytics SDK or remote telemetry is introduced.

Do not force backend rate limits with a request flood, restart/drain a live service, change deployment protection or deploy a branch as part of the harness. Real 429 headers/countdown and actual warm-up/rolling deployment need a coordinated backend test window; their gates remain open without response-backed evidence. Cross-node delivery, SSE, presence/typing and distributed guarantees remain outside scope. Legacy account cleanup remains an admin task.

## Attachment reopening criteria

Attachments are pending by user instruction while R2 is not configured. Resume only after BE supplies evidence for private immutable storage, scanner outcomes, reservation/upload/completion, verified message binding, authorized signed download, quota, expiration and cleanup. Recheck Idempotency-Key CORS for uploads. R2 configuration alone does not close the scanner/privacy gates. No upload UI or periodic upload-readiness probing is scheduled during this phase.

## Acceptance

Run focused regressions for changed behavior, `npm run check`, local recovery and history checks, and hosted Search acceptance when the target is accessible. Obtain one whole-branch review and resolve Important/Critical findings. Record exact checks, unresolved live gates, fixture cleanup and rollback guidance. This phase is complete when its local deliverables and hosted Search evidence exist; external backend/admin/operations gates remain separately tracked, not silently marked complete.
