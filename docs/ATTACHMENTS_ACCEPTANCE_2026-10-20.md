# Attachment frontend acceptance — 2026-10-20

The upload, caption/mention send, history/Search display and authorized-download frontend is implemented on `feat/attachments`. Local checks pass; deployed attachment acceptance remains open because staging is not ready. The [approved design](./superpowers/specs/2026-10-20-attachments-design.md), [execution plan](./superpowers/plans/2026-10-20-attachments.md) and [sanitized evidence](./evidence/attachments-acceptance-2026-10-20.json) describe the boundaries.

**Fresh rerun at 08:43 UTC:** [Retest](./ATTACHMENTS_RETEST_2026-10-20.md) confirms 270 tests, seven native attachment scenarios and the 34-operation checker pass. Health 200/readiness 503 were observed again; both retained registration credentials returned login 401. No authenticated attachment requests were possible; readiness503 is not evidence of an attachment endpoint 503.

## Observed local results

| Check | Result |
| --- | --- |
| `npm run check` | PASS: formatting, ESLint, TypeScript, 270 tests in 49 files, production build |
| `npm run acceptance:attachments` | PASS: seven native Chrome scenarios, complete process cleanup |
| Expanded native pending-send and mobile checks | PASS: room navigation preserves uncertain intent without DELETE; mobile focus restores after Search |
| `npm run acceptance:recovery` | PASS: seven existing simulated recovery scenarios |
| `npm run search:scroll:check` | PASS: scroll preserved on refresh, reset on new query |
| `npm run contract:check` | PASS earlier in this execution: 34 required operations; published 32 paths/42 operations |
| Independent whole-branch review | Three Important findings fixed in one RED→GREEN pass; no Critical or Minor findings; full/native checks pass after fixes |

The seven attachment scenarios cover lost accepted-send response and explicit same-key retry (one canonical message), processing remains non-sendable by Enter, create-only PUT 412 reconciliation without another PUT/reservation, late reservation after room/account changes, binding denial without losing valid room/draft, real download completion/bytes, Search projections, and 390px mobile layout/keyboard interaction. They also assert zero provider authorization/cookie leakage, no unexpected fixture requests, and external-request blocking. Native screenshots were inspected on desktop/mobile; attachment controls and message text remain readable without horizontal overflow.

This is a synthetic backend/storage test, not an R2 or deployed API pass. Storage runs HTTPS on loopback under the exact synthetic host; Chrome trusts only a generated certificate SPKI pin. A deny-by-default loopback proxy enforces the app/API origin allowlist and tunnels only the exact synthetic HTTPS endpoint to 127.0.0.1. Chrome also proxies loopback origins, so a new tab cannot bypass the allowlist before CDP attaches. CDP guards product page requests and injects faults; a native forbidden-popup smoke observes the new target and requires zero requests at its forbidden server. Background Chrome requests are denied and counted, never forwarded. Actual File bytes reach the fixture and are hash-verified. Production HTTPS validation is unchanged. Tickets/credentials and raw provider bodies are absent from committed evidence; temporary downloads and test keys stay outside the repository.

Mounted regressions additionally cover expiry between ticks, observation budgets across hidden/focus boundaries, independent Retry-After deadlines, definite-send ownership return, ambiguous attachment 404 room reauthorization, tombstones/stale Search projections and queued download account replacement. Native testing found and fixed a history-refresh bug: replacing an unchanged message must preserve binding denial rather than immediately re-enable a failed file download.

## Independent review and verified fixes

One fresh-context whole-branch review found three Important issues. Each was reproduced before fixing in a single pass:

1. A queued send could read a replacement account's bearer token. The mutation now checks the captured account/epoch/active intent immediately before the API request; legitimate pending-room navigation remains supported.
2. A temporary authorization pause could strand hashing/reservation/PUT/completion. Still-current work waits for authorization before the next first-attempt write, exits on room/account boundaries, and preserves a completed metadata response while UI/send access remains gated. Regressions cover all four phases and prohibit replayed reservation/PUT/complete.
3. New download tabs could issue their initial request before CDP interception. The loopback origin proxy now guards first navigation and exact CONNECT destinations; native forbidden-new-target smoke and actual TLS download both pass. This alters acceptance tooling only.

Final verification is 270/270 tests, 7/7 native attachment scenarios and 7/7 recovery scenarios. No second reviewer round was dispatched; the author verified fixes through RED→GREEN tests and full checks. There are no deferred Minor findings. Live/provider/deployment behaviors were declined by the reviewer and remain the explicit gates below. All execution rulings and costs are retained in the [plan's execution record](./superpowers/plans/2026-10-20-attachments.md#execution-record).

## Build and contract identity

Final verified source head is `bc4f59b` (review range `256959e..b100c92`, followed by one tested fix pass). JavaScript `index-Br0kQPzZ.js` SHA-256 is `20f400ea2d6c6b0645d950721db6c3e00ada71ca816a07558d9532a570f22839`; CSS `index-B_R2kc9-.css` SHA-256 is `e4f5dac93e129748ea21dda9cac961cb26193ca7c7f33bf5a1465df4a6ebedfc`. Documentation-only handoff commits do not change these assets.

Swagger SHA-256 is `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de`. Published/source contracts establish intended behavior, not deployed privacy or provider behavior. The [2026-10-19 HTTP upload success](./ATTACHMENTS_RECHECK_2026-10-19.md) remains dated evidence and does not establish the later binding/download flow.

## Live service and release gates

A read-only `GET /readyz` at **2026-10-20T03:44:37Z** returned **503**, `ready:false`, request ID `1fbf9fc2ff58a2c00ce5f5fd5df56342`. After resuming the interrupted session, one fresh read-only probe at **08:17:54Z** again returned **503**, `ready:false`, request ID `68aedf9bb8ab5fafa8dcff108908c6b6`. No new registration, upload, room membership or message write was attempted. The underlying service cause is unknown.

Both earlier private registration-recovery directories remain present: `/tmp/gogo-attachments-contract-qfPI80/` and `/tmp/gogo-attachments-contract-tcF6Sy/`. Preserve them and reconcile the two uncertain registration outcomes after recovery before creating fixtures. Their presence does not establish absence or cleanup. Legacy accounts 35/36 remain a separate admin gate.

- [ ] Restore service readiness and reconcile those uncertain registrations. If recovery credentials disappear, require BE/admin reconciliation; never infer cleanup.
- [ ] Verify real upload browser CORS, original-byte hash/create-only PUT, processing failure/expiry and leave-during-upload behavior.
- [ ] Verify caption + files + mentions, canonical same-key retry/changed-body 409, recipient history/Search metadata and safe download bytes/headers against the deployed binary.
- [ ] Verify public departed-member denial, private authorized/unauthorized role matrix, tombstone/deleted-binding denial and account boundaries with disposable fixtures and journaled cleanup.
- [ ] Observe delayed physical object cleanup and quota release separately from logical cancellation.
- [ ] Deploy a compatible reviewed frontend bundle to the selected host, then verify bundle identity, routes, real CORS and native host journeys. No deployment was performed here.

The composer requires a nonblank caption; inbound file-only messages still render. No preview, attachment-only creation, antivirus guarantee, presence/typing, SSE or distributed-delivery guarantee is added. ClamAV remains indefinitely deferred and is not a release gate. Rollback is frontend-only to a known compatible accepted bundle; no schema-13 downgrade safety is inferred.
