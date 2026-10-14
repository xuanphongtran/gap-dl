# Frontend implementation plan: Gogo DL Web Chat

References: [frontend specification](./SPEC.md) and the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json), the REST contract source. Recheck Swagger before implementing each feature and verify authenticated behavior at `VITE_API_BASE_URL`. A Swagger route alone is not proof that the user journey works.

The latest reviewed operation matrix and unresolved runtime checks are in [docs/API_CONTRACT.md](./docs/API_CONTRACT.md).

**Sandbox acceptance update (2026-10-13):** [Browser acceptance evidence](./docs/ACCEPTANCE_2026-10-13.md) verifies the Phase 3 manager/reload checks and Phase 4 multi-tab/retry journeys on `https://chat-sb.xuanphong.io.vn`. Sandbox routes and CORS pass; CI at `2da84f3` passes. Private-room re-invitation after removal is blocked: the backend returns the old accepted invitation while the removed member remains unauthorized. Swagger now reports 31 paths and 41 operations, including attachment and notification/preference endpoints. Rapid room switches and overlapping read-write tests remain open.

**Continuation update (2026-10-14):** The WebSocket transport slice is implemented and independently reviewed; see [the WS evidence](./docs/WEBSOCKET_CONTRACT.md). Phase 4 deterministic rapid-room-switch and overlapping-write checks now pass in [the read-state race record](./docs/READ_STATE_RACES_2026-10-14.md). Private-room re-invitation, deployed WebSocket multi-tab acceptance, and remaining contract/release gates stay open. Room Search is now implemented and locally accepted on `feat/message-search`; see [Search acceptance](./docs/SEARCH_ACCEPTANCE_2026-10-14.md). Attachments/inbox remain gated by their deployed contracts.

**Current frontend baseline (2026-10-02):** Vue 3, TypeScript, Router, Pinia session state, Axios transport, Vue Query server state, pixel UI, ESLint, Prettier, Vitest, and GitHub Actions are in place. Basic REST rooms, invitations, membership actions, profile, text messages, pagination, and latest-page polling are implemented. Two-account HTTP behavior was verified on the target deployment; browser end-to-end behavior remains open. WebSocket and SSE are deferred.

## 0. Frontend source and component foundation — P0, implement first

The app already runs, but route views contain repeated pixel controls and much of the feature UI. Refactor the existing implementation before adding new API-driven behavior. Preserve routes, visible copy, mobile layout, and request semantics while moving code.

### Source boundaries

```text
src/
  components/base/       PixelButton, PixelField, PixelPanel, PixelAlert,
                         PixelEmptyState, PixelAvatar
  features/auth/         Authentication forms and feature-only UI
  features/rooms/        Room navigation, invitation and member UI
  features/messages/     Message list, row, composer and room-local logic
  features/profile/      Profile form and account actions
  views/                 Route-level composition and page layout
  lib/                   api.ts, http.ts, query.ts, session.ts and shared helpers
  stores/                Session state only
  style.css              Shared pixel tokens, reset and global utilities
  types.ts               Shared API models until a feature owns a local type
```

Keep endpoint functions in `src/lib/api.ts`, Axios transport in `src/lib/http.ts`, and Vue Query keys in `src/lib/query.ts`. Feature folders may hold query composables and feature-specific types, but do not create a second HTTP client or duplicate server state in Pinia. Base components cannot import API, router, or session modules. Keep component styles close to the component while shared design tokens remain in `src/style.css`.

- [x] Keep the current Vue/Vite/TypeScript setup, Router, Axios, Vue Query, Pinia session store, ESLint, Prettier, Vitest, CI, and `npm run check`.
- [x] Define typed props, events, and slots for the initial base set. Native `RouterLink` remains the semantic navigation link; `PixelButton` is a button. Fields associate labels/help and preserve external ARIA descriptions; buttons support disabled/loading states.
- [x] Extract repeated button, field, panel, alert, empty/loading state, and avatar markup. Preserve the pixel appearance and add interaction tests for field labelling, selection, form submit, loading buttons, and composer keyboard behavior.
- [x] Move authentication, room, message, and profile-specific UI into feature folders. Leave `src/views/` as thin route composition and preserve Axios/Vue Query/Pinia boundaries.
- [x] Verify focus and reduced-motion rules remain in `src/style.css`; run `npm run check` and visually smoke-test login, room list, conversation, and settings at desktop/mobile sizes using local mock data.

**Local exit gate:** The named base components are used by at least two applicable screens, source boundaries are followed, mock-backed screens retain their layout, and `npm run check` passes. The CI workflow runs the same command; remote CI and two-account live API journeys remain to be verified after push/in Section 1.

