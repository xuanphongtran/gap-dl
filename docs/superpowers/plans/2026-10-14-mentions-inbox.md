# Mentions and Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let current members send typed mentions, receive a private paginated metadata-only inbox, and control account/room notification preferences.

**Architecture:** Existing Axios endpoints and Vue Query remain the remote-state boundary. Small feature composables own mention retry identity, authorized inbox reads, and preference mutations; route/components compose them using pixel controls. REST membership and feed responses are authoritative, with guarded visible-only polling and existing realtime revocation cleanup.

**Tech Stack:** Existing Vue 3, TypeScript, Vue Query, Axios, VueUse, Vitest/jsdom; Node >=22.18.0 and npm. No new dependencies.

**Spec:** [Approved mentions/inbox design](../specs/2026-10-14-mentions-inbox-design.md), approved on 2026-10-14; [deployed contract evidence](../../RICH_MESSAGING_CONTRACT.md).

## Global Constraints

- Execute inline on `feat/mentions-inbox`, based on `e142640`; one independent final review. No push, merge, or deployment without the corresponding instruction.
- English UI copy, source comments, tests, and documentation; preserve pixel styling and accessible native interaction. Base controls have no API/router/session imports.
- Keep typed endpoints in `src/lib/api.ts` and existing Axios transport. Vue Query owns remote state, local refs own selection/pending snapshots, and Pinia remains session-only.
- Text remains required and uses the existing 4,000-byte validation.
- A mention send snapshots trimmed content and sorted distinct recipient IDs and creates a random UUID idempotency key.
- Use exactly that payload and key for an explicit retry after an uncertain result; never replay a write automatically.
- The in-memory pending snapshot expires for retry at 24 hours; require checking the conversation before a new send rather than rekeying automatically.
- Store no payload/key in persistent storage or telemetry. This is per-tab retry safety, without a reload or cross-tab exactly-once guarantee.
- Use explicit ALL/UNREAD filters and LOAD MORE with a page size of 20 and the server's advancing positive `next_before`; deduplicate by notification ID.
- Poll loaded inbox pages and authoritative room membership every five seconds only while the inbox is visible and authenticated.
- Display room entries only for current members; a publicly discoverable room with null role is insufficient. Server generation filtering remains authoritative.
- MARK READ is explicit; inbox rendering never acknowledges room read state. OPEN ROOM reauthorizes membership and opens the ordinary room route, without a historical jump.
- Use explicit boolean PUT payloads including false. Confirm state from the server response; avoid optimistic preference success.
- Attachments, email/push, message previews, arbitrary history jumps, unread totals, and notification WebSocket events stay outside this slice.

## Review Focus

1. A lost send response followed by recipient edits or room navigation must retain the original retry identity instead of duplicating a message; pin snapshot/navigation tests in Task 2.
2. A stale read response arrives after switching to UNREAD or another account; it must not restore a row/cache or revert `read_at`; pin deferred-response tests in Task 3.
3. A member leaves/rejoins while older feed pages are cached; the client must require fresh membership/feed and cannot restore old-generation rows; pin revocation/rejoin tests in Tasks 1 and 3.
4. A 429 occurs during automatic reconciliation; focus, invalidation, and five-second polling must respect the same deadline as explicit retry; pin fake-clock tests in Tasks 3 and 4.
5. A failed preference save overlaps profile save or another room's operation; controls and feedback must remain isolated; pin overlapping-mutation tests in Task 4.

---

## Task 1: Typed endpoints, feed validation, and cache cleanup

**Files:** Modify `src/types.ts`, `src/lib/api.ts`, `src/lib/query.ts`, `src/lib/api.test.ts`, `src/lib/query.test.ts`; create `src/features/notifications/notification-feed.ts` and `notification-feed.test.ts`.

**Interfaces produced:**

