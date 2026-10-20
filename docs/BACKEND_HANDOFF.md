# Backend follow-up — 2026-10-15

This handoff records observed backend blockers and pending verification separately. It does not assert that older findings were reproduced on 2026-10-15. Frontend mentions/inbox is implemented. The [07:49–07:54 UTC recheck](./BACKEND_RECHECK_2026-10-15.md) confirms CORS and private-room re-invitation fixes; [sandbox release acceptance](./SANDBOX_RELEASE_ACCEPTANCE_2026-10-16.md) now passes on the named host.

## 1. Resolved: allow Idempotency-Key through CORS

Earlier failure confirmed on 2026-10-15 for origins `http://localhost:3000` and `https://chat-sb.xuanphong.io.vn`.

A preflight requesting `authorization,content-type,idempotency-key` receives an allowed origin but `Access-Control-Allow-Headers: Origin,Content-Type,Authorization`. Chrome rejects the mention POST before sending it with `HeaderDisallowedByPreflightResponse` (`idempotency-key`) and a fetch `TypeError`.

- [x] Add `Idempotency-Key` to allowed request headers for supported frontend origins, retaining existing authorization/content headers.
- [x] Verify OPTIONS for the room message endpoint accepts all three requested headers.
- [x] Coordinate direct two-account browser acceptance without the temporary same-origin proxy: mention send, lost-response explicit retry with the same key, canonical message identity, and inbox delivery.

Recheck: both preflights now allow the header; direct local-branch Chrome send and accepted-response-loss retry passed without a proxy. Hosted deployment remains separate.

The frontend must retain the header and immutable retry payload. HTTP/proxy success alone does not close this gate. Evidence: [mentions/inbox acceptance](./MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md).

## 2. Resolved: private-room re-invitation after removal

Confirmed in the 2026-10-13 acceptance; not reverified in the latest mentions/inbox run. After removing an accepted member, re-inviting returns the old accepted invitation while the removed member remains unauthorized.

- [x] Correct invitation/membership lifecycle so an authorized manager can invite the removed user again and the user can explicitly accept a valid invitation.
- [x] Verify remove → re-invite → pending invitation → accept → fresh authorized membership. Preserve denial before acceptance and prevent old notification-generation rows from returning after rejoin.

Recheck: fresh pending invitation 29, denial before acceptance, restored access after acceptance, and absence of old feed rows passed on 2026-10-15.

Public-room leave/rejoin checks pass and do not close this private-room gate. Evidence: [plan](../PLAN.md), [sandbox acceptance](./ACCEPTANCE_2026-10-13.md), [rich messaging contract](./RICH_MESSAGING_CONTRACT.md).

## 3. Attachments: contract ready, frontend implemented, runtime acceptance pending

User update 2026-10-20 reports completion. [Fresh contract evidence](./ATTACHMENTS_RECHECK_2026-10-20.md) confirms binding, typed summaries and the new download endpoint. The 2026-10-19 reservation/upload/ready success remains valid dated evidence. Backend processing is lightweight policy/sanitization; ClamAV is explicitly deferred and is not a frontend release gate.

- [x] Publish atomic binding and typed message/history/Search attachment summaries, with at most five own ready files, same-key retries/conflicts and mixed mentions.
- [x] Publish authorized 60-second download, expiry/safe headers and membership/deletion semantics in Swagger and the backend frontend handoff.
- [ ] Restore staging readiness and authenticated account setup: first registration returned 500 at 2026-10-20T02:21:08Z; health 200, readiness 503/ready:false persisted through 02:22:44Z. Readiness request IDs: `8948cbe1ba70a6f6e8da37f0950e334e`, `76be16463c1f2c3d90c269fc1bd0ecbc`, `5fe74080ea50a64a84b4860ebb5e593f`, `074bf782abb51827f451aad49b977ce7`. The underlying cause has not been identified; do not label it a scanner failure.
- [ ] Reconcile the two uncertain registrations using retained private credentials/journals after service recovery. The controlled unique-username attempt also returned 500, request ID `2928222970f16d4f5031ffde8408e46d`. No upload, membership or message was created by this attempt. Credentials are not copied into the report; legacy fixture cleanup remains separate.
- [ ] Verify actual binding/download, same-key canonical identity, recipient metadata, departed-member/deleted-binding denial and download headers against the deployed binary. Published/source tests alone do not close these runtime gates.
- [ ] Verify R2 browser CORS, failed/expired processing, leave during upload, physical delayed cleanup and quota release. Logical cancellation and physical object deletion remain different observations.

Frontend upload/send/download is implemented on `feat/attachments`; [local acceptance](./ATTACHMENTS_ACCEPTANCE_2026-10-20.md) records synthetic native and mounted checks. A single fresh GET /readyz at 2026-10-20T03:44:37Z still returned 503/ready:false, request ID `1fbf9fc2ff58a2c00ce5f5fd5df56342`. After the interrupted session resumed, one fresh read-only readiness probe at 08:17:54Z again returned 503/ready:false, request ID `68aedf9bb8ab5fafa8dcff108908c6b6`. No new live writes were attempted; both historical private journal directories are still present. This does not close runtime/provider or selected-host deployment gates. Preserve private recovery evidence in `/tmp/gogo-attachments-contract-qfPI80/` and `/tmp/gogo-attachments-contract-tcF6Sy/` until both registration outcomes are resolved. No extra signup/upload flood, service restart, migration or deployment was performed.