**Completion record (2026-10-02):** Created `feat/frontend-foundation`, extracted six base components and message row/composer, moved screens to feature folders, kept route wrappers, added focused component tests, and reviewed desktop/mobile screenshots with local mock REST data. A review found that `PixelField` could overwrite caller-provided ARIA descriptions; the component and test were fixed before commit. No production credentials or API mutations were used.

## 1. Contract inventory and regression baseline — P0

- [x] Inspect the deployed Swagger JSON: the latest 2026-10-02 snapshot reports API 1.0 with 24 paths and 31 operations, including message edit/delete, room read state, room presence, message search, and system readiness routes. The error schema currently exposes an `error` string.
- [x] Recheck Swagger at implementation time; record target deployment version and compare request/response schemas with `src/types.ts` and `src/lib/api.ts`, including nullable deleted authors and message revision/tombstone fields. Verify the current text-chat contracts with authenticated HTTP requests.
- [ ] Confirm target origin, CORS, HTTPS, route availability, `expires_at`, refresh rotation, `before` ordering/limit, validation bounds, `Retry-After`, `X-Request-ID`, and stable error shape. Most items were observed; final-host CORS, boundary responses, and `Retry-After` still need verification. Refresh did not rotate the refresh token in the sampled request.
- [x] Create development accounts and room fixtures. The earlier authenticated HTTP baseline and the 2026-10-13 sandbox browser create/invite/accept/send/history/leave journeys passed. The owner and removed-member fixture remain for blocker reproduction; auxiliary accounts were deleted. Re-invitation after removal remains blocked and is recorded in the acceptance report.
- [x] Keep `npm run check` green locally. Add focused mocked HTTP contract tests and an opt-in live Swagger check. Local checks and remote CI at `2da84f3` passed on 2026-10-13.

**Exit gate:** A versioned contract matrix identifies deployed routes and fields; existing text-chat journeys work with two accounts, or response-backed mismatches are recorded as blockers.

## 2. Hardening and membership alignment — P0

- [x] Extend Axios error normalization with documented `error` messages, integer `Retry-After`, and `X-Request-ID`. Preserve single-flight `401` refresh and clear private Vue Query data on final auth failure. Actual `429` response headers remain unobserved; mocked tests cover parsing and countdown.
- [x] Add actionable UI for `400` message length validation, `413`, `429`, transient `503`, ownership `409`, and concealed private-room `404`. Do not replay writes automatically. Show a bounded retry timer for valid integer `Retry-After`.
- [x] Render nullable deleted authors and account-deletion ownership conflict without losing message identity or exposing tombstone text. Keep a newer revision/tombstone when older pages or polls arrive.
- [x] Align create/join/leave/invite/member controls with observed authorization behavior. Clear private room queries immediately after membership loss and preserve discoverable public rooms with `role: null` and a join action.
- [x] Test role changes, removal during an open room, transfer-before-leave, duplicate join/leave, hidden private rooms, logout/account switch, mobile layout, and keyboard interaction. Live HTTP checks cover roles, transfer, concealment, and duplicate public join/leave. Mocked tests cover cache revocation, public join UI, and account switch; headless Chrome with the deployed API covers owner login/private navigation and visitor registration/public join/leave. Desktop/mobile join-state layouts were inspected with local mock data.

**Exit gate:** Errors and membership changes render safely, private cache is cleared on revocation, and current REST chat remains usable. Final membership semantics are verified against the deployed API.

**Completion record (2026-10-02):** The frontend gates private room queries on membership and offers a join action. The refreshed Swagger now documents nullable `Room.role` and clarifies that message content over 4,000 UTF-8 bytes returns `400`, while `413` is for an oversized HTTP body. The composer validates the byte limit. `Retry-After` remains unverified on a real `429`; the header parser and countdown are covered by mocks. The review found a missing `PixelAlert` import in the new join state; it was fixed before commit. Final-host CORS remains a release gate.

**Follow-up review:** A rejected write now refreshes authentication without silently resending the write. Invitation and member rate limits block only the affected action. Ownership conflicts appear beside account deletion, and merged message pages retain erased authors and tombstones. Write retry safety, action isolation, and message merging have focused regression tests.

## 3. Message lifecycle — P1

**Dependency:** The Swagger-documented lifecycle routes and Message fields are rechecked and verified with test accounts.

**Implementation note (2026-10-02):** The current deployed Swagger lists 24 paths and 31 operations and documents `PATCH` with `{ content, revision }` plus `DELETE` returning a Message tombstone. Keep one room-local editor draft, merge mutation results with the displayed REST pages by ID/revision, and refetch loaded pages after `409` to present the server version before an explicit retry. Event merging stays with deferred real-time work.