- DTOs in `types.ts`: `MentionSendOptions { mentionUserIds: number[]; idempotencyKey: string }`; `Notification { id: number; kind: string; room_id: number; message_id: number; created_at: string; read_at: string | null; availability: 'available' | 'deleted' }`; `NotificationFeed { notifications: Notification[]; next_before: number | null }`; `NotificationPreferences { mentions_enabled: boolean }`; `RoomNotificationPreferences { muted: boolean }`.
- Extend `api.sendMessage(id: number, content: string, mentions?: MentionSendOptions): Promise<Message>` with optional `mention_user_ids` and `Idempotency-Key`; calls without options remain byte-for-byte text-only payloads.
- `api.notifications(limit = 20, before?: number, unreadOnly = false, signal?: AbortSignal): Promise<NotificationFeed>`; GET `/api/v1/users/me/notifications`, query `limit`, optional `before`, `unread_only`.
- `api.readNotification(id: number): Promise<Notification>`; PUT `/api/v1/users/me/notifications/${id}/read`, no body.
- `api.notificationPreferences(signal?: AbortSignal)` / `api.updateNotificationPreferences(mentionsEnabled: boolean)` return `Promise<NotificationPreferences>` using GET/PUT `/api/v1/users/me/notification-preferences`.
- `api.roomNotificationPreferences(roomId: number, signal?: AbortSignal)` / `api.updateRoomNotificationPreferences(roomId: number, muted: boolean)` return `Promise<RoomNotificationPreferences>` using GET/PUT the room preference route.
- Keys: `notifications(userId)` → `['notifications', userId]`; `notificationFeed(userId, unreadOnly)` extends that prefix; `notificationPreferences(userId)` → `['notification-preferences', userId]`; `roomNotificationPreferences(roomId, userId)` → `['room', roomId, 'notification-preferences', userId]`.
- `validateNotificationPage(page: NotificationFeed, before?: number): void` rejects unsafe/nonpositive IDs, invalid availability/read timestamps, rows outside an exclusive cursor, or an empty/nonadvancing non-null cursor before caching. String kinds remain open. `mergeNotifications(pages: NotificationFeed[], acknowledged: Notification[]): Notification[]` sorts descending, deduplicates, keeps known deleted availability and non-null acknowledgement timestamps.
- Extend `clearRoomQueries(id: number): void` to cancel/remove account inbox queries as well as its existing room cleanup. Whole-feed eviction avoids reconstructing generation-sensitive pages locally; subsequent reads require reauthorization. Do not import feature UI/helpers into the shared query module.

- [x] Write failing endpoint/key/helper tests: exact mention header/body, unchanged plain send, false PUTs, read PUT ownership path, signal propagation, account/filter key isolation, and room cleanup removing feeds while retaining unrelated room queries. Assert `mergeNotifications` retains a non-null `read_at` and deleted availability despite an older duplicate; safe exclusive cursors pass, zero/repeated cursors fail, unknown string kinds pass.
- [x] Run `npm test -- src/lib/api.test.ts src/lib/query.test.ts src/features/notifications/notification-feed.test.ts`; expect the new interfaces/behavior to fail.
- [x] Implement the interfaces above with existing `request`; validate feed responses in the feature query boundary, not generic HTTP transport.
- [x] Rerun the focused command; expect all tests green. Commit `feat: add notification contracts and private cache cleanup`.

## Task 2: Typed recipient selection and pending mention sends

**Files:** Create `src/features/messages/useMentionSend.ts`, `useMentionSend.test.ts`, `MentionRecipientPicker.vue`, `MentionRecipientPicker.test.ts`; modify `RoomChat.vue`, `MessageComposer.vue`, `MessageComposer.test.ts`; create `RoomChat.mentions.test.ts`.

**Consumes:** Task 1's `MentionSendOptions`, extended `api.sendMessage`, existing `RoomMember`, `Message`, `useActionCooldown`, `applyMessageResult`, `loseRoomAccess`, and `draftByRoom` behavior.

**Interfaces produced:** Export `useMentionSend(options)` where options contain `roomId: Readonly<Ref<number>>`, `userId: Readonly<Ref<number | undefined>>`, `enabled: Readonly<Ref<boolean>>`, `members: Readonly<Ref<RoomMember[]>>`, `draft: Ref<string>`, `onSuccess: (roomId: number, message: Message) => void`, `onAccessLost: (roomId: number) => void`. Return `selectedIds: Ref<number[]>`, readonly `sending`, `locked`, `error`, `cooldownSeconds`, `expired`, and async `send(): Promise<void>`, `retry(): Promise<void>`, `discard(): void`. `discard` resets the snapshot only; the UI owns confirmation.

