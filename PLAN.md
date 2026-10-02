# Frontend implementation plan: Gogo DL Web Chat

References: [frontend specification](./SPEC.md) and the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json), the REST contract source. Recheck Swagger before implementing each feature and verify authenticated behavior at `VITE_API_BASE_URL`. A Swagger route alone is not proof that the user journey works.

The latest reviewed operation matrix and unresolved runtime checks are in [docs/API_CONTRACT.md](./docs/API_CONTRACT.md).

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

- [x] Inspect the deployed Swagger JSON: on 2026-10-02 it reported API 1.0 with 20 paths and 27 operations, including message edit/delete, room read state, and room presence. The error schema currently exposes an `error` string.
- [x] Recheck Swagger at implementation time; record target deployment version and compare request/response schemas with `src/types.ts` and `src/lib/api.ts`, including nullable deleted authors and message revision/tombstone fields. Verify the current text-chat contracts with authenticated HTTP requests.
- [ ] Confirm target origin, CORS, HTTPS, route availability, `expires_at`, refresh rotation, `before` ordering/limit, validation bounds, `Retry-After`, `X-Request-ID`, and stable error shape. Most items were observed; final-host CORS, boundary responses, and `Retry-After` still need verification. Refresh did not rotate the refresh token in the sampled request.
- [ ] Create disposable development accounts and room fixtures. Register/login/refresh, create/invite/accept/send/history/leave/profile/delete-conflict, private-room concealment, role changes, removal, and owner transfer passed via HTTP. Browser journeys and public join remain.
- [x] Keep `npm run check` green locally. Add focused mocked HTTP contract tests and an opt-in live Swagger check; remote CI remains to be verified after push.

**Exit gate:** A versioned contract matrix identifies deployed routes and fields; existing text-chat journeys work with two accounts, or response-backed mismatches are recorded as blockers.

## 2. Hardening and membership alignment — P0

- [x] Extend Axios error normalization with documented `error` messages, integer `Retry-After`, and `X-Request-ID`. Preserve single-flight `401` refresh and clear private Vue Query data on final auth failure. Actual `429` response headers remain unobserved; mocked tests cover parsing and countdown.
- [x] Add actionable UI for `400` message length validation, `413`, `429`, transient `503`, ownership `409`, and concealed private-room `404`. Do not replay writes automatically. Show a bounded retry timer for valid integer `Retry-After`.
- [x] Render nullable deleted authors and account-deletion ownership conflict without losing message identity or exposing tombstone text. Keep a newer revision/tombstone when older pages or polls arrive.
- [x] Align create/join/leave/invite/member controls with observed authorization behavior. Clear private room queries immediately after membership loss and preserve discoverable public rooms with `role: null` and a join action.
- [x] Test role changes, removal during an open room, transfer-before-leave, duplicate join/leave, hidden private rooms, logout/account switch, mobile layout, and keyboard interaction. Live HTTP checks cover roles, transfer, concealment, and duplicate public join/leave. Mocked tests cover cache revocation, public join UI, and account switch; headless Chrome with the deployed API covers owner login/private navigation and visitor registration/public join/leave. Desktop/mobile join-state layouts were inspected with local mock data.

**Exit gate:** Errors and membership changes render safely, private cache is cleared on revocation, and current REST chat remains usable. Final membership semantics are verified against the deployed API.

**Completion record (2026-10-02):** The deployed public-room contract returned `role: null` for unaffiliated users, which Swagger omits. The frontend now gates private room queries on membership and offers a join action. An empty or 4,001-character message returned `400`, not the documented `413`, so the composer handles both. `Retry-After` remains unverified on a real `429`; the header parser and countdown are covered by mocks. The review found a missing `PixelAlert` import in the new join state; it was fixed before commit. Final-host CORS remains a release gate.

## 3. Message lifecycle — P1

**Dependency:** The Swagger-documented lifecycle routes and Message fields are rechecked and verified with test accounts.