- [x] Add typed `PATCH/DELETE /api/v1/rooms/{id}/messages/{message_id}` functions and Message fields. PATCH sends `{ content, revision }`; authenticated requests confirmed `200` and stale-revision `409`.
- [x] Add edit/delete controls to eligible message rows with keyboard support, edit draft preservation, destructive confirmation, and clear edited/deleted display.
- [x] Merge history, newest-page, and mutation responses by message ID and increasing revision. Keep tombstones ID-stable and content-free. Preserve scroll position while older pages load. Event merging remains in deferred Phase 5.
- [x] On revision conflict, preserve the local edit and display the fresh server version with explicit retry/discard choices. A repeated delete returned the same tombstone in the live smoke.
- [x] Test author/manager/forbidden cases, concurrent edits, delete while viewing, out-of-order results, page overlap, and reload. Earlier HTTP and mocked checks cover forbidden members, repeated delete, overlap, and stale results. The 2026-10-13 sandbox browser smoke verifies author edits, explicit conflict retry with draft preservation, owner/moderator deletion, forbidden moderator edits, and edited/tombstone reloads.

**Phase 3 verification (2026-10-02):** A disposable account joined an existing public room, sent, edited, retried a stale revision, deleted twice, and read the tombstone; a second two-account check confirmed non-author edit/delete return `403`. All three test accounts left and were deleted. The live browser URL `https://chat.xuanphong.io.vn/login` returned Vercel `404: NOT_FOUND` before Vue loaded; the repository now includes an SPA rewrite. Confirm direct `/login` and room routes after deployment.

**Exit gate:** No stale response restores erased content or overwrites a newer revision; edit conflicts are recoverable without losing the user's draft.

## 4. Durable read state and unread counts — P1

**Dependency:** The Swagger-documented GET/PUT read-state DTO and cursor semantics are verified with test accounts. This slice does not require WebSocket.

- [x] Add typed `GET/PUT /api/v1/rooms/{id}/read-state` functions and room-scoped Vue Query keys. PUT sends `{ last_read_message_id }`; consume `{ room_id, last_read_message_id, unread_count }`. Advance a cursor only when messages are viewed; debounce writes without moving backward.
- [x] Add unread badges to the room list using server state or a documented full-history calculation. Do not infer exact counts from the newest-page cache. Exclude own messages and preserve tombstone-by-ID behavior.
- [x] Clear read state on logout, account switch, and membership loss. Existing account-switch tests and the sandbox browser removal/logout checks verify cleanup. Browser reload, two-tab convergence after foregrounding, and explicit retry after an injected failed write passed on 2026-10-13.
- [x] Complete deterministic rapid-room-switch and overlapping-write checks. Eight mounted-composable tests exercise real Vue Query, Axios cancellation, viewport measurement, and debounce behavior. Temporary removal of cancellation/generation protection and monotonic merging causes the expected failures; production source is restored.
- [ ] Retest private-room rejoin after the confirmed re-invitation blocker is resolved.

**Completion record (2026-10-02):** Added room-scoped read-state queries, monotonic cursor merging, a debounced visible-message acknowledgement, membership revocation cleanup, and server-backed unread badges. The deployed two-account smoke verified own-message exclusion, tombstones counting by ID, monotonic stale writes, duplicate acknowledgement, membership denial, and cleanup of disposable accounts. Local checks cover cursor merging and API payloads; browser multi-tab convergence and final-host CORS remain release gates.

**Exit gate:** Read cursor and unread count converge with the backend after retries/reloads; no other user's private state is shown.

## 5. WebSocket-assisted REST integration — P1

**Scope approved on 2026-10-13.** [Reviewed contract and verification](./docs/WEBSOCKET_CONTRACT.md) and [approved design](./docs/superpowers/specs/2026-10-13-websocket-design.md) define the first release. SSE, presence/typing presentation, and distributed-delivery guarantees remain deferred.

- [x] Confirm URL, access-JWT query transport, origin handling, join/leave commands, documented envelopes, newline batching, no replay, and drain 1001. Authenticated sandbox-origin upgrade and native development-origin browser connections passed. Runtime presence envelopes are absent from AsyncAPI; lifecycle events lack complete revision/tombstone coverage.
- [x] Use `@vueuse/core` for one connection per authenticated tab. Subscribe only after REST authorization, close on logout/account change, and process membership revocation before data events. Keep REST for durable state and all writes.
- [x] Reconcile history/read state after reconnect and foreground recovery; preserve drafts/scroll, dedupe by ID/revision, bridge up to ten additional pages, and expose explicit reload beyond the bound. Keep HTTP polling because lifecycle/read-state event coverage is incomplete.
- [x] Add bounded reconnect/backoff and offline/retry UI. Tests cover token rotation, account/room races, stale frames, malformed batches, revocation, missed pages, failed connections, and drain 1001. Local-branch browser smoke with the deployed backend covers invitations, message events, reconnect, revocation, and logout at desktop/mobile sizes.
- [ ] Verify the changed frontend after deployment to the final host, including multiple real browser tabs. The origin handshake check does not prove that this feature branch is deployed there.
- [ ] Verify published presence/typing/lifecycle schemas and distributed recovery before their UI or delivery guarantees enter scope. SSE has no verified contract.