`MentionRecipientPicker` props are `members: RoomMember[]`, `userId: number`, `modelValue: number[]`, `disabled: boolean`; emits `update:modelValue(number[])`. Use labelled native selection plus removable recipient buttons; identities remain numeric. Add optional `locked` to the composer to freeze the draft independently of request pending state; pending controls live beside it.

- [x] Write failing composable tests with mounted Vue Query, Axios mocks, fake clocks, and deterministic `crypto.randomUUID`. For an uncertain first POST, assert zero automatic retries and after explicit retry `expect(secondPayload).toEqual(firstPayload)` and `expect(secondKey).toBe(firstKey)`. Assert trimmed text/sorted unique IDs, duplicate Enter suppression, definite 400 editable draft, frozen 409 snapshot, and no POST at `24 * 60 * 60 * 1000` elapsed.
- [x] Add deferred-result tests: switch account while POST is pending; its completion cannot clear the new draft/cache. Switch rooms, return to the original room, and retry the same pending snapshot/key. Same-user token refresh preserves intent; explicit same-user login clears it. Nonmember/removed recipients cannot be selected or used for a fresh send.
- [x] Write picker/composer/integration tests: self excluded, `@name` sends plain text, selection and draft survive Search open/close, new room receives no previous-room recipients, successful canonical send clears once, discard requires explicit confirmation with uncertain-outcome copy. Pin keyboard labels and 4,000-byte boundary.
- [x] Run `npm test -- src/features/messages/useMentionSend.test.ts src/features/messages/MentionRecipientPicker.test.ts src/features/messages/MessageComposer.test.ts src/features/messages/RoomChat.mentions.test.ts`; expect targeted new behavior to fail.
- [x] Implement the exported composable and controls. Keep pending snapshots in account-scoped module memory per room across route unmounts; reset all on explicit session identity change and purge a revoked room. Guard callbacks by account/session epoch and pending identity, so successful writes for an earlier room merge only into its still-authorized cache. Preserve existing plain-send errors, cooldowns and scroll behavior. Never replace a conflicting/expired key silently.
- [x] Run the focused tests plus existing message/search tests; expect green. Commit `feat: add typed mentions with explicit retry identity`.

## Task 3: Authorized inbox, navigation, and explicit read actions

**Files:** Create `src/features/notifications/useNotificationInbox.ts`, `useNotificationInbox.test.ts`, `NotificationInbox.vue`, `NotificationInbox.test.ts`, `src/views/InboxView.vue`; modify `src/router.ts`, `src/features/rooms/RoomWorkspace.vue`; extend `src/features/rooms/useWorkspaceRealtime.test.ts` and `src/lib/query.test.ts` as needed for feed revocation.

**Consumes:** Task 1's feed functions/DTOs/keys and enhanced `clearRoomQueries`, existing `api.rooms`, `api.room`, profile identity, realtime context, `useActionCooldown`, and session event distinctions used by Search.

**Interfaces produced:** `useNotificationInbox(options: { userId: Readonly<Ref<number | undefined>>; enabled: Readonly<Ref<boolean>> })` returns `unreadOnly: Ref<boolean>`, readonly `rows`, `rooms`, `loading`, `loadingMore`, `hasMore`, `error`, `cooldownSeconds`, `readingIds`, and `loadMore(): Promise<void>`, `retry(): Promise<void>`, `markRead(id: number): Promise<void>`, `authorizeRoom(roomId: number): Promise<boolean>`. The component calls the router only after `authorizeRoom` succeeds in the same current account epoch.

