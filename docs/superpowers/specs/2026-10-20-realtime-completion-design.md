# Phase 5 realtime completion design

Status: proposed for user review, 2026-10-20. No product implementation is authorized by this document alone.

## Intent and scope

The user requests completion of frontend Phase 5 using the backend at `http://127.0.0.1:8080`, while placing further Phase 4 work on hold. Existing read-state behavior remains in place; this slice does not redesign cursor writes, unread counts or their acceptance. Existing attachment implementation is preserved, without advancing its separate real-storage acceptance.

Complete the existing workspace WebSocket integration with explicitly validated message lifecycle events, room-scoped presence and typing feedback. Keep REST authoritative for messages, writes, membership and recovery; retain five-second polling and the established VueUse connection lifecycle. Distributed delivery and SSE need their own contracts and remain separate work rather than assumed guarantees of this slice.

Success means correct room activity, no cross-account/room leakage, safe lifecycle convergence and bounded traffic through disconnect/rejoin/revocation. Local functional acceptance and selected-host deployment remain different claims.

## Contract evidence and boundaries

The fresh local AsyncAPI response has SHA-256 `f9d402402bdacad3ff032110c587fb6b678d2dd36f49f034cc171adbb5494626`. It publishes `message_updated` and `message_deleted`, full revision/tombstone Message DTOs, typed attachment summaries, and best-effort delivery without replay. Current FE treats both lifecycle types as unknown reconciliation hints; the existing message validator also requires a positive author ID despite the new nullable-author DTO.

AsyncAPI still omits presence/typing/read-state events and describes client commands as join/leave only. The local BE source at `e8f704179367cb80c72f9571fb477df725c4f42e` implements presence/typing and documents it in `spec/07-presence-read-state.md`. Use that explicit written contract plus observed local wire behavior to pin activity support; record AsyncAPI publication drift as a BE follow-up. Before enabling activity UI, verify that the running binary matches the typed contract. If it does not, keep that unsupported behavior gated and report the mismatch rather than inventing another protocol.

Presence means an authorized subscription to the active room, not global account activity. HTTP `GET /api/v1/rooms/{id}/presence` and `presence_snapshot` contain a string room ID and distinct online/typing user ID arrays. `presence` contains user ID and online boolean. No username, client ID or last-active time is needed for display.

Typing commands are unbuffered `typing_started`/`typing_stopped` with a string room ID and no user-supplied identity. Server events contain user ID and expiry; stop uses null expiry. Starts have a one-second minimum interval, approximately two-second refresh, and five-second server TTL. A snapshot lacks per-user typing expiry; bound its temporary typing display to five seconds unless a fresh event supplies a deadline. Scope all observations to this process; no cross-node promise is made.

## Alternatives and selected approach

1. Extend the existing workspace socket with a focused activity owner and shared typed parsing (recommended). This preserves one connection per tab and current cancellation/recovery boundaries.
2. Poll only the presence REST endpoint. This avoids typing commands but cannot complete interactive typing and adds periodic reads.
3. Add a second socket or event-backed durable message store. This duplicates lifecycle/auth state and widens the privacy and recovery surface without a required benefit.

Select option 1. Do not replace the HTTP recovery algorithm or remove fallback polling.

## State and source boundaries

Keep endpoint functions in `src/lib/api.ts`, account/room query keys in `src/lib/query.ts`, parsing in `src/lib/realtime.ts`, and the connection in `useWorkspaceRealtime`. Add a focused room-activity owner/composable under `src/features/rooms/` and extend the injected realtime interface with readonly activity and an input-activity action. No activity state goes into Pinia, persistent storage or durable message objects.

Safe HTTP presence snapshots use Vue Query with AbortSignal and current-account/room keys. Ephemeral event sets and expiry timers remain scoped to the current connection/account/room generation. Clear activity immediately on disconnect, foreground reauthorization, room change, access loss and account change; never show a previous snapshot as current while recovering. Names come from the currently authorized member query; ignore self and unknown member IDs for typing labels.

An authorized presence snapshot for this connection can establish subscription readiness. A join broadcast from another tab of the same account does not establish this socket's subscription. Do not send typing before current subscription readiness or while private rendering is paused. Obtain a fresh snapshot after recovery; a failed activity read must not erase durable messages or stop text chat.

