# Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, preserving native inline execution. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make existing workspace reads explicitly recoverable and produce repeatable recovery, hosted Search and long-history evidence while Attachments waits for R2.

**Architecture:** Vue Query retains all remote state; a small workspace recovery composable controls read-only retry feedback without replaying mutations. Opt-in native Chrome checks serve the real app with local deterministic API fixtures, while a separate hosted Search journey uses disposable live fixtures.

**Tech Stack:** Vue 3, TypeScript, Axios, Vue Query, VueUse, Vitest, Node >=22.18.0, npm and native Chrome DevTools Protocol. No new runtime dependencies.

**Spec:** [Release hardening design](../specs/2026-10-16-release-hardening-design.md), approved by the user on 2026-10-16. Tasks 1–4 complete; review corrections committed as `67bebd6` and final verification passed on 2026-10-17.

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

- [x] Write mounted regressions: `retry_refetches_active_workspace_reads_only` asserts profile/rooms/invitations GETs and zero POST/PUT/PATCH/DELETE; `double_retry_is_single_flight` asserts one explicit attempt; `read_recovery_preserves_action_error` keeps a failed join visible after successful reads.
- [x] Add deferred tests `logout_cancels_recovery` and `new_account_ignores_old_recovery_feedback`; a late response cannot restore removed query instances. Add `explicit_retry_respects_retry_after_5` with fake time, asserting no extra explicit read before 5,000 ms and one user-triggered attempt afterward.
- [x] Run `npm test -- src/features/rooms/useWorkspaceRecovery.test.ts src/features/rooms/RoomWorkspace.recovery.test.ts`; new tests must fail before implementation.
- [x] Implement retry of only active exact workspace queries using their existing query functions/signals. Capture query instances and explicit-account/session generation; cancel owned reads on that boundary, ignoring stale feedback. Use the existing cooldown parser/helper; a successful read must not clear mutation feedback. Render labelled `RETRY WORKSPACE` next to read errors, disabled while pending/cooling down, with generic existing error copy and safe request references.
- [x] Rerun focused tests plus `src/lib/query.test.ts` and `src/stores/auth.test.ts`. Commit `fix: add explicit workspace read recovery` after they pass.

## Task 2: Deterministic native browser failure matrix

**Files:** Create `scripts/lib/acceptance-browser.mjs`, `scripts/fixtures/recovery-api.mjs`, `scripts/check-recovery.mjs`, `scripts/check-recovery.test.mjs`; modify `package.json`. Touch Task 1 UI only for a reproduced regression within its defined scope.

**Interfaces:** `startRecoveryApi()` returns `{ origin, setScenario(name), snapshot(), close() }`; scenario names are `login-503`, `workspace-503`, `mention-response-loss`, `inbox-429`, `inbox-429-no-header`, `inbox-429-malformed-header`, `session-change`. `snapshot()` returns only method/route-template counts and canonical message count. Browser helper exports `withAcceptanceBrowser({ artifactDir, chromePath }, run)` and supplies `command`, `newPage`, `evaluate`, `waitFor`, then always closes Chrome. CLI `npm run acceptance:recovery` serves a temporary Vite app against the local fixture, runs all scenarios and exits nonzero for any failure. No live-API mode.

- [x] Write runner regressions for cleanup on failure, report redaction, rejecting non-loopback fixture origins, and nonzero exit for a failed scenario. Run `npm test -- scripts/check-recovery.test.mjs`; expect missing-interface failures.
- [x] Implement the fixture and browser lifecycle using existing Node/Vite/Chrome tooling. Fixture OPTIONS explicitly allows Content-Type, Authorization and Idempotency-Key and exposes Retry-After/X-Request-Id. Use synthetic accounts/messages only. Reports record simulated-response status and observation counts; never serialize raw CDP traffic.
- [x] Pin each scenario: login 503 preserves fields with one POST until explicit retry; workspace GET failure shows Task 1 retry and recovers; dropped accepted mention response has zero automatic replay and explicit retry preserves key/payload with one canonical message; Inbox 429/Retry-After 5 blocks poll/focus/invalidation/manual retry until deadline. Missing/malformed header shows no invented countdown and allows explicit retry. Delayed recovery across logout/account change exposes no prior-account data.
- [x] Run runner tests, existing `src/lib/api.test.ts`, `src/lib/rate-limit.test.ts`, and `src/features/notifications/useNotificationInbox.test.ts`; run `npm run acceptance:recovery`. Assert no unexpected browser exceptions or unhandled requests and all temporary processes close.
- [x] If a failure exposes a shared-query scheduling issue outside Task 1, preserve RED evidence and amend the design/plan before changing global query ownership. Do not weaken the check to obtain a pass. Commit `test: add native recovery acceptance matrix` when complete.