**Exit gate for this slice:** Authorized REST state converges after connection loss and membership changes, stale private callbacks cannot repopulate another account, and transport failure exposes guarded REST recovery. Final deployed-browser acceptance remains open; the independent private-room re-invitation blocker remains a release limitation.

## 6. Search, attachments, and inbox — P2

- [x] **Search contract:** Verify authenticated authorization, query bounds, cursor pagination, edit freshness and deletion-aware responses with test accounts. Twelve live checks passed on 2026-10-14; see [the contract evidence](./docs/SEARCH_CONTRACT.md).
- [x] **Search UI:** Add a room-scoped query form, cursor pagination, loading/empty states, and revoked-membership cleanup. Test edits/tombstones and result privacy. [Approved design](./docs/superpowers/specs/2026-10-14-room-message-search-design.md) and [implementation plan](./docs/superpowers/plans/2026-10-14-room-message-search.md) are implemented on `feat/message-search`; [eleven local-branch live checks](./docs/SEARCH_ACCEPTANCE_2026-10-14.md) passed. Final-host deployment remains open.
- [ ] **Attachments:** Reservation verified on 2026-10-14: valid authenticated requests return scanner-pending 503. Provider, scanner, quota, binding, and signed-download gates remain open; see [rich messaging evidence](./docs/RICH_MESSAGING_CONTRACT.md). Add upload progress/cancel/retry and scan states only after those gates pass; keep signed URLs ephemeral/private. Test scan failure, expiry, leave during upload, duplicate retry, and cleanup-visible states.
- [x] **Mentions/inbox contract:** Typed recipients, same-key send identity/conflicts, asynchronous private feed pagination, repeated read, false preference payloads, deleted references, and public leave/rejoin generation isolation verified on 2026-10-14. Final HTTP runs passed 40 private-room checks and 10 public-generation checks; [evidence and cleanup limitations](./docs/RICH_MESSAGING_CONTRACT.md). Private-room re-invitation remains blocked independently.
- [ ] **Mentions/inbox UI:** Add recipient picker, private paginated metadata-only inbox, preference controls, and retry-safe read/send actions. Do not infer mentions by parsing names in text. [Proposed design](./docs/superpowers/specs/2026-10-14-mentions-inbox-design.md) awaits review; product code and browser acceptance remain open. This slice can proceed independently of blocked attachments.

**Exit gate:** Each slice has its own deployed API/privacy gate and can ship independently. External email/push and attachment-only sends stay outside this plan.

## 7. Release and operations alignment — P2

- [ ] Verify browser behavior during backend warm-up, failed readiness, rolling deployment, and transient `503`; show retry without exposing migration details. Production route fallback and CORS must work on the selected host.
- [ ] Once distributed delivery is deployed, exercise replay/gap recovery, two-node room delivery, cross-node presence/typing, revocation, and graceful drain with the frontend. An event ACK is transport progress, not proof the browser rendered it.
- [ ] Measure client traffic, error rates, interaction latency, and long-history memory. Keep tokens, signed URLs, message bodies, and personal identifiers out of telemetry; use request IDs only for safe diagnostics.
- [ ] Run `npm run check`, desktop/mobile accessibility smoke tests, and two-account deployed journeys before release. Record API version, test results, remaining gates, and rollback path.

**Exit gate:** The frontend works through expected backend failures. Any real-time scale claim has measured two-instance evidence from the backend rollout.

## Delivery order

```text
Source structure + base components → Contract inventory → Hardening/membership
                                             └───────→ Message lifecycle → REST read state
                                             └───────→ Search → Attachments → Inbox
Current transport slice: WebSocket-assisted REST updates
Deferred: SSE → Presence/typing → Distributed recovery
```

Complete the source and base-component foundation first. Swagger already documents lifecycle and read-state routes; those slices still need authenticated verification. Rich messaging waits for API release and provider gates. The first WebSocket slice is implemented with REST recovery; SSE, presence/typing, and distributed guarantees remain deferred.
