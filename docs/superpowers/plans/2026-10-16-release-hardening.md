# Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, preserving native inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing workspace reads explicitly recoverable and produce repeatable recovery, hosted Search and long-history evidence while Attachments waits for R2.

**Architecture:** Vue Query retains all remote state; a small workspace recovery composable controls read-only retry feedback without replaying mutations. Opt-in native Chrome checks serve the real app with local deterministic API fixtures, while a separate hosted Search journey uses disposable live fixtures.

**Tech Stack:** Vue 3, TypeScript, Axios, Vue Query, VueUse, Vitest, Node >=22.18.0, npm and native Chrome DevTools Protocol. No new runtime dependencies.

**Spec:** [Release hardening design](../specs/2026-10-16-release-hardening-design.md), proposed for review with this plan. Status: draft; no implementation tasks are complete.

## Global Constraints

- English source, UI, tests and documentation; preserve pixel styling and accessible native interaction.
- Endpoints stay in `src/lib/api.ts`, Axios in `src/lib/http.ts`, keys in `src/lib/query.ts`; Pinia remains session-only.
- Node >=22.18.0 and npm; no new runtime dependencies.
- Never automatically replay a write. Mention retry preserves its original immutable payload/key.
- Local recovery/history checks must use local API fixtures and cannot mutate the deployed service.
- Reports exclude credentials, tokens, raw URLs/headers, retry keys, message bodies and signed URLs.
- Attachments remain pending until R2 and the scanner/provider/privacy gates pass. No upload UI or repeated live upload probes in this phase.
- No deployment, production restart, forced live rate-limit flood, distributed guarantee, presence/typing or SSE work.
- At execution start, create `feat/release-hardening` from the accepted Mentions code after checking for user changes. Preserve the user's existing-checkout preference unless they request isolation. Keep previous work intact.

## Review Focus

1. Read recovery overlaps a failed create/join action: success clears only read feedback (Task 1).
2. A retry completes after logout/account change: no stale feedback or private cache restoration (Tasks 1/2).
3. Inbox receives 429 then focus/invalidation/polling: no request bypasses its five-second deadline (Task 2).
4. An accepted mention loses its response: exactly one canonical message after explicit same-key retry, zero automatic resend (Task 2).
5. The benchmark cannot sample heap, or live cleanup is interrupted: report unavailable metrics and incomplete cleanup rather than false success (Tasks 3/4).

---

## Task 1: Explicit workspace read recovery

**Files:** Create `src/features/rooms/useWorkspaceRecovery.ts`, `useWorkspaceRecovery.test.ts`, `RoomWorkspace.recovery.test.ts`; modify `src/features/rooms/RoomWorkspace.vue`. Reuse `src/lib/query.ts`, `src/lib/session.ts` and `src/lib/rate-limit.ts` without changing their public interfaces.

**Interfaces:** Export `useWorkspaceRecovery()` returning readonly `pending: Ref<boolean>`, `cooldownSeconds: Ref<number>`, `error: Ref<string>` and `retry(): Promise<void>`. It consumes exact workspace keys `profile`, `rooms`, `invitations` and current session events. Component read feedback derives from these query errors plus recovery errors; existing mutation failures have separate action feedback.

- [ ] Write mounted regressions: `retry_refetches_active_workspace_reads_only` asserts profile/rooms/invitations GETs and zero POST/PUT/PATCH/DELETE; `double_retry_is_single_flight` asserts one explicit attempt; `read_recovery_preserves_action_error` keeps a failed join visible after successful reads.
- [ ] Add deferred tests `logout_cancels_recovery` and `new_account_ignores_old_recovery_feedback`; a late response cannot restore removed query instances. Add `explicit_retry_respects_retry_after_5` with fake time, asserting no extra explicit read before 5,000 ms and one user-triggered attempt afterward.
- [ ] Run `npm test -- src/features/rooms/useWorkspaceRecovery.test.ts src/features/rooms/RoomWorkspace.recovery.test.ts`; new tests must fail before implementation.
- [ ] Implement retry of only active exact workspace queries using their existing query functions/signals. Capture query instances and explicit-account/session generation; cancel owned reads on that boundary, ignoring stale feedback. Use the existing cooldown parser/helper; a successful read must not clear mutation feedback. Render labelled `RETRY WORKSPACE` next to read errors, disabled while pending/cooling down, with generic existing error copy and safe request references.
- [ ] Rerun focused tests plus `src/lib/query.test.ts` and `src/stores/auth.test.ts`. Commit `fix: add explicit workspace read recovery` after they pass.

