# REST API contract baseline

**Attachment continuation (2026-10-20):** [Published contract](./ATTACHMENTS_RECHECK_2026-10-20.md) now includes typed summaries, five-file binding and authorized 60-second download. Swagger has 32 paths/42 operations, SHA-256 `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de`; the existing 29-operation checker passes. Runtime registration 500 and readiness 503 prevent a fresh full-flow acceptance; two uncertain registrations remain journaled for cleanup. Earlier binding/download absence below is historical.

**Attachment recheck (2026-10-19):** [Authenticated evidence](./ATTACHMENTS_RECHECK_2026-10-19.md) confirms upload admission, object PUT, completion and ready/verified scanning. A message containing that verified attachment still returns 503. Swagger has no download endpoint or typed message attachment schema; those remain BE gates. Current Swagger SHA-256 is `01821bc26514fae1ccc25ad616f9c401422fa5a98ddca25cecebe12cbf1efafb` (31 paths, 41 operations). Earlier scanner-blocked findings below are historical.

**Release hardening continuation (2026-10-16):** [Acceptance](./RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md) closes the named sandbox Search query/pagination/freshness/privacy gate. Local 503/429/retry checks and history measurements are separate synthetic evidence; actual rate-limit/operations gates remain open. The new recovery source is not yet deployed.


**Hosted continuation (2026-10-16):** [Sandbox release acceptance](./SANDBOX_RELEASE_ACCEPTANCE_2026-10-16.md) closes the named sandbox's WebSocket multi-tab/reconnect and Mentions/Inbox deployment gates with native browser evidence. Earlier deployment limitations below are historical. Attachments and operational/distributed gates remain open.


**Later recheck (2026-10-15, 07:49–07:54 UTC):** [Fresh backend evidence](./BACKEND_RECHECK_2026-10-15.md) confirms CORS header allowance, direct Chrome send/retry, private re-invitation, and response-header exposure. These fixes supersede the earlier blocker descriptions below; attachments, legacy cleanup and final deployment remain open.


This is the frontend's reviewed snapshot of the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json). Recheck that document before changing endpoint code. The snapshot records documentation, not proof that authenticated operations work with real accounts.

## Mentions/inbox continuation: 2026-10-15

[Frontend acceptance](./MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md) records reviewed implementation, 191 passing tests, and native Chrome functional acceptance through a temporary same-origin proxy. Direct browser sends remain blocked: backend CORS omits `Idempotency-Key` from allowed request headers for the frontend origins. Backend correction and direct/deployed acceptance remain required; the proxy does not close this gate.

## Rich messaging review: 2026-10-14

The current Swagger hash and operation count are unchanged from 2026-10-13. [Authenticated rich messaging probes](./RICH_MESSAGING_CONTRACT.md) verify typed mention sends, idempotent retry/conflicts, asynchronous private notification delivery, cursor pagination, read ownership/idempotence, preference booleans, deleted references, and public leave/rejoin generation isolation. Attachments remain blocked: valid reservation requests return 503 while the scanner is pending. Mentions/inbox can proceed to frontend design independently. HTTP checks do not close browser/release gates; the evidence records an interrupted fixture-cleanup limitation.

## Previous review: 2026-10-13

Swagger still reports API version 1.0, now with 31 paths and 41 operations, SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`. `npm run contract:check` passes the current client's required routes and core DTO fields. Attachment upload/complete/get/delete, notification inbox/read, and room/account notification preferences are now documented; runtime authorization, privacy, and provider behavior for these additions have not been accepted.

[Sandbox browser acceptance](./ACCEPTANCE_2026-10-13.md) verifies invitation/send/history, lifecycle manager permissions and reloads, multi-tab read state, and explicit retry after an injected failed read-state write. Sandbox CORS and route fallback pass. Re-invitation after private-room removal is blocked: POST returns the original accepted invitation, the recipient has no pending invitation, and room access remains 404. A natural login 429 was observed with UI feedback; Retry-After/countdown remain unverified. An authenticated profile response exposes only Content-Length through CORS, leaving browser access to X-Request-ID and Retry-After unresolved. The sections below preserve the earlier snapshot and its historical findings.

## WebSocket review: 2026-10-14

The [WS contract record](./WEBSOCKET_CONTRACT.md) describes the first event-triggered REST integration. Eight local-branch browser smoke checks with the deployed backend passed; a separate authenticated sandbox-origin upgrade returned 101. The new frontend has not been deployed to sandbox. REST remains authoritative for writes, revision/tombstone merging, and read state, and five-second polling stays enabled. Published AsyncAPI omits the presence envelopes observed at runtime and complete lifecycle/read-state events; those gates remain open.

## Search review: 2026-10-14

[Authenticated Search evidence](./SEARCH_CONTRACT.md) verifies query bounds, complete Message DTOs, descending-ID exclusive cursor pagination, plain-text AND matching, edits/deletion exclusion, invited access, and private/public nonmember denial. Twelve checks passed; disposable messages and the guest account were cleaned up. Frontend Search implementation and browser acceptance remain open.

## Snapshot and reachability

| Item | Observed on 2026-10-02 |
| --- | --- |
| Swagger document | Swagger 2.0, API version `1.0`; 24 paths and 31 HTTP operations |
| Document SHA-256 | `ed10262eab3c56d7fb4a6fec775266d1379c62f8d01af0e6d9ec21f4dbd4cd09` |
| Browser API origin | `https://gogo-dl.onrender.com` by default; override with `VITE_API_BASE_URL` |
| Swagger `host` | `localhost:8080`; do not use this field as the deployed browser origin |
| Health | `GET /health` returned `200` with `{ "status": "ok", "time": "..." }` and `X-Request-ID` |
| Browser preflight | `OPTIONS /api/v1/users/me` from `http://localhost:5173` returned `204`, allowed `Authorization` and `Content-Type`, and echoed the origin |
| Unauthenticated request | `GET /api/v1/users/me` returned `401`, `{ "error": "unauthorized" }`, and `X-Request-ID` |