## Lifecycle and protocol behavior

Validate `message`, `message_updated` and `message_deleted` with matching room IDs, safe positive message IDs, nullable author IDs and valid revision/timestamps. Tombstones must not restore text/files. Treat these events as coalesced REST reconciliation signals; keep existing revision merging and refresh all retained ranges/Search as appropriate. Never persist raw frames or signed URLs.

Presence/typing updates affect only activity state and must not trigger full history recovery on every keystroke. Keep unknown events as bounded reconciliation hints. Classify typing-specific `not_joined`, `authorization_pending` and `rate_limited` responses separately from authorization loss; avoid a room-wide recovery storm. Confirm exact observed error shapes before adding them. Revocation wins over all activity/message data in the same newline batch. Malformed activity must clear or recheck activity without borrowing another room/account's state.

No direct event-driven read-state updates are added while Phase 4 is pending. Preserve the existing REST reconciliation treatment of those hints.

## UI and outgoing typing

Add compact accessible online indicators/counts beside authorized room members, with explicit unknown/reconnecting state rather than false offline claims. Show a short typing label near the composer, excluding self, with bounded names and a plural summary. Use existing pixel tokens, readable text and polite status announcements without repeated screen-reader output on every refresh.

Only actual user input starts typing; restoring drafts, programmatic model updates and merely focusing the composer do not. Refresh while input remains active at most once per two seconds; stop after a short idle interval, successful send, empty draft, blur, Search opening, document hiding or room exit. The exact idle interval is 1.5 seconds. Cancel timers on scope boundaries. Never queue starts/stops across offline periods or send an old stop on a replacement account's socket. A failed stop expires through the server TTL. Normal text, captions and mention sending retain their current behavior.

## Local fixtures and acceptance proposal

The local DB has no available room fixture. The previous auth-only test accounts were deleted. This design proposes an explicit retention exception for local testing: create one clearly labelled reusable owner account and two rooms (public/private), intentionally keep that owner/rooms for subsequent acceptance, and keep credentials private. Publish only fixture IDs and retention status. This is a proposed decision for the user to approve, replacing the earlier requirement for an executable room cleanup path for these explicitly retained fixtures; the API has no room-delete operation.

Create separate disposable guest/moderator accounts as needed. Journal every fixture intent before its write and cleanup progress before each deletion. Delete guest messages, remove disposable memberships and delete disposable accounts after tests. Do not mutate existing nonfixture users/rooms, old Render records, backend configuration or database schemas. Never call retained owner/rooms cleaned up. Their eventual removal requires a separately authorized BE/admin operation.

Unit/mounted tests cover typed lifecycle/nullable-author/tombstone parsing, invalid and newline-batched frames, revocation precedence, presence snapshots/multi-tab aggregation, typing deadlines/refresh/idle/IME input, stale room/account callbacks, local-protocol errors, bounded requests and disposal. Use synthetic native fixtures for deterministic network/account races, accessibility and 390px layout. Run the required `npm run check` and meaningful existing realtime/mentions/attachment regressions.

Local real-BE acceptance then covers two users and multiple tabs, online aggregation, typing start/refresh/stop/expiry, reconnect/foreground fresh snapshots, leave/removal privacy, lifecycle edit/delete convergence and logout. Use an allowed frontend origin; existing unrelated applications on ports 3000/5173 remain running. Any temporary frontend asset remapping and browser-context local-network permission grants must be disclosed; API and WS requests must retain actual backend authorization and Origin checks. Native success does not establish distributed or hosted production behavior.

## Completion and handoff

Record source/contract hashes, actual observed wire contracts, checks and fixture retention/cleanup separately. Update Phase 5 checkboxes only for demonstrated scope; move distributed/operational follow-ups to their existing Phase 7 gate. Mark Phase 4 follow-up work pending per the user's instruction without undoing already completed functionality. Keep the current feature branch local; no push, merge, deployment, backend restart, migration or global security setting change is authorized here.

After written-spec approval, prepare the concrete implementation plan and preserve the established inline execution preference. This document is awaiting approval; no product source has changed.