## Task 3: Long-history resource baseline

**Files:** Create `scripts/check-history-cost.mjs`, `scripts/fixtures/history-api.mjs`, `scripts/check-history-cost.test.mjs`; reuse Task 2's browser helper; modify `package.json`, `src/features/rooms/useWorkspaceRealtime.ts` and `useWorkspaceRealtime.test.ts` for the reproduced fallback handoff defect; create `docs/HISTORY_COST_2026-10-16.md` (use actual execution date if later).

**Interfaces:** `startHistoryApi({ messageCount: 40 | 1000 })` returns `{ origin, snapshot(), close() }` with the same route-template count shape as Task 2's fixture. CLI `npm run acceptance:history` reports three runs per size: `messageCount`, `renderedRows`, `requestCounts`, `loadMs`, `idleRequestCounts`, `heapBytes: number | null`, and `heapUnavailableReason: string | null`. Heap samples are optional; no memory SLA is invented.

- [x] Write runner tests: the 1,000-message fixture pages in exclusive 40-message ranges with no duplicate IDs; report never includes message text/IDs/tokens; missing heap support yields null plus a reason, not zero. Run `npm test -- scripts/check-history-cost.test.mjs`; expect failures before implementation.
- [x] Implement both local scenarios using real LOAD OLDER interactions. Record an idle 15-second interval, then ten room switches, return to the initial room and sample after pending reads settle. Exclude startup traffic from idle counts; normalize query strings/room IDs to route templates before reporting.
- [x] Fix the observed fallback handoff defect only after `hands fallback recovery to a new room when the previous recovery is still pending` fails. Allow the new room to start REST recovery while the workspace status remains recovering from aborted old work; preserve generation guards. Rerun the real WebSocket suite and the native 1,000-row switch scenario.
- [x] Run `npm run acceptance:history` three times per size. Fail on missing rows, duplicates, unexpected browser exceptions, unhandled requests or failed fixture cleanup. Publish elapsed-time/request/heap ranges and known platform limitations. Do not mark optional heap failure as a product failure or silently skip row checks.
- [x] Compare visible/hidden polling and retained DOM/cache cost. Record any budget or virtualization proposal as a subsequent decision based on these measurements; do not change polling/retention in this task. Commit `test: record long-history resource baseline`.

## Task 4: Hosted Search, final review and handoff

**Files:** Create `docs/RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md` (use actual execution date); update `PLAN.md`, `docs/API_CONTRACT.md`, `docs/BACKEND_HANDOFF.md`, this plan and design. Keep live credentials and run-specific harnesses in private temporary storage. Retain the reusable cleanup journal and failure-injection tests in `scripts/lib/live-fixture-journal.mjs` and `scripts/live-fixture-journal.test.mjs`; document adapter requirements in `docs/LIVE_FIXTURE_CLEANUP.md`.

**Consumes:** Tasks 1–3 commands/reports and existing Search contract/design, API fixture authorization, selected sandbox host. Produces response-backed hosted Search evidence and remaining live operations gates.

- [x] Run `npm run check`, `npm run contract:check`, `npm run acceptance:recovery`, `npm run acceptance:history`, `npm run search:scroll:check`, and `git diff --check`. Record versions/build/schema hashes and command results. Do not repeat tests without a code change, failure or unresolved concern.
- [x] With retained owner plus a disposable authorized member, verify hosted Search query and positive-cursor pagination, fresh edit/deleted state, revocation, keyboard focus, desktop/mobile overflow, and draft retention. Assert Search alone causes no room-read PUT; foregrounding a visible room afterward may legitimately acknowledge messages. Confirm the relevant build is deployed; do not deploy it automatically or confuse local evidence with hosted evidence.
- [x] Persist credentials before live writes and IDs incrementally. Confirm new message/account/membership cleanup, including failed attempts. Missing credentials or failed cleanup remains explicit and retains recovery evidence. Do not alter legacy accounts 35/36 or the retained owner/private room.
- [x] Obtain one independent whole-branch review after green checks. Fix Important/Critical findings with RED→GREEN regressions, then rerun affected checks. Record any deferred Minor item and each declined-to-judge decision with rationale and cost. No per-task agents or repeated review rounds are planned.
- [x] Publish the acceptance record, update completed frontend gates and leave external gates unchecked. Actual 429 requires a BE-supported test window; do not induce it with a flood. Actual warm-up/rolling-deployment/drain and cross-node delivery remain coordinated BE follow-ups. Include rollback to the previously accepted deployment and keep attachment UI deferred. Commit `docs: record release hardening acceptance`.

