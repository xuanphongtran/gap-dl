# REST API contract baseline

This is the frontend's reviewed snapshot of the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json). Recheck that document before changing endpoint code. The snapshot records documentation, not proof that authenticated operations work with real accounts.

## Snapshot and reachability

| Item | Observed on 2026-10-02 |
| --- | --- |
| Swagger document | Swagger 2.0, API version `1.0`; 20 paths and 27 HTTP operations |
| Document SHA-256 | `cda46b4f15b0d28bd753fd8c415739731e457cdb26edd67cf95ee0416b36c8d2` |
| Browser API origin | `https://gogo-dl.onrender.com` by default; override with `VITE_API_BASE_URL` |
| Swagger `host` | `localhost:8080`; do not use this field as the deployed browser origin |
| Health | `GET /health` returned `200` with `{ "status": "ok", "time": "..." }` and `X-Request-ID` |
| Browser preflight | `OPTIONS /api/v1/users/me` from `http://localhost:5173` returned `204`, allowed `Authorization` and `Content-Type`, and echoed the origin |
| Unauthenticated request | `GET /api/v1/users/me` returned `401`, `{ "error": "unauthorized" }`, and `X-Request-ID` |

The first three probes are read-only. The authenticated checks below used disposable accounts. Other frontend origins, rate-limit headers, and production hosting remain unverified.

## Phase 2 runtime findings

Additional disposable accounts were used for a public-room journey and deleted afterward. A public room remains under the retained test owner because the API has no room-deletion operation.

| Endpoint or behavior | Observed result |
| --- | --- |
| `GET /api/v1/rooms` before public join | Returned the public room with `role: null`; Swagger's `Room.role` property does not declare nullability |
| `GET /api/v1/rooms/{id}` before public join | Returned `200` with `role: null` |
| Member and message reads before public join | `403` for both; public detail visibility does not grant history access |
| `POST /api/v1/rooms/{id}/join` | Initial and duplicate join each returned `200` |
| `DELETE /api/v1/rooms/{id}/membership` | Initial and duplicate leave each returned `204`; message reads after leave returned `403` |
| `POST /api/v1/rooms/{id}/messages` with empty or 4,001-character content | Both returned `400` with `{ "error": "invalid request" }` and `X-Request-ID`; Swagger also lists `413`, which was not produced by this length probe |

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

These are HTTP client checks, not browser end-to-end tests. Public-room join, invitation decline, profile update, validation boundaries, and final-host CORS were not exercised. The first owner-action smoke attempt used an expired access token and got `401`; a fresh login resolved it.

## Operation coverage

| Area | Documented operations | Frontend status |
| --- | --- | --- |
| Authentication | Register, login, refresh | Implemented; refresh is in `src/lib/http.ts` |
| Profile | Get, update, delete `/api/v1/users/me` | Implemented |
| Rooms | List, create, get, join, leave, transfer ownership | Implemented |
| Invitations | Create, list personal, accept, decline | Implemented |
| Members | List, change role, remove | Implemented |
| Messages | List with `limit`/`before`, send | Implemented |
| Message lifecycle | `PATCH` and `DELETE /api/v1/rooms/{id}/messages/{message_id}` | Documented; planned in frontend phase 3 |
| Read state | `GET` and `PUT /api/v1/rooms/{id}/read-state` | Documented; planned in frontend phase 4 |
| Presence | `GET /api/v1/rooms/{id}/presence` | Documented; frontend presence remains deferred with WebSocket work |
| Health | `GET /health` | Deployment probe; no application screen |

Search, attachments, mentions, notification inbox, and WebSocket event schemas are absent from this REST Swagger snapshot. Their FE work remains gated on a published contract.

## DTO and limit checks

- `Message` includes `id`, `room_id`, `content`, `created_at`, `username`, `revision` (minimum 1), nullable `user_id`, nullable `edited_at`, and nullable `deleted_at`. Phase 1 aligned the frontend type without adding lifecycle UI.
- `GET /api/v1/rooms/{id}/messages` accepts `limit` from 1 to 100 (default 50) and `before` as a positive message ID. The frontend requests 40 and merges pages by ID. The authenticated sample excluded IDs at or above the cursor and returned a descending page.
- `POST /api/v1/rooms/{id}/messages` documents content length 1–4000. The Phase 2 length probe returned `400` for 4,001 characters even though `413` is listed as a possible response. Create room name is 1–100; registration username is 3–50 and password has minimum length 8.
- `PATCH /api/v1/rooms/{id}/messages/{message_id}` takes `{ content, revision }`, returns a Message, and documents `409` for conflict. `DELETE` returns a Message tombstone. These endpoints are not used by the current UI.
- `GET/PUT /api/v1/rooms/{id}/read-state` returns `{ room_id, last_read_message_id, unread_count }`; PUT requires a positive `last_read_message_id`. Read state is not used by the current UI.
- Successful membership, ownership, and account-deletion operations can return `204` with no body. The common error schema currently contains only an `error` string; field-specific error codes are not documented.

## Open verification gates

1. Complete a two-account browser invitation/send/history journey. Owner login/private navigation and visitor registration/public join/leave already passed in Chrome; the earlier HTTP checks establish message and invitation route behavior.
2. Confirm invitation decline, profile update, and other validation/size-limit responses. Public-room join and duplicate join/leave are verified. Avoid generating `429` solely for a smoke test.
3. Confirm `Retry-After` on a naturally observed `429` response. The sampled responses all had `X-Request-ID`.
4. Recheck CORS and route fallback from the final frontend origin. The local development origin is allowed; production frontend hosting is not chosen here.

Run `npm run contract:check` for an opt-in live Swagger compatibility check. It is separate from `npm run check` so CI remains deterministic when the deployed service is slow or unavailable.
