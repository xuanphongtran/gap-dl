# Attachments readiness recheck — 2026-10-19

The user reports that upload storage and scanner setup is complete and requests resuming pending Attachments work. A fresh authenticated probe confirms reservation, object upload and successful scanning. Full chat attachments still cannot ship: sending the same verified attachment returns 503, and no authorized download route is published.

Work resumes on `feat/attachments` from the reviewed Release hardening baseline `40f9125`. No product flow, deployment or legacy fixture was changed during this recheck.

## Response-backed evidence

API: `https://gogo-dl.onrender.com`. Probe began at 2026-10-19T08:05:16Z. One new disposable account joined an existing public room; no room was created. A small harmless text file was used; no malicious scanner sample or request flood was sent. The [sanitized response/count record](./evidence/attachments-recheck-2026-10-19.json) is retained in the repository. Private credentials and incremental cleanup journals remain outside the repository.

| Operation | Result | Meaning |
| --- | --- | --- |
| Register disposable account | 201 | Fresh independent account |
| Join public room | 200 | Current authorized room member |
| Reservation OPTIONS from sandbox origin | 204; Idempotency-Key allowed | API preflight header gate passes; not R2 browser CORS acceptance |
| Reserve attachment with SHA-256 and exact byte length | 201 | Upload admission is enabled |
| PUT harmless bytes using the returned ticket | 200 | Object store accepts the ticket; no API bearer token sent to storage |
| POST complete | 202 | Scan queued; not treated as verification |
| GET metadata after bounded polling | 200; state ready; verified true | Scanner/promotion succeeds for this text fixture |
| POST message with the verified attachment ID and nonblank content | 503 | Message binding remains unavailable; no message created |

Upload cancellation, membership removal and account deletion were acknowledged successfully by the API. All four private journal intent groups finish with zero unconfirmed entries. The message journal contains a definitively rejected intent, not a created/deleted message. Cancellation schedules delayed cleanup; this probe does not prove physical object deletion or quota release. No legacy account, retained owner or room ownership was modified.

## Published contract and source corroboration

Current [Swagger](https://gogo-dl.onrender.com/swagger/doc.json) is API 1.0, 31 paths and 41 operations, SHA-256 `01821bc26514fae1ccc25ad616f9c401422fa5a98ddca25cecebe12cbf1efafb`. It documents reservation, owned metadata, completion and cancellation. Metadata has no state enum, message attachments are untyped objects, `attachment_ids` remains marked reserved, and no download endpoint is listed.

The public backend develop snapshot `72b0f0b90d06a94ce7db6d6ea63d427bb968dd30` corroborates the remaining work; it is source evidence, not proof of the exact deployed commit:

- [Message service](https://github.com/xuanphongtran/gogo-dl/blob/72b0f0b90d06a94ce7db6d6ea63d427bb968dd30/internal/chat/service.go) rejects any nonempty attachment ID list with AttachmentsUnavailable.
- [Attachment routes](https://github.com/xuanphongtran/gogo-dl/blob/72b0f0b90d06a94ce7db6d6ea63d427bb968dd30/internal/attachment/handler.go) expose only reservation, owned metadata, completion and cancellation.
- [Backend rich messaging plan](https://github.com/xuanphongtran/gogo-dl/blob/72b0f0b90d06a94ce7db6d6ea63d427bb968dd30/plan/08-rich-messaging.md) still leaves atomic message binding, attached states and signed download unchecked.

AsyncAPI SHA-256 is `722cf23964d0c4af8bbad1cf6742ce26f2fcbb49522a94984fc8f9ec0a03f075`; no attachment scan lifecycle schema is published. A future upload UI can poll authorized metadata instead of inventing WebSocket events.

## Remaining backend handoff

1. Implement and deploy atomic binding of ready, verified, current-member-owned attachments to a text message. Publish duplicate retry, expiry, quotas and conflict behavior, including sends that also mention users. Cross-room/other-user/unverified/cancelled/expired IDs must remain denied.
2. Publish a typed attachment projection in messages/history/Search and an authorized download endpoint. Specify response shape, expiry, safe response headers and revocation/deletion behavior. Owned upload metadata alone cannot serve other room members' downloads.
3. Publish the state/transition enum and supported file types, size/count/quota limits, retry windows and cancellation semantics. The source currently accepts PNG/JPEG/plain text up to 10 MiB; validate the deployed contract before mirroring those limits in UI.
4. Complete remaining provider/privacy evidence: R2 browser CORS, create-only/late-write behavior, rejected/expired scans, delayed deletion and quota release. Keep those gates separate from this successful small-file scan.

## Frontend continuation once binding/download are available

Preserve text and mentions while adding select → validate/hash → reserve → upload progress/cancel → complete → scan status → explicit send. Keep signed tickets and File objects in ephemeral local state, use a storage transport without API authorization interceptors, and never automatically replay sends. Pinia remains session-only; Vue Query owns safe authorized metadata with account/room-scoped cache keys. Clear upload work on logout, account change and membership loss; preserve existing draft behavior.

After contract verification, write the attachment flow design and implementation plan, then cover same-key response loss, upload cancellation, stale scan completion, membership/account isolation, safe download and mobile/keyboard journeys. Keep attachment-only messages, presence/typing, SSE and distributed operations outside this slice. No upload control is enabled while the final send would deterministically fail with 503.

## Repository verification

`npm run contract:check` passes: 29 required operations and core DTO fields, 31 paths and 41 operations, matching the Swagger hash above. `git diff --check`, local Markdown link checks and sanitized evidence/cleanup assertions pass. Only documentation and sanitized evidence changed; no product code or native browser journey is claimed by this recheck.