The first three probes are read-only. The authenticated checks below used disposable accounts. Other frontend origins, rate-limit headers, and production hosting remain unverified.

## Refreshed API contract

The 2026-10-02 refresh added `GET /livez`, `GET /readyz`, and `GET /readyz/realtime` without removing existing operations. All three returned `200` with a boolean health field (`live` or `ready`). They are deployment probes, not chat UI routes.

Swagger now marks `Room.role` nullable. It also specifies nonblank message content of at most 4,000 UTF-8 bytes after trimming. A content validation failure returns `400`; `413` means the entire HTTP request body exceeds `HTTP_MAX_BODY_BYTES`. An authenticated boundary probe sent 1,000 emoji (4,000 UTF-8 bytes) with `201`, deleted that test message with `200` and an empty tombstone, and received `400` for 1,001 emoji (4,004 UTF-8 bytes). The frontend composer now counts trimmed UTF-8 bytes and retains an over-limit draft for editing.

The previous Swagger snapshot had 20 paths, 27 operations, and SHA-256 `cda46b4f15b0d28bd753fd8c415739731e457cdb26edd67cf95ee0416b36c8d2`. Its missing `Room.role` nullability and ambiguous `400`/`413` descriptions are resolved in the refreshed document.

The latest refresh added `GET /api/v1/rooms/{id}/messages/search` to the prior 23-path, 30-operation snapshot. Search remains outside the current frontend phase and needs authenticated response and privacy checks before implementation.

## Phase 2 runtime findings

Additional disposable accounts were used for a public-room journey and deleted afterward. A public room remains under the retained test owner because the API has no room-deletion operation.

| Endpoint or behavior | Observed result |
| --- | --- |
| `GET /api/v1/rooms` before public join | Returned the public room with `role: null`; the refreshed Swagger now declares that nullability |
| `GET /api/v1/rooms/{id}` before public join | Returned `200` with `role: null` |
| Member and message reads before public join | `403` for both; public detail visibility does not grant history access |
| `POST /api/v1/rooms/{id}/join` | Initial and duplicate join each returned `200` |
| `DELETE /api/v1/rooms/{id}/membership` | Initial and duplicate leave each returned `204`; message reads after leave returned `403` |
| `POST /api/v1/rooms/{id}/messages` with empty or 4,001-character content | Both returned `400` with `{ "error": "invalid request" }` and `X-Request-ID`; the refreshed Swagger clarifies why this is `400` |

The frontend now treats `role: null` as a discoverable public room, shows a join action, and avoids members/messages requests until membership exists. It keeps public discovery after membership loss while clearing private room data. The `400` validation response is mapped to a message-length hint in the composer. No actual `429` or `Retry-After` header has been observed yet; the Axios normalization and bounded countdown are covered by mocked tests.

A headless Chrome smoke against the deployed API through `http://localhost:5173` completed owner login and private-room navigation, then visitor registration, public-room join, leave, and return to the join state without browser console errors. The disposable visitor was deleted with `204`. Desktop and mobile join-state layouts were also inspected with a local mock API. Final production-host CORS remains unverified.

## Authenticated smoke on the deployed origin

Six disposable accounts were registered on 2026-10-02. Four were deleted after the checks. One owner account and its private room remain because account deletion returned `409` while that account owns a room; the API exposes no room-deletion route. An additional account was registered during a failed smoke attempt before its credentials were saved; it was never invited to the room and cannot be cleaned up with the available API. Credentials and tokens for the retained owner are stored only in a local temporary file outside the repository.