- [x] Write mounted composable tests for 20-item pages, server null end, overlap dedupe, exclusive cursor rejection, asynchronous notification arrival, ALL/UNREAD cache isolation, unknown kinds, deleted references, and successful read monotonicity. Assert marking read never calls room read-state PUT.
- [x] Add delayed-page/read tests across filter switch, account switch/logout, removed query instance, membership loss, and public rejoin. Assert old feed pages cannot reappear and new membership requires successful fresh room-list/feed reads. Include a stale GET after a successful PUT that must not revert `read_at`.
- [x] With fake clocks, inject 429/Retry-After 60: poll tick at five seconds, focus, invalidation and manual retry send no GET before expiry; a guarded request can resume at 60 seconds. Assert hidden inbox sends no five-second polls. Foreground/reconnect hides rows until both feed and membership verify.
- [x] Write component/navigation tests: INBOX link resolves `/app/inbox`; metadata-only rows render escaped labels, deleted/unknown kinds safely, explicit MARK READ and disabled pending row; OPEN ROOM checks non-null fresh role. Public room `role: null` is insufficient. Preserve scroll on same-filter refetch, reset on filter change, and never focus/navigate from an old callback.
- [x] Run `npm test -- src/features/notifications/useNotificationInbox.test.ts src/features/notifications/NotificationInbox.test.ts src/features/rooms/useWorkspaceRealtime.test.ts src/lib/query.test.ts`; expect new tests to fail.
- [x] Implement infinite feed state with visible-only five-second polling of loaded pages and the shared room list. Cancel/gate reads during recovery and cooldown; reconcile fresh membership/feed before rendering prior private rows. Apply unknown-kind neutral rendering, no previews/author/snippets/counts, explicit read mutation, and membership-gated ordinary room navigation. Wire the route and sidebar link; existing realtime cleanup reaches Task 1's feed eviction without inventing notification events.
- [x] Rerun the focused tests and all tests; expect green. Commit `feat: add private notification inbox`.

## Task 4: Account and room preference controls

**Files:** Create `src/features/notifications/useNotificationPreferences.ts`, `useNotificationPreferences.test.ts`, `NotificationPreferencesControl.vue`, `NotificationPreferencesControl.test.ts`; modify `src/features/profile/ProfileScreen.vue`, `src/features/messages/RoomChat.vue`; create `src/features/profile/ProfileScreen.notifications.test.ts`.

**Consumes:** Task 1's account/room preference endpoints and keys, current profile/room identity, membership gates, and existing cooldown helper.

**Interfaces produced:** `useNotificationPreferences(options: { userId: Readonly<Ref<number | undefined>>; roomId?: Readonly<Ref<number>>; enabled: Readonly<Ref<boolean>>; onAccessLost?: (roomId: number) => void })` returns readonly `value: Ref<boolean | undefined>`, `loading`, `saving`, `error`, `cooldownSeconds`, and `save(value: boolean): Promise<void>`, `retry(): Promise<void>`. Presence of `roomId` selects room `muted`; otherwise account `mentions_enabled`. `NotificationPreferencesControl` consumes the same options through props `userId`, optional `roomId`, `enabled`, emits `access-lost(roomId)`, and renders the appropriate labelled checkbox plus explicit SAVE/RETRY controls.

- [x] Write failing tests for account true→false and room true→false exact payloads, server-confirmed state, failed save leaving editable intent, independent save/read cooldowns, and stale account/room mutation results. Assert 403/404 room errors invoke access cleanup only for the current room; profile save/delete state remains independent.
- [x] Add overlapping operation tests: failed account preference PUT beside a successful profile save; room switch while preference save waits; neither old feedback nor pending state leaks. Pin 429 automatic-read/focus/invalidation gating until the deadline.
- [x] Add UI tests for labelled MENTION NOTIFICATIONS in profile settings and MUTE MENTIONS in the current room's member/settings panel, visible to all authorized members. Explain future notifications only; test keyboard checkbox/save and disabled state while gated.
- [x] Run `npm test -- src/features/notifications/useNotificationPreferences.test.ts src/features/notifications/NotificationPreferencesControl.test.ts src/features/profile/ProfileScreen.notifications.test.ts`; expect failures for missing behavior.
- [x] Implement cancellable reads, explicit isolated mutations, server-confirmed cache updates, epoch guards and failure feedback. Mount room control in the existing members panel, avoiding another settings modal. Keep profile endpoint/action behavior unchanged.
- [x] Rerun focused tests and all tests; expect green. Commit `feat: add account and room mention preferences`.

## Task 5: Browser acceptance, final verification, and review

**Files:** Create `docs/MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md`; update `PLAN.md`, `SPEC.md`, the approved design, this plan and execution ledger. Browser harness/evidence stays in a private temporary directory unless a reusable check is justified by a found regression.

**Consumes:** The assembled Tasks 1–4 product behavior and retained authorized owner fixture. Produces a response-backed browser acceptance record and complete execution/review ledger.