- [ ] Add typed `PATCH/DELETE /api/v1/rooms/{id}/messages/{message_id}` functions and Message fields. PATCH sends `{ content, revision }`; verify the documented `200` response and `409` conflict behavior.
- [ ] Add edit/delete controls to eligible message rows with keyboard support, edit draft preservation, destructive confirmation, and clear edited/deleted display.
- [ ] Merge history, newest-page responses, mutation responses, and eventual events by message ID and increasing revision. Keep tombstones ID-stable and content-free. Preserve scroll position while older pages load.
- [ ] On revision conflict, preserve the local edit and display the fresh server version with explicit retry/discard choices. Repeated delete must converge on the same tombstone.
- [ ] Test author/manager/forbidden cases, concurrent edits, delete while viewing, out-of-order results, page overlap, and reload.

**Exit gate:** No stale response restores erased content or overwrites a newer revision; edit conflicts are recoverable without losing the user's draft.

## 4. Durable read state and unread counts — P1

**Dependency:** The Swagger-documented GET/PUT read-state DTO and cursor semantics are verified with test accounts. This slice does not require WebSocket.

- [ ] Add typed `GET/PUT /api/v1/rooms/{id}/read-state` functions and room-scoped Vue Query keys. PUT sends `{ last_read_message_id }`; consume `{ room_id, last_read_message_id, unread_count }`. Advance a cursor only when messages are viewed; debounce writes without moving backward.
- [ ] Add unread badges to the room list using server state or a documented full-history calculation. Do not infer exact counts from the newest-page cache. Exclude own messages and preserve tombstone-by-ID behavior.
- [ ] Clear read state on logout, account switch, and membership loss. Test rapid room switches, overlapping writes, reloads, two tabs, leave/rejoin, and failed writes.

**Exit gate:** Read cursor and unread count converge with the backend after retries/reloads; no other user's private state is shown.

## 5. Deferred real-time integration — TODO

**Start only when the user brings frontend WebSocket/SSE work into scope.** The existence of a backend protocol alone does not change this boundary.

- [ ] Confirm WebSocket URL, auth transport, allowed origins, join/leave commands, error events, room/presence/typing/lifecycle envelopes, reconnect rules, and server revision/sequence metadata. Decide whether SSE has a supported role.
- [ ] Use `@vueuse/core` for WebSocket lifecycle. Keep REST as the recovery path and, unless the contract changes, the write path. Subscribe only to authorized rooms; close/revoke on logout or membership loss.
- [ ] Reconcile snapshots/history/read state after reconnect, dedupe by ID/revision, and handle gaps/unknown schema by pausing private rendering and refetching. Retain HTTP polling until the replacement is verified, then remove redundant traffic.
- [ ] Add bounded reconnect/backoff, offline UI, multi-tab presence, typing expiry, and tests for revocation, stale events, missed updates, and server drain (`1001`). Do not claim cross-instance guarantees before they are verified against the deployed service.

**Exit gate:** Two accounts and multiple tabs converge after reconnect and membership changes without private-data leaks; degraded transport has an explicit REST fallback.

## 6. Search, attachments, and inbox — P2

- [ ] **Search:** After the authorized, deletion-aware search endpoint is released, add room-scoped query form, cursor pagination, loading/empty states, and revoked-membership cleanup. Test edits/tombstones and result privacy.
- [ ] **Attachments:** Wait for provider, scanner, quota, reservation, and signed-download contracts. Add upload progress/cancel/retry and scan states; keep signed URLs ephemeral/private. Test scan failure, expiry, leave during upload, duplicate retry, and cleanup-visible states.
- [ ] **Mentions/inbox:** Wait for typed recipient/generation and feed/preference endpoints. Add recipient picker, private paginated inbox, preference controls, and retry-safe read actions. Test leave/rejoin and deleted references. Do not infer mentions by parsing names in text.

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
Deferred by product scope: WebSocket/SSE → Presence/typing → Distributed recovery
```

Complete the source and base-component foundation first. Swagger already documents lifecycle and read-state routes; those slices still need authenticated verification. Rich messaging waits for API release and provider gates. WebSocket/SSE remains a TODO under the current frontend scope.