## Task 2: Deterministic native browser failure matrix

**Files:** Create `scripts/lib/acceptance-browser.mjs`, `scripts/fixtures/recovery-api.mjs`, `scripts/check-recovery.mjs`, `scripts/check-recovery.test.mjs`; modify `package.json`. Touch Task 1 UI only for a reproduced regression within its defined scope.

**Interfaces:** `startRecoveryApi()` returns `{ origin, setScenario(name), snapshot(), close() }`; scenario names are `login-503`, `workspace-503`, `mention-response-loss`, `inbox-429`, `inbox-429-no-header`, `inbox-429-malformed-header`, `session-change`. `snapshot()` returns only method/route-template counts and canonical message count. Browser helper exports `withAcceptanceBrowser({ artifactDir, chromePath }, run)` and supplies `command`, `newPage`, `evaluate`, `waitFor`, then always closes Chrome. CLI `npm run acceptance:recovery` serves a temporary Vite app against the local fixture, runs all scenarios and exits nonzero for any failure. No live-API mode.

- [ ] Write runner regressions for cleanup on failure, report redaction, rejecting non-loopback fixture origins, and nonzero exit for a failed scenario. Run `npm test -- scripts/check-recovery.test.mjs`; expect missing-interface failures.
- [ ] Implement the fixture and browser lifecycle using existing Node/Vite/Chrome tooling. Fixture OPTIONS explicitly allows Content-Type, Authorization and Idempotency-Key and exposes Retry-After/X-Request-Id. Use synthetic accounts/messages only. Reports record simulated-response status and observation counts; never serialize raw CDP traffic.
- [ ] Pin each scenario: login 503 preserves fields with one POST until explicit retry; workspace GET failure shows Task 1 retry and recovers; dropped accepted mention response has zero automatic replay and explicit retry preserves key/payload with one canonical message; Inbox 429/Retry-After 5 blocks poll/focus/invalidation/manual retry until deadline. Missing/malformed header shows no invented countdown and allows explicit retry. Delayed recovery across logout/account change exposes no prior-account data.
- [ ] Run runner tests, existing `src/lib/api.test.ts`, `src/lib/rate-limit.test.ts`, and `src/features/notifications/useNotificationInbox.test.ts`; run `npm run acceptance:recovery`. Assert no unexpected browser exceptions or unhandled requests and all temporary processes close.
- [ ] If a failure exposes a shared-query scheduling issue outside Task 1, preserve RED evidence and amend the design/plan before changing global query ownership. Do not weaken the check to obtain a pass. Commit `test: add native recovery acceptance matrix` when complete.

## Task 3: Long-history resource baseline

**Files:** Create `scripts/check-history-cost.mjs`, `scripts/fixtures/history-api.mjs`, `scripts/check-history-cost.test.mjs`; reuse Task 2's browser helper; modify `package.json`, `src/features/rooms/useWorkspaceRealtime.ts` and `useWorkspaceRealtime.test.ts` for the reproduced fallback handoff defect; create `docs/HISTORY_COST_2026-10-16.md` (use actual execution date if later).

**Interfaces:** `startHistoryApi({ messageCount: 40 | 1000 })` returns `{ origin, snapshot(), close() }` with the same route-template count shape as Task 2's fixture. CLI `npm run acceptance:history` reports three runs per size: `messageCount`, `renderedRows`, `requestCounts`, `loadMs`, `idleRequestCounts`, `heapBytes: number | null`, and `heapUnavailableReason: string | null`. Heap samples are optional; no memory SLA is invented.