- [x] Run `npm run check` with Node >=22.18.0 and `git diff --check`; expect format, lint, types, tests and build green, no whitespace errors. Run `npm run contract:check` to detect deployed schema drift before live acceptance; do not equate its route inventory with runtime acceptance.
- [x] Run local-branch desktop/mobile Chrome with a retained owner and disposable guest against the deployed API through an explicit temporary same-origin proxy; record direct CORS separately. Verify picker/send/plain `@name`, eventual inbox delivery, more than 20 notifications/cursor paging, read/filter, account disable and room mute/false restoration, deletion, membership removal, public leave/rejoin, offline/uncertain send retry, Search draft/selection preservation, scroll retention and keyboard interaction. Wait for expected notification IDs before pagination assertions; record observation bounds rather than delivery guarantees. No browser exceptions, cross-account data, or horizontal overflow.
- [x] Securely retain fixture login/refresh credentials before mutations; track IDs and persist evidence incrementally. Confirm cleanup of new messages, memberships, and accounts, including interrupted-run recovery. Do not alter legacy accounts 35/36 without credentials/backend authority; retain their unresolved admin-cleanup gate explicitly.
- [x] Obtain one independent whole-branch review after green checks. Fix Critical/Important findings in one regression-driven pass, rerun focused/full verification and affected browser journeys. Defer Minor findings explicitly; record each declined-to-judge item as a ruling with decision, reason, and cost if wrong.
- [x] Record final checks, browser evidence, API hash, remaining release/cleanup gates and reviewer findings in the acceptance document and execution ledger. Copy the final ledger into this plan, mark completed tasks in PLAN only after their evidence exists, and commit `docs: record mentions and inbox acceptance`. Do not claim deployment/merge or fully cleaned legacy fixtures.

## Execution handoff

Status: approved and implemented; Tasks 1–5 complete with [acceptance evidence](../../MENTIONS_INBOX_ACCEPTANCE_2026-10-15.md). Direct CORS is now [reverified](../../BACKEND_RECHECK_2026-10-15.md); final deployment remains an open release gate. Preserve native inline execution from the preceding feature work; use `superpowers:executing-plans` after user review, with one fresh final reviewer and no per-task implementation agents. Track task start/completion in `.superpowers/sdd/2026-10-14-mentions-inbox/progress.md`. The legacy fixture-cleanup issue does not justify fabricating credentials or blocking independent feature implementation.

## Execution record

