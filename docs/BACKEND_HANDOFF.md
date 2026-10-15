# Backend follow-up — 2026-10-15

This handoff records observed backend blockers and pending verification separately. It does not assert that older findings were reproduced on 2026-10-15. Frontend mentions/inbox is implemented. The [07:49–07:54 UTC recheck](./BACKEND_RECHECK_2026-10-15.md) confirms CORS and private-room re-invitation fixes; final-host release acceptance remains open.

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

## 3. Attachments: scanner/provider readiness before frontend work

Reproduced on 2026-10-15: a valid authenticated `POST /api/v1/rooms/{id}/attachments/uploads` returns 503, `attachment uploads unavailable`, with no reservation or signed URL. The underlying provider/scanner configuration has not been audited.

- [ ] Make reservation/storage/scanner dependencies ready and confirm the supported metadata state values and transitions.
- [ ] Provide response-backed evidence for upload, completion/scan, verified message binding, authorized download and deletion.
- [ ] Verify quota, failed scans, expiration, cancellation/retry, leave during upload, duplicate retry and delayed cleanup. Keep unverified files unavailable.

Frontend upload UI remains deferred until these contract/provider gates pass. Evidence: [rich messaging contract](./RICH_MESSAGING_CONTRACT.md).

## 4. Admin cleanup: legacy disposable accounts 35 and 36

The 2026-10-15 read-only audit still finds account 36 in public room 2; account 35 is absent from that membership list. Account deletion remains unconfirmed for both.

The earlier interrupted contract run did not retain usable login/refresh credentials. Last audit: account 35 was no longer a room member, but account deletion was unconfirmed; account 36 retained membership in public room 2 and its retained access token returned 401. This is a cleanup request, not an application feature defect.

- [ ] Inspect and confirm these IDs are the disposable test accounts from that run before changing data.
- [ ] Remove any remaining test memberships and delete the disposable accounts using authorized backend/admin access; record the result.

Messages 203/204 were confirmed tombstones. New acceptance-run accounts 39–46 and their messages were cleaned; do not delete the intentionally retained owner/private-room fixtures. Evidence: [contract cleanup record](./RICH_MESSAGING_CONTRACT.md), [latest cleanup](./MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md).

## 5. Verification follow-ups, not confirmed defects

- [ ] Investigate transient 502 responses seen during message cleanup on 2026-10-15 if server logs remain available. Deletes for messages 253, 254 and 257 later succeeded with 200; no root cause is established.
- [x] Verify ordinary authenticated responses expose `Retry-After` and `X-Request-Id` through CORS (confirmed 2026-10-15).
- [ ] Confirm real rate-limit responses expose the documented request-ID/Retry-After headers to the frontend, then coordinate browser cooldown acceptance. Current client regressions do not prove deployed header behavior.
- [ ] Coordinate final-host WebSocket multi-tab/reconnect acceptance. Cross-node delivery and worker configuration remain unverified; local functional success does not establish distributed guarantees.
- [ ] Resolve or document the cursor validation mismatch: `before=0` returned 200 although Swagger declares a positive minimum (observed 2026-10-14). The frontend only sends positive advancing cursors; this is not the current release blocker.

Owners and completion dates are not assigned in this repository. Close each item with deployed evidence and update [PLAN.md](../PLAN.md); direct-CORS and final-host acceptance require a frontend browser rerun as well as backend checks.