- [ ] Write runner tests: the 1,000-message fixture pages in exclusive 40-message ranges with no duplicate IDs; report never includes message text/IDs/tokens; missing heap support yields null plus a reason, not zero. Run `npm test -- scripts/check-history-cost.test.mjs`; expect failures before implementation.
- [ ] Implement both local scenarios using real LOAD OLDER interactions. Record an idle 15-second interval, then ten room switches, return to the initial room and sample after pending reads settle. Exclude startup traffic from idle counts; normalize query strings/room IDs to route templates before reporting.
- [ ] Fix the observed fallback handoff defect only after `hands fallback recovery to a new room when the previous recovery is still pending` fails. Allow the new room to start REST recovery while the workspace status remains recovering from aborted old work; preserve generation guards. Rerun the real WebSocket suite and the native 1,000-row switch scenario.
- [ ] Run `npm run acceptance:history` three times per size. Fail on missing rows, duplicates, unexpected browser exceptions, unhandled requests or failed fixture cleanup. Publish elapsed-time/request/heap ranges and known platform limitations. Do not mark optional heap failure as a product failure or silently skip row checks.
- [ ] Compare visible/hidden polling and retained DOM/cache cost. Record any budget or virtualization proposal as a subsequent decision based on these measurements; do not change polling/retention in this task. Commit `test: record long-history resource baseline`.

## Task 4: Hosted Search, final review and handoff

**Files:** Create `docs/RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md` (use actual execution date); update `PLAN.md`, `docs/API_CONTRACT.md`, `docs/BACKEND_HANDOFF.md`, this plan and design. Keep live fixture harnesses and credentials in private temporary storage.

**Consumes:** Tasks 1–3 commands/reports and existing Search contract/design, API fixture authorization, selected sandbox host. Produces response-backed hosted Search evidence and remaining live operations gates.

- [ ] Run `npm run check`, `npm run contract:check`, `npm run acceptance:recovery`, `npm run acceptance:history`, `npm run search:scroll:check`, and `git diff --check`. Record versions/build/schema hashes and command results. Do not repeat tests without a code change, failure or unresolved concern.
- [ ] With retained owner plus a disposable authorized member, verify hosted Search query and positive-cursor pagination, fresh edit/deleted state, revocation, keyboard focus, desktop/mobile overflow, and draft retention. Assert Search alone causes no room-read PUT; foregrounding a visible room afterward may legitimately acknowledge messages. Confirm the relevant build is deployed; do not deploy it automatically or confuse local evidence with hosted evidence.
- [ ] Persist credentials before live writes and IDs incrementally. Confirm new message/account/membership cleanup, including failed attempts. Missing credentials or failed cleanup remains explicit and retains recovery evidence. Do not alter legacy accounts 35/36 or the retained owner/private room.
- [ ] Obtain one independent whole-branch review after green checks. Fix Important/Critical findings with RED→GREEN regressions, then rerun affected checks. Record any deferred Minor item and each declined-to-judge decision with rationale and cost. No per-task agents or repeated review rounds are planned.
- [ ] Publish the acceptance record, update completed frontend gates and leave external gates unchecked. Actual 429 requires a BE-supported test window; do not induce it with a flood. Actual warm-up/rolling-deployment/drain and cross-node delivery remain coordinated BE follow-ups. Include rollback to the previously accepted deployment and keep attachment UI deferred. Commit `docs: record release hardening acceptance`.

## Execution handoff

Proposed plan; user review is pending. No code, new branch, dependencies or deployment are created by this planning change. Preserve native inline execution and one final independent reviewer when implementation begins. Attachments are explicitly pending R2 setup; work here does not depend on completing that setup. If the user prefers presence/typing next, begin with contract clarification and a separate design rather than expanding this phase.
