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

## Authenticated smoke on the deployed origin

Three disposable accounts were registered on 2026-10-02. Two were deleted after the checks. One owner account and its private room remain because account deletion returned `409` while that account owns a room; the API exposes no room-deletion route. Credentials and tokens are stored only in a local temporary file outside the repository.

| Journey | Observed result |
| --- | --- |
| Register, login, profile, refresh | `201`, `200`, `200`, `200`; `expires_at` is Unix seconds; refresh returned the same refresh-token value in this run |
| Private-room concealment | Uninvited account got `404` and `{ "error": "not found" }` |
| Create, invite, inbox, accept | Room `201`, invitation `201`, pending invitation visible, accept `200` |
| Send and history | Send `201`; message appeared in another member's history with revision and nullable lifecycle fields |
| Older-page cursor | `before` excluded its message ID; sampled page IDs were in descending order |
| Deleted author | After a member sent messages, left, and deleted their account, history retained the messages with `user_id: null` |
| Leave and account deletion | Member leave `204`, member account deletion `204`; owner account deletion `409` with `cannot delete account while owning rooms` |
| Diagnostics | Sampled success and failure responses had `X-Request-ID`; no `429` was produced, so `Retry-After` is unverified |

These are HTTP client checks, not browser end-to-end tests. Role changes, ownership transfer, public-room discovery, validation boundaries, and final-host CORS were not exercised.

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
- `GET /api/v1/rooms/{id}/messages` accepts `limit` from 1 to 100 (default 50) and `before` as a positive message ID. The frontend requests 40 and merges pages by ID. Swagger says `before` returns IDs below the cursor; ordering of the returned page still needs an authenticated check.
- `POST /api/v1/rooms/{id}/messages` documents content length 1–4000. Create room name is 1–100; registration username is 3–50 and password has minimum length 8. These are server contract bounds; field-level UX changes belong to the next phase.
- `PATCH /api/v1/rooms/{id}/messages/{message_id}` takes `{ content, revision }`, returns a Message, and documents `409` for conflict. `DELETE` returns a Message tombstone. These endpoints are not used by the current UI.
- `GET/PUT /api/v1/rooms/{id}/read-state` returns `{ room_id, last_read_message_id, unread_count }`; PUT requires a positive `last_read_message_id`. Read state is not used by the current UI.
- Successful membership, ownership, and account-deletion operations can return `204` with no body. The common error schema currently contains only an `error` string; field-specific error codes are not documented.

## Open verification gates

1. Verify the existing text-chat journey in a browser using two accounts. The HTTP checks above establish route behavior, but do not cover rendered interactions.
2. Confirm role changes, ownership-transfer rules, public-room join behavior, and exact validation/size-limit responses. Avoid generating `429` solely for a smoke test.
3. Confirm `Retry-After` on a naturally observed `429` response. The sampled responses all had `X-Request-ID`.
4. Recheck CORS and route fallback from the final frontend origin. The local development origin is allowed; production frontend hosting is not chosen here.

Run `npm run contract:check` for an opt-in live Swagger compatibility check. It is separate from `npm run check` so CI remains deterministic when the deployed service is slow or unavailable.
