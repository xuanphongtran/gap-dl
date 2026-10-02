# Frontend product specification: Gogo DL Web Chat

**Status:** Frontend planning update, 2026-10-02. The REST contract source is the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json), checked after the API update on 2026-10-02 (Swagger 2.0, API version 1.0, 24 paths, 31 operations). Check it again before implementing each feature and verify authenticated behavior against the API at `VITE_API_BASE_URL`. WebSocket and SSE remain frontend TODOs.

Swagger documents `PATCH/DELETE /api/v1/rooms/{id}/messages/{message_id}`, `GET/PUT /api/v1/rooms/{id}/read-state`, `GET /api/v1/rooms/{id}/presence`, and `GET /api/v1/rooms/{id}/messages/search`. Attachment, mention/inbox, and WebSocket event contracts are not present in this REST document. Endpoint presence in Swagger does not confirm authenticated runtime behavior.

The reviewed frontend operation and DTO matrix is in [docs/API_CONTRACT.md](./docs/API_CONTRACT.md).

## 1. Scope and release map

The existing Vue 3 and TypeScript client supports account access, room text chat, invitations, membership actions, profile settings, older-page loading, and five-second HTTP polling of the newest message page. Preserve these flows and the 8-bit/pixel UI while adding backend capabilities in independently usable releases.

### Frontend foundation

Before adding new API-driven features, organize the existing source by responsibility and extract repeated pixel UI patterns into reusable base components. Route views compose feature components; base components provide presentation and accessible interactions without importing API clients, Vue Query, Pinia, or router state. Keep typed REST endpoints in `src/lib/api.ts`, Axios transport in `src/lib/http.ts`, shared Vue Query keys in `src/lib/query.ts`, and session state in Pinia.

The initial base set covers buttons, form fields, panels, alerts, empty/loading states, and avatars. Each component needs a small typed public interface, semantic HTML, keyboard and focus behavior, disabled/loading states where applicable, and consistent use of `src/style.css` pixel tokens. Feature-specific chat rows, room links, and invitation cards stay in feature folders. The foundation must preserve existing routes, copy, responsive layout, and network behavior.

| Area | Frontend scope | Prerequisite |
| --- | --- | --- |
| Frontend foundation | Organize source and establish reusable pixel components before new feature work. | Existing UI regression checks |
| API reliability | Verify validation, errors, rate limits, deleted authors, and account-deletion behavior. | Frontend foundation and deployed response contracts |
| Membership | Align public/private room and role UI with the final authorization matrix. | Deployed authorization behavior |
| Message lifecycle | Add edit/delete UI. | Swagger documents lifecycle endpoints and revision fields; verify behavior with accounts. |
| Read state | Add durable REST read state and unread counts; defer presence and typing. | Swagger documents read-state endpoints and cursor fields; verify behavior with accounts. |
| Rich messaging | Add search, attachments, mentions, and inbox in separate releases. | Released APIs and provider gates |
| Realtime and operations | Add reconnect/recovery when explicitly in scope; handle warm-up and transient failures. | Verified transport and deployment contracts |

## 2. Existing journeys to preserve

| Journey | Expected behavior | Existing API |
| --- | --- | --- |
| Account | Register/sign in, persist tab session, refresh one expired access token, clear session and private cache on final auth failure. | Auth and profile REST operations |
| Browse | Show accessible rooms and pending invitations with loading, empty, and error states. | Rooms and invitations reads |
| Chat | Load room, members, newest messages, then older pages with `before`; retain per-room draft and scroll position. | Room, members, messages reads |
| Send | Preserve draft on failure, show returned message once, reconcile by message ID. | Message POST |
| Membership | Create/join/leave, invite/accept/decline, manage eligible roles, invalidate affected queries. | Room/invitation/member operations |
| Profile | Update profile and confirm deletion. Explain ownership conflict on `409`. | Profile GET/PATCH/DELETE |

## 3. API hardening and data integrity

- The current Swagger error model exposes an `error` string. Show safe form-level feedback; map validation to individual inputs only if a later documented response adds stable field details. Client validation helps usability and never substitutes for server authorization.
- Trim message content and enforce the documented 4,000 UTF-8 byte limit. Content validation returns `400`; `413` refers to an oversized HTTP request body. Keep the draft editable when it exceeds the limit.
- On `429`, honor a valid integer `Retry-After`, disable only the affected action for that interval, and allow retry afterward. On `413`, explain the relevant size limit. Distinguish final `401`, `403`, concealed `404`, `409`, network failure, and temporary `503` without revealing private-resource existence or backend internals.
- Capture `X-Request-ID` for safe support details when present. Never log tokens, message bodies, signed URLs, or raw error stacks. Do not automatically replay writes without a confirmed idempotency contract.
- Account deletion may be rejected while the user owns rooms; explain ownership transfer. Deleted authors can remain in message history with nullable identity; display a neutral deleted-user label while preserving the message ID and deletion state.
- Confirm server normalization and bounds for email, username, room name, avatar URL, and message content before adding matching client hints.

## 4. Rooms and permissions

- The deployed `GET /api/v1/rooms` discovers public rooms before membership; their `role` is `null`. An unaffiliated user can read public room details and join by ID, while members and messages require membership. A concealed private-room `404` must not reveal details.
- Treat visibility as immutable unless the deployed API supports changing it. Owners transfer ownership before leaving or deleting their account. Use confirmed idempotent join/leave/invitation responses.
- Show owner/moderator/member actions according to the returned role, while the API remains authoritative. On membership loss, clear that room's cached details, members, messages, read state, and pending private UI; return to the room list.