## Execution handoff

Approved and executing inline on `feat/release-hardening`; see [acceptance evidence](../../RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md). Independent review found three Important issues; the deadline, native account-switch scenario and durable cleanup core are corrected with regression coverage. Final verification passes 211 tests and the seven-scenario native recovery matrix; deployment is not performed by this run. Preserve native inline execution and one final independent reviewer when implementation begins. Attachments are explicitly pending R2 setup; work here does not depend on completing that setup. If the user prefers presence/typing next, begin with contract clarification and a separate design rather than expanding this phase.

## Execution record

Execution ledger for this plan:
Approved by user on 2026-10-16; base 5650316; native inline execution on feat/release-hardening.
Ruling: use the approved existing checkout with a new feature branch — explicit plan/user preference preserves preceding workflow — cost if wrong: no separate worktree isolation.
Pre-flight: Task1 retry interface → Task2 real UI scenario: compatible; queries remain exact workspace keys and no mutations replayed.
Pre-flight: Task2 browser helper/fixture snapshot → Task3: compatible; share browser lifecycle and route-template count shape, separate fixtures.
Pre-flight: Tasks1–3 commands/evidence → Task4: compatible; hosted feature changes require user deployment and cannot be silently substituted by local checks.
Tasks: 1–4 complete; final verification passed on 2026-10-17.
Task 1: complete (commits 5650316..fc96d19, tests: npm test -- src/features/rooms/useWorkspaceRecovery.test.ts src/features/rooms/RoomWorkspace.recovery.test.ts src/lib/query.test.ts src/stores/auth.test.ts →    Duration  1.11s (environment 58%, transform 19%, import 18%, tests 5%))
Task2: browser matrix7/7 passes, /tmp/gogo-recovery-X1GYQK/report.json. Deadline assertion uses GET timestamps (CORS OPTIONS is not a retry). Fixture idempotency rejects changed payload under an existing key; regression RED409→GREEN. Suite202/202; lint green.
Ruling: expose fixture-only recover() control and optional messageCount initialization, keeping snapshots count-only — scenarios need an explicit health transition and Task3 can reuse the local REST fixture without duplicate routing — cost if wrong: test-fixture coupling; no production endpoint or dependency changes.
Task 2: complete (commits fc96d19..9370b42, tests: npm test -- scripts/check-recovery.test.mjs src/lib/api.test.ts src/lib/rate-limit.test.ts src/features/notifications/useNotificationInbox.test.ts →    Duration  793ms (environment 50%, import 24%, tests 13%, transform 12%, worker 1%))

Task3 diagnostic: native1000 rows blocks switching rooms with status recovering, no fixture errors and cancelled new-room reads pending/idle. Mounted regression reproduces paused=true,20 existing WS tests pass.
Ruling: include minimal fallback recovery handoff fix in Task3 before completing baseline — a pending old recovery can strand a newly selected room, contradicting phase recovery behavior; amend spec/plan before code — cost if wrong: realtime recovery scope expands; pinned real-composable regression and full/native verification cover the change, polling/retention remain unchanged.

Task3: fallback handoff regression RED→GREEN, WS21/21. Native targeted1000 rerun and final six history runs pass (/tmp/gogo-history-V19yxV/report.json),40/1000 rows retained after ten switches. Full check207/207 green. Heap is used JS heap without forcedGC; simulated visibility and failed-WS fallback are recorded limits.
Task 3: complete (commits 9370b42..203d876, tests: npm test -- scripts/check-history-cost.test.mjs src/features/rooms/useWorkspaceRealtime.test.ts →    Duration  9.50s (tests 93%, environment 4%, import 2%, transform 1%))

Task4: hosted Search8/8 passes (/tmp/gogo-search-host-20261016-Jva3yO/report.json), screenshots inspected,22 messages/account cleaned per attempt across two attempts; first harness dereference failed during correctly hidden rows and was corrected. No browser exceptions. Contract unchanged29routes; recovery7/7 after handoff fix; search:scroll:check passes.
Ruling: accept hosted Search against the existing P4 build while keeping new workspace/fallback code explicitly local-only — Search/API source is unchanged and deployment is outside the approved execution scope — cost if wrong: new recovery behavior remains unavailable on the host until separately deployed and smoked.

