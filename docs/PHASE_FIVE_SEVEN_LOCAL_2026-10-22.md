# Phase 5–7 local completion follow-up — 2026-10-22

The remaining frontend checks and three previously deferred acceptance-tool defects were addressed on `test/phase-five-seven-completion`, based on `d14ad0e`. The user explicitly keeps broker/cross-node work pending and continues with local8080. This record closes the stated local checks without marking unavailable hosted/backend operational evidence complete. [Sanitized results](./evidence/phase-five-seven-local-2026-10-22.json) preserve failures, retries, cleanup and review outcomes.

## Phase 5

All17 current local activity-contract checks pass: real authenticated sockets, snapshot schema, membership privacy, first/last-tab aggregation, typing identity/deadline, rate limiting, refresh/explicit null stop/expiry, duplicate subscription and revocation. REST Swagger and AsyncAPI hashes remain unchanged. Earlier eight synthetic/seven native local completion groups retain their dates; their unchanged implementation was not rerun wholesale.

The inspected AsyncAPI still omits presence/typing/read-state schemas. That publication is backend-owned; passing runtime tests do not publish a contract. Current-source hosted asset identity was established earlier, but functional acceptance of those features on a working hosted API remains pending under local-only testing.

## Phase 6

Fresh real-backend edge checks pass:

- A harmless TXT body whose reserved hash deliberately differs is uploaded to real R2, completed, and reaches `rejected` with `verified:false`. Binding it to a message returns409. This checks original-byte integrity rejection, not an antivirus guarantee.
- A reservation is observed through its actual five-minute upload deadline, without changing the backend clock/configuration or shortening the ticket in a fixture. After expiry, completion409, same-key reservation409 and message binding409 are confirmed.
- Native Chrome selects a file in the real product. The provider PUT is paused before dispatch, then actual router navigation discards the selection. The backend acknowledges cancellation204; no provider bytes, completion request or message send occur. Returning to the room shows no discarded upload. This is controlled cancellation evidence, not an uncontrolled mid-stream provider outage.

The earlier core seven API/provider groups and four product picker/send/download/mobile checks remain separate evidence. Local core and extended edge acceptance are now recorded. Physical R2 deletion, delayed worker completion and released quota still require backend/operator evidence: cancellation204/account deletion schedules cleanup but does not prove the provider object is gone.

Initial harness limitations are preserved privately: the activity helper's global fixture cleanup deleted an edge-test guest while its expiry observer waited. The observer was stopped and its logical journal reconciled against that explicit deletion204; the expiry check was restarted and all subsequent live fixture runs serialized. The first navigation run passed both product assertions but hit a CDP observation error during cancellation; the instrumented rerun passes both checks with no handler errors. No product bug/fix is inferred from those probe failures.

## Phase 7 frontend tooling

Three Minor findings from the release-hardening review are fixed with regression tests:

1. Recovery reports survive cleanup rejection, return failure, and expose only `cleanupComplete:false`. Actual CLI app/API cleanup now runs through that same report boundary. Both resources get a cleanup attempt even if one throws; provider/error details are excluded.
2. Missing/invalid idle or post-switch heap samples have explicit reasons even when the initial sample succeeded. Unavailable values remain null rather than invented measurements.
3. The history runner verifies the complete message-ID set after ten room switches, catching duplicates or different identities with the same row count. IDs remain excluded from public reports.

Five regression cases first fail on the original code. The independent review finds one remaining CLI cleanup wiring problem; its added test also fails before correction. All14 focused tests then pass, independently reproduced by the reviewer; the correction receives no further findings. No runtime/UI dependency or polling behavior changes.

Native recovery passes7/7 after final cleanup wiring. The new history check yields five successful initial baseline runs; the sixth times out during initial pagination at880 rows. A bounded1,000-row retry with additional diagnostics passes, including post-switch set equality and explicit heap-sample fields. The first failure remains visible; its root cause is not established, and this is not described as an uninterrupted6/6 run. These are synthetic development-app measurements, not production traffic, latency budgets or post-GC retained-memory guarantees.

## Cleanup and remaining environment gates

The final cumulative fixture journal has143 confirmed/0 unresolved entries. The fresh edge journal has7 confirmed/0 unresolved; final native mutation cleanup has0 unresolved. Reservations were canceled204 and disposable accounts deleted204. Owner9/rooms3/4 remain intentionally retained; no new owner/room was created. Original owner3/rooms1/2, historical Render registrations and legacy account cleanup remain separate.

Private journals and archived diagnostic scripts remain in the ignored, permission-restricted `.realtime-fixtures.local/phase567-2026-10-22/` directory. No backend source/config change, process restart, direct database mutation, Render API call, push or deployment occurred.

| Remaining gate | Required evidence |
| --- | --- |
| Broker/cross-node | Explicitly pending by user instruction; later needs two instances and shared delivery infrastructure |
| Hosted functional acceptance | Working selected-host API environment and native affected-flow smoke; current user scope is local only |
| AsyncAPI publication | Backend publishes observed activity/read-state schemas |
| Physical object cleanup/quota | Operator verifies delayed worker success, object absence and quota release for journaled IDs |
| Real warm-up/rolling deployment/drain | Coordinated backend lifecycle observation; synthetic503/reconnect checks do not substitute for it |
| Production traffic/latency/memory | Actual rollout measurements and agreed budgets |
| History benchmark stability | One retained pagination timeout requires diagnosis if repeated; bounded targeted retry passed |

These gates are not absent frontend features and remain unchecked in PLAN.md. SSE stays outside the approved feature slice.

## Repository verification

`npm run check` passes formatting, lint, typecheck,341 tests in55 files and production build. `git diff --check` passes. The only committed executable changes are in the recovery/history acceptance tooling and its regression tests.