# SDD ledger — plan: docs/superpowers/plans/2026-10-14-mentions-inbox.md
Spec approved; plan approved 2026-10-14. Native inline execution on feat/mentions-inbox.
Pre-flight: Task 1 → Tasks 2/3/4: API DTOs/signatures and keys align; cleanup evicts whole feed, which Task 3 must gate until reauthorization.
Pre-flight: Tasks 2/3/4 → Task 5: composed flows and cleanup acceptance agree.
Ruling: work in existing checkout on the approved new feature branch — preserves user's checkout preference and preceding inline workflow — cost if wrong: no separate worktree isolation.
Tasks: 1–5 complete; direct CORS and hosted release acceptance remain open.
Task 1: complete (commits cb62852..e1125d5, tests: npm test -- src/lib/api.test.ts src/lib/query.test.ts src/features/notifications/notification-feed.test.ts →    Duration  681ms (environment 66%, import 14%, tests 11%, transform 8%, worker 1%))
Task 2: complete (commits e1125d5..78c5b24, tests: npm test -- src/features/messages/useMentionSend.test.ts src/features/messages/MentionRecipientPicker.test.ts src/features/messages/MessageComposer.test.ts src/features/messages/RoomChat.mentions.test.ts →    Duration  1.39s (environment 53%, transform 19%, tests 15%, import 12%))
Task 3: complete (commits 78c5b24..29b5858, tests: npm test -- src/features/notifications/useNotificationInbox.test.ts src/features/notifications/NotificationInbox.test.ts src/features/rooms/useWorkspaceRealtime.test.ts src/lib/query.test.ts →    Duration  9.08s (tests 77%, environment 15%, import 4%, transform 4%))
Task 4: complete (commits 29b5858..0c91667, tests: npm test -- src/features/notifications/useNotificationPreferences.test.ts src/features/notifications/NotificationPreferencesControl.test.ts src/features/profile/ProfileScreen.notifications.test.ts src/features/messages/RoomChat.mentions.test.ts →    Duration  1.59s (environment 45%, transform 22%, tests 18%, import 15%))
Final review: original reviewer /root/review_mentions_inbox resumed after interruption and returned one report; a replacement was immediately interrupted and did not review.
Final grading: six Important findings accepted; the room-specific cooldown issue regraded Minor→Important because the approved design requires isolated room operations. All seven regressions failed before the fix pass (review-red.log, 7 failures).
Ruling: retain mention intents in account-scoped in-memory feature state across route unmounts; signal explicit room revocation from shared cleanup — component lifetime was narrower than approved per-tab retry safety — cost if wrong: longer-lived ephemeral pending state; session/revocation guards and regressions cover cleanup.
Final: fixed uncertain retry identity after rejected attempts; settings navigation retention; fresh preference remount; stale control save continuation; inactive room revocation; polling keyboard focus; per-room cooldown isolation — 7 regressions RED→GREEN (review-green.log, 22/22), whole check 186/186 with format/lint/types/build green.
Ruling: Task 5 functional Chrome acceptance uses an explicit temporary same-origin proxy; direct CORS is a separate blocked release gate because Idempotency-Key is missing from Access-Control-Allow-Headers — backend changes are outside this repo/authorization — cost if wrong: cross-origin mention sends remain unavailable until backend CORS is fixed.
Final: native Chrome caught inbox outer-page scrolling (notification-list scrollTop remained0 instead of500); bound inbox height to its content pane. The live harness remains the RED→GREEN layout regression; rerun includes focus({preventScroll:true}) to avoid the harness itself moving the scroller.
Final: Ruling: complete Task5 acceptance/documentation as the executor; the reviewer intentionally excluded the then-unfinished evidence — prevents treating absent review-time evidence as accepted — cost if wrong: insufficient live coverage; explicit checks and limitations are recorded.
Final: Ruling: attachments readiness and legacy accounts35/36 cleanup remain backend/admin gates — unavailable scanner and absent legacy credentials are outside this frontend change — cost if wrong: attachments stay unavailable and legacy fixture cleanup remains unconfirmed.
Final: Ruling: reload/cross-tab exactly-once, external channels, previews, and historical jumps remain excluded — approved scope promises per-tab in-memory retry safety only — cost if wrong: reload may lose pending identity and those capabilities are unavailable.
Final: Ruling: final hosting/deployment remains unaccepted; no merge/push/deploy performed by this run — local proxy evidence cannot close production/CORS gates — cost if wrong: hosted behavior may differ or cross-origin sends fail.
Final: native Chrome identified room preference reads stuck pending/idle while authorized. A real WS regression proved broad reconciliation cancellation aborts this unrelated read (realtime-preferences-red.log); exclude notification-preferences from that cancellation. Initial cancelled history also lacked a seed; a second failing test now initializes history from the authorized latest40 snapshot. Both WS regressions RED→GREEN,20/20; native room probe xfLUY1 now shows GET200, valuefalse and enabled checkbox.
Final verification after these integration fixes: npm run check green,189 tests, format/lint/types/build green. Native functional acceptance rerun continues; an owner-login fetch failure before registration created no fixture (CydmvV).

Final: shared membership query now uses account/cache identity independently of feed-filter cancellation; live ALL/UNREAD roundtrip race reproduced and regression RED→GREEN,12/12. Full check191/191,33 files; native main acceptance14 functional passes plus expected CORS blocker, separate native plain-at-name pass; screenshots inspected. Main fixture cleanup recovered three502 deletions to200; guest and temporary owner membership204.
Ruling: name acceptance document for actual run date2026-10-15 rather than planned14th — evidence should reflect when it was observed — cost if wrong: planned links need updating; all repository links updated.
Final: no deferred Minor findings; seven review findings fixed. Direct CORS and final deployment stay open in PLAN, while frontend implementation and local proxy acceptance are complete.
Task 5: complete (commits 0c91667..47a3408, tests: npm run check → ✓ built in 355ms)

Backend follow-up 2026-10-15, 07:49–07:54 UTC: direct Chrome CORS send/accepted-response-loss retry and private re-invitation pass; prior execution-record CORS/re-invitation blockers are superseded by [fresh evidence](../../BACKEND_RECHECK_2026-10-15.md). No frontend source changes. Final hosting remains open.
