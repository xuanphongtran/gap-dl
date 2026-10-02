# Frontend implementation plan: Gogo DL Web Chat

References: [frontend specification](./SPEC.md) and the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json), the REST contract source. Recheck Swagger before implementing each feature and verify authenticated behavior at `VITE_API_BASE_URL`. A Swagger route alone is not proof that the user journey works.

**Current frontend baseline (2026-10-02):** Vue 3, TypeScript, Router, Pinia session state, Axios transport, Vue Query server state, pixel UI, ESLint, Prettier, Vitest, and GitHub Actions are in place. Basic REST rooms, invitations, membership actions, profile, text messages, pagination, and latest-page polling are implemented. Authenticated end-to-end behavior on the target deployment still needs two-account verification. WebSocket and SSE are deferred.

## 0. Contract inventory and regression baseline — P0

- [x] Inspect the deployed Swagger JSON: on 2026-10-02 it reported API 1.0 with 20 paths and 27 operations, including message edit/delete, room read state, and room presence. The error schema currently exposes an `error` string.
- [ ] Recheck Swagger at implementation time; record target deployment version and compare request/response schemas with `src/types.ts` and `src/lib/api.ts`, including nullable deleted authors and message revision/tombstone fields. Verify documented contracts with authenticated requests.
- [ ] Confirm target origin, CORS, HTTPS, route availability, `expires_at`, refresh rotation, `before` ordering/limit, validation bounds, `Retry-After`, `X-Request-ID`, and stable error shape. Record which capabilities exist only on branches.
- [ ] Create two disposable development accounts and room fixtures. Verify register/login/refresh, create/join/invite/accept/send/history/leave/profile/delete-conflict in a browser. Check public/private concealment and owner transfer rules.
- [ ] Keep `npm run check` green in CI. Add focused tests for new DTOs, error mapping, and query invalidation as each slice lands. Use mocked HTTP for deterministic tests and an opt-in live smoke check for deployed behavior.

**Exit gate:** A versioned contract matrix identifies deployed routes and fields; existing text-chat journeys work with two accounts, or response-backed mismatches are recorded as blockers.

## 1. Hardening and membership alignment — P0

- [ ] Extend Axios error normalization with documented `error` messages, `Retry-After`, and `X-Request-ID` after confirming the response headers. Add field-level mapping only if Swagger later defines a stable field error shape. Preserve single-flight `401` refresh and clear private Vue Query data on final auth failure.
- [ ] Add actionable UI for `413`, `429`, transient `503`/warm-up, ownership `409`, and concealed private-room `404`. Do not replay non-idempotent writes automatically. Show a bounded retry timer for valid `Retry-After`.
- [ ] Render nullable deleted authors and account-deletion ownership conflict without losing message identity or exposing deleted text.
- [ ] Align create/join/leave/invite/member controls with the deployed authorization matrix and idempotent retry behavior. Remove private room queries immediately after membership loss. Add public-room discovery only if the deployed API exposes it.
- [ ] Test role changes, removal during an open room, transfer-before-leave, duplicate join/leave, hidden private rooms, logout/account switch, mobile layout, and keyboard interaction.

**Exit gate:** Errors and membership changes render safely, private cache is cleared on revocation, and current REST chat remains usable. Final membership semantics are verified against the deployed API.

## 2. Message lifecycle — P1

**Dependency:** The Swagger-documented lifecycle routes and Message fields are rechecked and verified with test accounts.

- [ ] Add typed `PATCH/DELETE /api/v1/rooms/{id}/messages/{message_id}` functions and Message fields. PATCH sends `{ content, revision }`; verify the documented `200` response and `409` conflict behavior.
- [ ] Add edit/delete controls to eligible message rows with keyboard support, edit draft preservation, destructive confirmation, and clear edited/deleted display.
- [ ] Merge history, newest-page responses, mutation responses, and eventual events by message ID and increasing revision. Keep tombstones ID-stable and content-free. Preserve scroll position while older pages load.
- [ ] On revision conflict, preserve the local edit and display the fresh server version with explicit retry/discard choices. Repeated delete must converge on the same tombstone.
- [ ] Test author/manager/forbidden cases, concurrent edits, delete while viewing, out-of-order results, page overlap, and reload.

**Exit gate:** No stale response restores erased content or overwrites a newer revision; edit conflicts are recoverable without losing the user's draft.

## 3. Durable read state and unread counts — P1