Final review resumed on 2026-10-17 from /root/review_release_hardening's completed whole-branch review; verdict With fixes, no Critical, three Important and three Minor. No second review or new live writes.
Final: fixed concurrent explicit retry deadline — concurrent rate limits retain the latest absolute retry deadline RED (three early GETs)→GREEN using maximum absolute deadline; full suite211/211 green.
Final: fixed native session-change coverage — initial session fixture now fails reads and holds explicit recovery until released; old scenario RED timeout on its direct-refetch assumption; replacement clicks RETRY WORKSPACE, confirms receipt/pending, switches account, releases old response and checks private cache/feedback isolation; native7/7 green, /tmp/gogo-recovery-Xyl9tT/report.json.
Final: fixed cleanup accounting core — new private durable live-fixture journal persists uncertain intent before transmission, reconciles lost responses without a returned token, and saves each deletion before/after execution. Missing-module RED→three failure-injection tests GREEN. Old temporary hosted harness is unavailable; no claim of a new hosted replay or integration into that historical harness. Future live harnesses must use the documented journal protocol.
Final: Ruling: replace unavailable temporary hosted cleanup implementation with a tracked, failure-injection-tested journal and explicit integration runbook — historical confirmed cleanup remains evidence, while future automation must adopt the journal before live writes — cost if wrong: adapters still need service-specific reconciliation and idempotent deletion; this run does not verify new live cleanup.
Final: minor (deferred): history report gives no reason for a later missing heap sample when its initial sample succeeded; nullable metrics remain visible.
Final: minor (deferred): history checks post-switch row count but validates unique identities only before switches; baseline is not post-switch identity proof.
Final: minor (deferred): recovery runner close() rejection can prevent report persistence; incomplete cleanup must not be inferred as a passing run.
Final: Ruling: actual backend 429, warm-up, rolling deployment and drain remain open — local fixtures do not prove coordinated operational behavior — cost if wrong: live recovery differences remain undiscovered.
Final: Ruling: cross-node delivery, presence/typing and SSE remain outside this phase — no deployed contract evidence or implementation added — cost if wrong: these capabilities are unavailable.
Final: Ruling: Attachments remain pending R2 and backend gates per user instruction — text-only operation continues — cost if wrong: attachments cannot be accepted yet.
Final: Ruling: hosted new recovery behavior remains unverified until deployment — unchanged Search P4 acceptance stands independently — cost if wrong: release-specific recovery regressions can appear after deployment.
Final: Ruling: production memory budgets, virtualization and polling changes remain follow-ups — baseline records development heap and traffic without an SLA — cost if wrong: production history cost may exceed expectations.
Final: Ruling: legacy account cleanup remains a separate backend/admin action — retained owner and legacy fixtures stay intact — cost if wrong: old fixtures remain until separately resolved.
Final: Ruling: automatic workspace request cooldown coordination remains outside explicit retry ownership — this change guarantees the user-triggered retry deadline only — cost if wrong: another query scheduler may request during a workspace cooldown.
Final: Ruling: private credentials and independent live replay were excluded from review — use sanitized historical response/count evidence and local injection — cost if wrong: independent review cannot attest to credential storage or reproduce the hosted run.
Task 4: complete (commits 203d876..aeea634, tests: npm run check → ✓ built in 529ms)

Final verification 2026-10-17: npm run check passes formatting/lint/types,211 tests in38 files and build. Recovery7/7 passes after corrections. Review corrections committed67bebd6; Task4 completion command ran against aeea634 plus that same working-tree patch before commit. Local JS index-Co9oDiiM.js SHA256 9d41a569403a4a6d76e97bd062205b3d01b66bce948dbbde0c311d1678ca3b14. History6/6, hosted Search8/8, contract29 and search-scroll remain dated2026-10-16 evidence; unchanged flows are not rerun without cause. No push/merge/deploy or new live fixtures. All three Minor grades stand because they limit measurement/failure diagnostics rather than the successful product journeys; limitations are explicitly published.

### Deferred Minor findings follow-up — 2026-10-22

[Local completion evidence](../../PHASE_FIVE_SEVEN_LOCAL_2026-10-22.md) closes all three tool findings: later heap samples now carry explicit unavailable reasons, post-switch history validates the original identity set, and cleanup rejection persists a sanitized report/nonzero exit. Five new tests fail before the initial fixes; review then identifies actual CLI cleanup still outside that boundary, and a sixth regression fails before its correction. Final14 focused tests are green and independently reproduced; correction review has no findings. Native recovery7/7 passes on the corrected CLI; npm check341/341 passes. History records five initial passes, a sixth-run pagination timeout, and a passing bounded1,000-row retry; no uninterrupted six-run success is claimed. Actual hosted/lifecycle/production and broker gates are not closed by this tooling follow-up; broker is explicitly pending by the user.