Latest [fresh test rerun](./ATTACHMENTS_RETEST_2026-10-20.md), 08:43 UTC: health 200, readiness 503 (`a1e6313dee27438282cf16d30d6872c1`), Swagger 200, and both retained registration credentials return login 401. No new registration or attachment resource writes were attempted. Login401 does not establish absence/cleanup; no fresh attachment-endpoint 503 has been observed. Local 270 tests and all seven synthetic native attachment scenarios pass.

The user has switched testing to local port 8080 because Render quota is exhausted. [Local verification](./ATTACHMENTS_LOCAL_ACCEPTANCE_2026-10-20.md) confirms readiness 200, registration/profile/native auth and cleanup of two disposable accounts. There is no available local public room, so attachment testing awaits a room fixture or explicit cleanup/retention strategy. This closes local availability/auth checks only; it does not resolve the old Render registrations or prove provider/binding/download behavior.

## 4. Admin cleanup: legacy disposable accounts 35 and 36

The 2026-10-15 read-only audit still finds account 36 in public room 2; account 35 is absent from that membership list. Account deletion remains unconfirmed for both.

The earlier interrupted contract run did not retain usable login/refresh credentials. Last audit: account 35 was no longer a room member, but account deletion was unconfirmed; account 36 retained membership in public room 2 and its retained access token returned 401. This is a cleanup request, not an application feature defect.

- [ ] Inspect and confirm these IDs are the disposable test accounts from that run before changing data.
- [ ] Remove any remaining test memberships and delete the disposable accounts using authorized backend/admin access; record the result.

Messages 203/204 were confirmed tombstones. New acceptance-run accounts 39–46 and their messages were cleaned; do not delete the intentionally retained owner/private-room fixtures. Evidence: [contract cleanup record](./RICH_MESSAGING_CONTRACT.md), [latest cleanup](./MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md).

## 5. Verification follow-ups, not confirmed defects

[Release hardening evidence](./RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md) adds a passing local simulated 503/429/retry matrix and hosted Search acceptance. It does not close the live backend/operations items below. Attachments remains pending R2; no reservation probes were repeated in this phase.

- [ ] Investigate transient 502 responses seen during message cleanup on 2026-10-15 if server logs remain available. Deletes for messages 253, 254 and 257 later succeeded with 200; no root cause is established.
- [x] Verify ordinary authenticated responses expose `Retry-After` and `X-Request-Id` through CORS (confirmed 2026-10-15).
- [ ] Confirm real rate-limit responses expose the documented request-ID/Retry-After headers to the frontend, then coordinate browser cooldown acceptance. Current client regressions do not prove deployed header behavior.
- [x] Coordinate sandbox-host WebSocket multi-tab/reconnect acceptance: native hosted journeys and a separate active-socket logout probe pass on 2026-10-16; see [release evidence](./SANDBOX_RELEASE_ACCEPTANCE_2026-10-16.md).
- [ ] Verify cross-node delivery and worker configuration; sandbox functional success does not establish distributed guarantees.
- [ ] Resolve or document the cursor validation mismatch: `before=0` returned 200 although Swagger declares a positive minimum (reproduced 2026-10-16). The frontend only sends positive advancing cursors; this is not the current release blocker.

Owners and completion dates are not assigned in this repository. Close each item with deployed evidence and update [PLAN.md](../PLAN.md); direct-CORS and final-host acceptance require a frontend browser rerun as well as backend checks.

## 6. Phase 5 local completion and AsyncAPI publication drift — 2026-10-20

[Local completion acceptance](./REALTIME_COMPLETION_ACCEPTANCE_2026-10-20.md) verifies presence/typing/lifecycle against local port 8080, including native two-account/multi-tab behavior, reauthorization, removal/reinvitation and cleanup. No Render retry or backend changes were performed. Owner 3 and rooms 1/2 are intentionally retained; disposable guest resources are journaled separately.

- [x] Verify runtime against written BE `spec/07-presence-read-state.md` at `e8f7041`: snapshots, first/last-tab presence, start/refresh/null stop/expiry and activity errors.
- [ ] Publish `presence_snapshot`, `presence`, `typing_started`, `typing_stopped`, `read_state` and client typing commands in AsyncAPI, including string room IDs, aggregate per-user semantics, 5000ms expiry and error codes. Current lifecycle Message DTOs are published and consumed as REST reconciliation hints.
- [ ] Accept the new frontend bundle on the selected deployment origin; earlier hosted evidence does not cover it.
- [ ] Verify distributed/cross-node/SSE behavior through its own contract and rollout. Local process success is not evidence for those guarantees.

Further Phase 4 work remains pending. Attachment storage/provider acceptance retains its separate gate.