**Dependency:** The Swagger-documented GET/PUT read-state DTO and cursor semantics are verified with test accounts. This slice does not require WebSocket.

- [ ] Add typed `GET/PUT /api/v1/rooms/{id}/read-state` functions and room-scoped Vue Query keys. PUT sends `{ last_read_message_id }`; consume `{ room_id, last_read_message_id, unread_count }`. Advance a cursor only when messages are viewed; debounce writes without moving backward.
- [ ] Add unread badges to the room list using server state or a documented full-history calculation. Do not infer exact counts from the newest-page cache. Exclude own messages and preserve tombstone-by-ID behavior.
- [ ] Clear read state on logout, account switch, and membership loss. Test rapid room switches, overlapping writes, reloads, two tabs, leave/rejoin, and failed writes.

**Exit gate:** Read cursor and unread count converge with the backend after retries/reloads; no other user's private state is shown.

## 4. Deferred real-time integration — TODO

**Start only when the user brings frontend WebSocket/SSE work into scope.** The existence of a backend protocol alone does not change this boundary.

- [ ] Confirm WebSocket URL, auth transport, allowed origins, join/leave commands, error events, room/presence/typing/lifecycle envelopes, reconnect rules, and server revision/sequence metadata. Decide whether SSE has a supported role.
- [ ] Use `@vueuse/core` for WebSocket lifecycle. Keep REST as the recovery path and, unless the contract changes, the write path. Subscribe only to authorized rooms; close/revoke on logout or membership loss.
- [ ] Reconcile snapshots/history/read state after reconnect, dedupe by ID/revision, and handle gaps/unknown schema by pausing private rendering and refetching. Retain HTTP polling until the replacement is verified, then remove redundant traffic.
- [ ] Add bounded reconnect/backoff, offline UI, multi-tab presence, typing expiry, and tests for revocation, stale events, missed updates, and server drain (`1001`). Do not claim cross-instance guarantees before they are verified against the deployed service.

**Exit gate:** Two accounts and multiple tabs converge after reconnect and membership changes without private-data leaks; degraded transport has an explicit REST fallback.

## 5. Search, attachments, and inbox — P2

- [ ] **Search:** After the authorized, deletion-aware search endpoint is released, add room-scoped query form, cursor pagination, loading/empty states, and revoked-membership cleanup. Test edits/tombstones and result privacy.
- [ ] **Attachments:** Wait for provider, scanner, quota, reservation, and signed-download contracts. Add upload progress/cancel/retry and scan states; keep signed URLs ephemeral/private. Test scan failure, expiry, leave during upload, duplicate retry, and cleanup-visible states.
- [ ] **Mentions/inbox:** Wait for typed recipient/generation and feed/preference endpoints. Add recipient picker, private paginated inbox, preference controls, and retry-safe read actions. Test leave/rejoin and deleted references. Do not infer mentions by parsing names in text.

**Exit gate:** Each slice has its own deployed API/privacy gate and can ship independently. External email/push and attachment-only sends stay outside this plan.

## 6. Release and operations alignment — P2

- [ ] Verify browser behavior during backend warm-up, failed readiness, rolling deployment, and transient `503`; show retry without exposing migration details. Production route fallback and CORS must work on the selected host.
- [ ] Once distributed delivery is deployed, exercise replay/gap recovery, two-node room delivery, cross-node presence/typing, revocation, and graceful drain with the frontend. An event ACK is transport progress, not proof the browser rendered it.
- [ ] Measure client traffic, error rates, interaction latency, and long-history memory. Keep tokens, signed URLs, message bodies, and personal identifiers out of telemetry; use request IDs only for safe diagnostics.
- [ ] Run `npm run check`, desktop/mobile accessibility smoke tests, and two-account deployed journeys before release. Record API version, test results, remaining gates, and rollback path.

**Exit gate:** The frontend works through expected backend failures. Any real-time scale claim has measured two-instance evidence from the backend rollout.

## Delivery order

```text
Contract inventory → Hardening/membership → Message lifecycle → REST read state
                                      └───────→ Search → Attachments → Inbox
Deferred by product scope: WebSocket/SSE → Presence/typing → Distributed recovery
```

Contract inventory and hardening can begin now. Swagger already documents lifecycle and read-state routes; those slices still need authenticated verification. Rich messaging waits for API release and provider gates. WebSocket/SSE remains a TODO under the current frontend scope.