| Journey | Observed result |
| --- | --- |
| Register, login, profile, refresh | `201`, `200`, `200`, `200`; `expires_at` is Unix seconds; refresh returned the same refresh-token value in this run |
| Private-room concealment | Uninvited account got `404` and `{ "error": "not found" }` |
| Create, invite, inbox, accept | Room `201`, invitation `201`, pending invitation visible, accept `200` |
| Send and history | Send `201`; message appeared in another member's history with revision and nullable lifecycle fields |
| Older-page cursor | `before` excluded its message ID; sampled page IDs were in descending order |
| Deleted author | After a member sent messages, left, and deleted their account, history retained the messages with `user_id: null` |
| Leave and account deletion | Member leave `204`, member account deletion `204`; owner account deletion `409` with `cannot delete account while owning rooms` |
| Owner room reads | Room list, owned room detail, and member list returned `200`; the room detail and member list identified the owner |
| Owner membership actions | Owner leave returned `409` with `owner transfer required`; promotion and demotion returned `204`; removal returned `204` and the removed member then got `404` for room detail |
| Ownership transfer | Transfer to an accepted member returned `204`; the successor's room detail reported `owner`; the former owner then left and deleted their account with `204` responses |
| Diagnostics | Sampled success and failure responses had `X-Request-ID`; no `429` was produced, so `Retry-After` is unverified |

At the Phase 1 checkpoint, these were HTTP client checks, not browser end-to-end tests. Public-room join, invitation decline, profile update, validation boundaries, and final-host CORS had not been exercised. The later Phase 2 and refreshed-contract sections above record subsequent checks. The first owner-action smoke attempt used an expired access token and got `401`; a fresh login resolved it.

## Operation coverage

| Area | Documented operations | Frontend status |
| --- | --- | --- |
| Authentication | Register, login, refresh | Implemented; refresh is in `src/lib/http.ts` |
| Profile | Get, update, delete `/api/v1/users/me` | Implemented |
| Rooms | List, create, get, join, leave, transfer ownership | Implemented |
| Invitations | Create, list personal, accept, decline | Implemented |
| Members | List, change role, remove | Implemented |
| Messages | List with `limit`/`before`, send | Implemented |
| Message lifecycle | `PATCH` and `DELETE /api/v1/rooms/{id}/messages/{message_id}` | Implemented in frontend phase 3; author and forbidden-member behavior verified against the deployed API |
| Message search | `GET /api/v1/rooms/{id}/messages/search` | Documented; frontend implementation and authenticated behavior pending |
| Read state | `GET` and `PUT /api/v1/rooms/{id}/read-state` | Implemented in frontend phase 4; deployed two-account smoke verified cursor/unread behavior |
| Presence | `GET /api/v1/rooms/{id}/presence` | Documented; frontend presence remains deferred with WebSocket work |
| System health | `GET /health`, `/livez`, `/readyz`, `/readyz/realtime` | Deployment probes; no application screen |

Attachments, mentions, notification inbox, and WebSocket event schemas are absent from this REST Swagger snapshot. Search is documented but still needs authenticated behavior and privacy checks before frontend work.

## DTO and limit checks

- `Message` includes `id`, `room_id`, `content`, `created_at`, `username`, `revision` (minimum 1), nullable `user_id`, nullable `edited_at`, and nullable `deleted_at`. Phase 1 aligned the frontend type without adding lifecycle UI.
- `GET /api/v1/rooms/{id}/messages` accepts `limit` from 1 to 100 (default 50) and `before` as a positive message ID. The frontend requests 40 and merges pages by ID. The authenticated sample excluded IDs at or above the cursor and returned a descending page.
- `POST /api/v1/rooms/{id}/messages` documents nonblank content of at most 4,000 UTF-8 bytes after trimming. Content over that limit returns `400`; an oversized HTTP body returns `413`. Create room name is 1–100; registration username is 3–50 and password has minimum length 8.
- `PATCH /api/v1/rooms/{id}/messages/{message_id}` takes `{ content, revision }`, returns a Message, and documents `409` for conflict. `DELETE` returns a Message tombstone. The Phase 3 UI uses both endpoints; the sandbox browser smoke verifies conflicts, permissions, and reload persistence.
- `GET/PUT /api/v1/rooms/{id}/read-state` returns `{ room_id, last_read_message_id, unread_count }`; PUT requires a positive `last_read_message_id`. The Phase 4 UI uses these endpoints for visible-message acknowledgements and server-backed unread badges.
- Successful membership, ownership, and account-deletion operations can return `204` with no body. The common error schema currently contains only an `error` string; field-specific error codes are not documented.

## Open verification gates

1. Complete a two-account browser invitation/send/history journey. Owner login/private navigation and visitor registration/public join/leave already passed in Chrome; the earlier HTTP checks establish message and invitation route behavior.
2. Confirm invitation decline, profile update, and other validation/size-limit responses. Public-room join and duplicate join/leave are verified. Avoid generating `429` solely for a smoke test.
3. Confirm `Retry-After` on a naturally observed `429` response. The sampled responses all had `X-Request-ID`.
4. Recheck CORS and route fallback from the final frontend origin. The local development origin is allowed; production frontend hosting is not chosen here.

Run `npm run contract:check` for an opt-in live Swagger compatibility check. It is separate from `npm run check` so CI remains deterministic when the deployed service is slow or unavailable.
