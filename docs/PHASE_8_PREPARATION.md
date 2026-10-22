# Phase 8 preparation — release candidate stability

Status: proposed scope for user review; implementation has not started.

Prepared on2026-10-22 from `develop` at `b58254e` (PR17), which contains Phase5–7 follow-up `b787af6`. Their tracked trees match at preparation time. Preparation branch: `docs/phase-eight-preparation`.

## Intended outcome

Make the existing chat client a reproducibly verified local release candidate. The user asked to prepare Phase8 after integrating Phase5–7; the proposed priority is validation reliability and production-build smoke, rather than assuming a new product feature. Confirm this priority before writing the implementation design/plan.

Retain local backend8080 and the existing approved owner9/public room3/private room4 fixtures. Broker/cross-node remains pending by explicit instruction. Hosted runtime and production operational gates remain separate until their environments are available.

## Starting evidence

- Phase4: ten local API/wire/native groups, including cursor convergence, privacy and explicit retry.
- Phase5: seventeen current activity-contract checks and earlier dated native lifecycle/presence/typing evidence.
- Phase6: real provider/core product checks plus actual expiry, hash rejection and controlled navigation cancellation.
- Phase7: reviewed recovery/history report fixes, fourteen focused regression tests and341 repository tests. These results are historical baselines; no tests were rerun for this documentation-only preparation.
- Native recovery7/7 passed. One of six history runs timed out while loading past880 rows; a bounded1,000-row retry passed. Root cause remains unestablished.
- A prior live probe demonstrated that global fixture cleanup can delete another active probe's disposable account. Sequential execution prevented a repeat but does not enforce ownership in tooling.
- Current CI runs `npm ci` and `npm run check` on Node22.18.0. Native acceptance is available as separate commands, not part of that workflow.

Sources: [Phase4](./READ_STATE_LOCAL_ACCEPTANCE_2026-10-22.md), [Phase5–7 follow-up](./PHASE_FIVE_SEVEN_LOCAL_2026-10-22.md), [remaining backend gates](./BACKEND_HANDOFF.md).

## Proposed work packages

| Priority | Package | Deliverable | Acceptance |
| --- | --- | --- | --- |
| P0 | Live fixture ownership | Enforced exclusive use of the approved fixture directory, with documented interrupted-run recovery | A second runner is rejected before writes; cleanup cannot affect a different active run; retained owner/rooms remain intact |
| P0 | History pagination diagnosis | Bounded reproduction of load-older/recovery overlap, sanitized failure evidence, and a regression for the established cause | No timeout-only workaround or unbounded retries; six final history runs pass with original identity sets retained after ten switches |
| P1 | Production-build local smoke | Real browser checks against the built/preview frontend and local8080, preserving normal origin/CORS/TLS | Direct routes, two-account chat/reconnect/revocation, core attachments, desktop/mobile and keyboard smoke pass on the exact built artifact |
| P1 | Repeatable release evidence | One documented validation order and a report that distinguishes failures, retries, cleanup and unavailable gates | Commands return nonzero for failed assertions/incomplete cleanup; final artifact digest and environment are recorded without secrets |

### Fixture ownership

Read `scripts/lib/realtime-live-fixtures.mjs`, `scripts/lib/live-fixture-journal.mjs` and their existing tests before choosing a lock or ownership mechanism. Prefer the smallest change that prevents overlapping live mutation/cleanup. Establish failure behavior for contention, interruption and stale ownership; never silently remove a lock just because a timeout elapsed. Recovery must retain uncertain writes and distinguish confirmed deletion from authentication failure.

Use synthetic tests to prove contention and cleanup boundaries before any real account creation. Keep live jobs serialized while implementation is pending. Credential-bearing registries and recovery files stay private and ignored; public reports contain only sanitized counts/statuses/request IDs.

### History diagnosis

Inspect `RoomChat.vue` load-older behavior, Vue Query pagination and `useWorkspaceRealtime.ts` recovery/cancellation alongside the acceptance runner. Overlap/cancellation is a hypothesis, not an established cause. Record row/page counts, request completion/cancellation and query state without message contents, credentials or raw socket URLs.

Use a deterministic deferred-response regression when the cause is known. Preserve viewed cursor, scroll, drafts and canonical message identity. Avoid changing polling, history retention or adding virtualization without evidence and separate design review. A passing retry remains a retry in reports.

### Built frontend smoke

The current native helper starts a Vite development server. Add or adapt built-artifact serving only after the implementation design is reviewed. Use an available private port; preserve an allowed logical browser Origin if asset remapping is necessary. Do not stop unrelated applications or weaken browser TLS/CORS security.

Generate the build with an explicit local API target and record its digest. Exercise real product interactions against the existing backend. Reuse current acceptance assertions where possible; keep synthetic failure injection explicitly labeled. Authentication setup via private fixtures must not be presented as a login UI pass.

### Release evidence

Order checks so fixture ownership tests and focused regressions run first, repository checks follow, and shared live fixtures are used by one runner at a time. Synthetic suites can run independently when they do not share live registries.

Document an opt-in native acceptance command/workflow before considering mandatory CI browser jobs. Hosted deployment, backend restart/drain or production telemetry requires an available environment and its own execution scope; this phase must not manufacture those results from local fixtures.

## Exit criteria

- [ ] User confirms the proposed Phase8 objective/scope.
- [ ] Written implementation design and task plan are reviewed before code changes.
- [ ] Fixture ownership/contention/interruption regressions pass and prevent shared cleanup interference.
- [ ] History timeout is explained and covered, or remains explicitly unresolved; no false closure from a passing rerun.
- [ ] Final history matrix passes three40-row and three1,000-row runs, preserving post-switch IDs.
- [ ] The production build passes the bounded local desktop/mobile/privacy smoke on its recorded digest.
- [ ] `npm run check` passes; focused/native counts and independent review are recorded.
- [ ] All disposable writes have confirmed cleanup or an explicit unresolved journal; no new owner/room is created.
- [ ] Release checklist preserves hosted/backend/operator gates separately from local frontend acceptance.

## External gates carried forward

| Gate | Owner/evidence needed |
| --- | --- |
| Broker/cross-node | Pending by user instruction; later needs two instances/shared delivery infrastructure |
| Activity/read-state AsyncAPI publication | Backend publishes the already observed runtime schemas |
| Physical R2 cleanup/quota release | Operator verifies delayed worker completion, object absence and released quota |
| Real warm-up/rolling deployment/graceful drain | Coordinated backend lifecycle observation |
| Hosted affected-flow acceptance | Working public API and selected-host native rerun when local-only scope changes |
| Production traffic/latency/memory budgets | Actual rollout measurements and agreed budgets |

A local release candidate can complete its own bounded frontend checks while these gates remain pending. Full deployed acceptance must retain their unchecked status.
