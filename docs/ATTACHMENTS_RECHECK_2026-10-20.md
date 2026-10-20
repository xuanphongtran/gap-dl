# Attachments contract continuation — 2026-10-20

The user reports that BE completed Attachments and requests continuing the frontend. The published contract now contains the two missing capabilities: verified atomic message binding and authorized download. Frontend design can proceed from the contract, but authenticated runtime acceptance is currently blocked by service readiness.

## Contract evidence

The deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json) has 32 paths and 42 operations, API 1.0, SHA-256 `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de`. `npm run contract:check` passes its existing 29 required operations/core DTO fields. That checker does not yet pin the new attachment contract.

New published fields and routes:

- Message attachment summaries are typed: id, filename, processed content_type, size_bytes, sha256 and verified.
- Message creation accepts up to five own ready attachment IDs in the same room, with a message-specific Idempotency-Key. The backend also allows empty captions for attachment messages; the initial frontend design retains the existing nonblank-text scope.
- `GET /api/v1/rooms/{id}/messages/{message_id}/attachments/{attachment_id}/download` returns download_url and expires_at. Its summary specifies a 60-second private URL.

The [public frontend handoff](https://github.com/xuanphongtran/gogo-dl/blob/2899b566e8bfdb0807858f37bbcc337bba4f94b8/docs/attachments.md), develop snapshot `2899b566e8bfdb0807858f37bbcc337bba4f94b8`, additionally documents create-only R2 PUT (repeat412), same-key binding retries/conflicts, caption-only edits, safe download headers, ownership/room restrictions, membership and deletion invalidation, quotas and delayed cleanup. This source snapshot is not proof of the exact deployed binary.

The processor is a lightweight policy/sanitization pipeline. The backend explicitly defers ClamAV indefinitely. Frontend labels must describe processing/verification, never claim antivirus coverage or a malware-free guarantee. No new scanner service is required by this frontend phase.

## Runtime probe and cleanup limitation

The two-account probe began at 2026-10-20T02:21:08Z. Its first registration returned 500, before any upload, membership join or message write. Recovery login did not return an account session. A follow-up login at 02:26:49Z returned 401. A single controlled setup attempt with a fresh unique username at 02:27:48Z also returned 500 (request ID `2928222970f16d4f5031ffde8408e46d`), ruling out a fixed username in the harness as a sufficient explanation. Both registration outcomes remain uncertain; retain private credentials and incremental journals for a later cleanup audit. Do not count either account as created or deleted.

`GET /health` returned 200 with status ok. `GET /readyz` returned 503 with ready false. Three bounded follow-up reads also returned 503 through 02:22:44Z; no upload writes were made. One unique-name registration control was made later as described above; no further registrations were attempted. These observations identify an operational readiness failure, not its underlying database/provider cause.

Safe readiness request IDs: `8948cbe1ba70a6f6e8da37f0950e334e`, `76be16463c1f2c3d90c269fc1bd0ecbc`, `5fe74080ea50a64a84b4860ebb5e593f`, `074bf782abb51827f451aad49b977ce7`.

The [sanitized durable report](./evidence/attachments-recheck-2026-10-20.json) records the failed setup and two unconfirmed registration intents. Private recovery artifacts: `/tmp/gogo-attachments-contract-qfPI80/` and `/tmp/gogo-attachments-contract-tcF6Sy/`. No credentials, tokens, URLs or retry keys are copied into the report. Preserve both private directories until cleanup is resolved. Legacy fixtures and retained owner accounts are untouched.

After readiness recovers, reconcile these registrations first. Then run a fresh response-backed journey for ready upload, caption+attachment+mention, same-key retry/conflict, recipient history/Search metadata, authorized bytes and safe headers, departed-member denial and deleted-binding denial. No claim about those journeys is made by this failed probe. Physical delayed deletion, quota release, private-room role checks and final-host/browser acceptance remain separate evidence gates.

## Frontend continuation

[The concrete frontend design](./superpowers/specs/2026-10-20-attachments-design.md) defines the upload state machine, exact retry identity, account/room isolation, download lifecycle, UI and regression/native acceptance boundaries. Product code is unchanged while the design is awaiting review. Continue on `feat/attachments`; do not merge, push or deploy as part of this phase without authorization.

Local Markdown links, sanitized evidence assertions, design placeholder/scope review and `git diff --check` pass. Changes are documentation only; no frontend UI implementation or full-flow runtime pass is claimed.