## 5. Message lifecycle

- After verifying the documented lifecycle endpoints with accounts, let an eligible current-member author edit their own text. Owners/moderators may delete other users' messages but may not rewrite their text. Confirm the complete role matrix before showing controls.
- `PATCH /api/v1/rooms/{id}/messages/{message_id}` takes `{ content, revision }` and returns a Message. Send the current revision when editing. A `409` conflict keeps the local edit, fetches the latest server version, and offers explicit retry/discard; never silently overwrite newer text.
- Deletion renders an ID-stable, content-free tombstone. Repeated deletes converge on the same state. Show an edited indicator only when the API supplies it. Merge history, polling, mutations, and eventual events by message ID and increasing revision; ignore older results.
- Edits/deletes do not create a new unread item. `before=<message ID>` pagination must continue to work through tombstones and preserve reading position.

## 6. Read state, unread, presence, and typing

- `GET/PUT /api/v1/rooms/{id}/read-state` returns `{ room_id, last_read_message_id, unread_count }`; PUT takes `{ last_read_message_id }` with a positive integer. Advance the room cursor only when messages are actually viewed, never merely because a list query loaded. Keep writes monotonic and retry safely. The returned cursor can be `0`; own messages are excluded from unread; tombstones still count by ID.
- Scope read state to current account and membership; clear it on logout or room removal. Show unread counts from an authoritative API projection or a documented full-history calculation, never only from the newest 40-message cache.
- Presence is visible only to current room members and aggregates a user's subscriptions across tabs. Reconnection requires an authorized snapshot. Typing is ephemeral, throttled, and expires; it is not durable Vue Query state.
- Presence and typing UI remain TODO until frontend WebSocket integration. REST read state can ship independently.

## 7. Search, attachments, and inbox

- **Search:** room-scoped authorized search with bounded query and documented cursor pagination. Handle edits, tombstones, revoked membership, and stale snippets without leaking content. Verify the newly documented endpoint with test accounts before frontend implementation.
- **Attachments:** add progress/cancel/retry, scanning states, quotas, and authorized download only after private immutable storage, scanning, and cleanup are verified. Signed URLs stay ephemeral and out of durable caches/logs/events. Keep text-only sending; attachment-only sending needs a separate contract.
- **Mentions/inbox:** select recipients by typed identity, not username parsing. Add private paginated feed and preferences when endpoints exist; deleted or revoked items must not reappear after reconnect. External email/push is outside scope.

## 8. Transport, state, and privacy

- Keep typed endpoints in `src/lib/api.ts`, Axios transport and refresh in `src/lib/http.ts`, Vue Query keys in `src/lib/query.ts`, and Pinia for session state. Component refs own drafts and panels. Pass query abort signals to cancellable reads and clear private cache on account change.
- Poll only the newest message page every five seconds while visible; older pages load on demand. The current `before` cursor cannot recover a gap larger than one newest page. Add a recovery prompt or full history reload until a confirmed `after` cursor or snapshot contract exists.
- Frontend WebSocket and SSE remain TODO. When requested, use `@vueuse/core` for WebSocket lifecycle after confirming URL, auth transport, origin, command/event schemas, reconnect behavior, and whether HTTP remains the write path. Never send fabricated authoritative events from the browser.
- On eventual reconnect, reauthorize subscriptions, reload an authorized snapshot/history/read state, deduplicate by ID/revision, and apply membership revocation before displaying further private data. Sequence/recovery metadata and cross-instance guarantees are contract gates, not assumptions. SSE requires its own backend contract.
- Safe reads may retry transient failures; writes require confirmed idempotency before automatic replay. Honor `Retry-After` and use bounded backoff for readiness failures.

## 9. Visual and accessibility requirements

Keep square panels, 4/8 px spacing, pixel borders/shadows, a pixel font for short labels, and readable sans-serif text for messages/forms. Preserve contrast, visible keyboard focus, labelled inputs, readable line breaks and long URLs, reduced-motion behavior, and mobile room/chat navigation. Edit/delete controls need keyboard access and accessible success/error feedback. Loading, empty, permission-lost, rate-limited, offline, and retry states need distinct text. Do not leave stale private content visible after membership loss.

## 10. Acceptance and open contracts

1. Existing register → room → invite → chat → leave flows pass with two accounts on the target deployment, including desktop/mobile use.
2. Removed/unauthorized users cannot view cached private room content after navigation or reload; final `401` clears session and private query data.
3. Edit/delete converge after conflict, retry, reload, and out-of-order updates; tombstones never reveal old text.
4. Read cursors never move backward; unread counts follow membership and deletion rules across reloads/tabs.
5. `413`, `429` with `Retry-After`, ownership `409`, concealed `404`, network failure, and warm-up have clear UI states.
6. Search, attachments, inbox, presence, typing, and distributed real-time features ship only after their deployed contract and privacy gates pass.

**Contract gate:** Recheck the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json) before implementation. Verify lifecycle/read-state behavior, nullable deleted authors, request-ID/`Retry-After` headers, and authorization with test accounts. Review the separately published [AsyncAPI YAML](https://gogo-dl.onrender.com/asyncapi/asyncapi.yaml) before WebSocket work; obtain published contracts for search, uploads, and inbox when those features enter scope. Track resolution in [PLAN.md](./PLAN.md).
