# Sandbox acceptance: 2026-10-13

The deployed REST chat passes the browser journeys below, but full release acceptance remains blocked by private-room re-invitation after removal. Phase 4 also needs deterministic rapid-switch and overlapping-write coverage.

## Environment and evidence

- Frontend: `https://chat-sb.xuanphong.io.vn`; deployment protection was temporarily disabled by the operator.
- Source: `develop`, commit `2da84f3c45ba8d35f31269ae7daaae4d58be6feb`. The deployed script `/assets/index-DYEyMCuv.js` matches the local build asset.
- Backend: `https://gogo-dl.onrender.com`.
- Browser: headless Chrome, real REST requests, isolated account contexts and two tabs for the same account. Desktop viewport: 1440 × 1000; mobile viewport: 390 × 844. This is a smoke test, not a complete accessibility audit or a physical-device test.
- Swagger: API 1.0, 31 paths, 41 operations; SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`.
- `npm run check` passed with Node 22.23.1: formatting, lint, types, 40 tests in 12 files, and production build.
- `npm run contract:check` passed. [CI for this commit](https://github.com/xuanphongtran/gap-dl/actions/runs/37087126500) completed successfully.
- Direct `/`, `/login`, and `/app/rooms/1` return the Vue application. Sandbox-origin GET/PUT preflights return 204 and allow authorization/content-type headers. Backend health and readiness return 200.

## Passed browser checks

The local browser harness recorded 18 distinct passing checks across the following journeys:

| Journey | Verified behavior |
| --- | --- |
| Accounts and room | Two-account browser login, private-room creation, and a 404 for the uninvited account |
| Invitations | Initial invite/accept, decline of a fresh invitation, and acceptance by a fresh member |
| Messages | Browser send, cross-account latest-page polling, author edit, and edited content after reload |
| Conflicts | A concurrent REST edit causes a browser 409; the local draft remains available and explicit retry succeeds |
| Deletion and roles | Owner deletes another author's message; the other browser receives a content-free tombstone that survives reload. A moderator can delete another author's message, has no Edit control, and receives 403 for a direct PATCH |
| Read state | Own sends do not add unread; the other account sees an authoritative unread badge. Viewing advances the cursor, another tab converges when brought to the foreground, reload preserves the result, and a stale PUT cannot move the cursor backward |
| Failed read write | Chrome request interception supplies a synthetic 503 for PUT read-state. The cursor remains unacknowledged, the UI reports the failure, and explicit retry persists the cursor after interception is disabled. This is injected browser evidence, not a naturally observed backend outage |
| Privacy and navigation | Removing a member during an open conversation returns their browser to the room list and removes private message content. Leave also clears private UI; logout removes the tab session |
| Layout | Desktop/mobile conversation screenshots inspected; the mobile viewport has no document-level horizontal overflow and retains back navigation and the composer |

Hidden tabs pause polling. Multi-tab convergence was verified after foregrounding the room-list tab; continuous background updates are not claimed.

## Confirmed blocker: private-room re-invitation

1. An owner invites a user; the user accepts.
2. The owner removes that user from the private room.
3. The owner sends another invitation to the same user.

Observed responses on retained test room 5:

- `POST /api/v1/rooms/5/invitations` returns 200 with the original invitation (`id: 6`, `status: "accepted"`).
- `GET /api/v1/users/me/invitations?status=pending` returns 200 with `{ "invitations": null }`.
- The removed user's `GET /api/v1/rooms/5` still returns 404.
- The frontend displays `Invitation sent.` but the user has no pending invitation to accept.

The sequence was reproduced in the browser and with authenticated HTTP requests. The backend returns a terminal invitation instead of a new pending invitation; backend internals have not been inspected. The frontend also treats the 200 response as a sent invitation without inspecting its status. Private-room rejoin through this path is not accepted.

## Remaining gates

- Resolve and retest re-invitation after removal/leave. Re-invitation after decline has not been verified.
- Add deterministic tests for rapid room switches, overlapping read writes, and account switches while a write is pending.
- A real login 429 occurred during repeated smoke runs and the UI showed rate-limit feedback. The response's Retry-After value and countdown were not captured. A subsequent authenticated response contained X-Request-ID but exposed only Content-Length through CORS; verify browser access to diagnostic/rate-limit headers.
- Complete long-history pagination/scroll and a keyboard/accessibility audit on the deployed app. Warm-up, rolling deployment, telemetry, and memory gates remain open.
- Sandbox checks do not certify `https://chat.xuanphong.io.vn`; earlier probes of that separate host returned route 404 and origin preflight 403.
- Newly documented attachment and notification/preference endpoints still need runtime authorization, privacy, and provider checks before frontend implementation.

## Fixture lifecycle

Test messages were deleted to tombstones. The two auxiliary accounts used for decline and moderator checks were deleted with 204 responses. The original owner, removed-member account, and private room 5 remain available for blocker reproduction; the API has no room-deletion operation. Credentials, tokens, the browser harness, raw results, and screenshots are stored only in a restricted local temporary directory and are not committed.
