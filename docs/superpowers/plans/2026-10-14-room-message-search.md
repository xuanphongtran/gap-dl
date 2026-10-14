# Room Message Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve inline execution with one independent final review, as used in this session.

**Goal:** Let current members search all text history in the active room with authorized, private, cursor-paginated results while preserving the conversation draft and reading position.

**Architecture:** Add an endpoint to the existing Axios API client and account/room/query-scoped Vue Query search data. A feature composable owns submitted-query validation, cancellation and reconciliation; a feature panel renders the results. RoomChat controls visibility, focus, scroll and access loss; existing local mutations and realtime REST recovery invalidate search.

**Tech Stack:** Existing Vue 3, TypeScript, Vue Query, Axios, VueUse realtime lifecycle, Vitest/jsdom and pixel base controls. Node >=22.18.0, npm; no new dependencies.

**Spec:** [Approved Search design](../specs/2026-10-14-room-message-search-design.md), approved by the user on 2026-10-14. [Verified deployed contract](../../SEARCH_CONTRACT.md): twelve live checks passed.

## Global Constraints

- Keep work on `feat/message-search`, based on `74bfaa0`; this includes the prior WS/read-state branches but does not claim they are merged or deployed.
- English UI copy, source comments, tests and documentation. Preserve the existing pixel language and accessible controls.
- Endpoint functions remain in `src/lib/api.ts`, Axios transport in `src/lib/http.ts`, query keys in `src/lib/query.ts`; Pinia owns session only. Base controls must not import API/router/session.
- Trim queries and validate 1–256 UTF-8 bytes. Submit explicitly; do not search per keystroke. Use limit 20, optional exclusive positive `before`, descending message IDs and server `next_before: number | null`.
- Search is plain-text AND matching. No guarantee of accent folding, stemming, substring matching, total count or highlighted HTML.
- Current account and current authorized membership are required for requests and rendering. Hide results while recovering authorization; never redisplay old results before a fresh successful search.
- Cancel reads on close, room/account/query changes and access loss; prevent removed query instances and stale errors from updating a new room/account.
- Retain visible-only five-second Search polling until lifecycle events are complete. REST remains authoritative; no WS payload is rendered as search data.
- Search rows never acknowledge read state. Preserve composer/draft and conversation scroll; do not add routes, persistent query storage, telemetry or query text in URLs.
- No global search, edit/delete controls in results, arbitrary history jumps, attachments/inbox or unrelated refactoring. No push, merge or deployment without the corresponding instruction.

## Review Focus

1. Closing Search during a pending next page must not reopen it, restore a removed cache, or steal focus in another room; pin cancellation and delayed-page tests in Tasks 2–3.
2. A same-user refresh must preserve the submitted search while recovery gates it; an explicit same-user re-login must clear it; pin event-specific tests in Task 3.
3. A remote edit removes a match while older result pages are loaded; no prior cursor or retained snapshot may preserve old text; pin multi-page refetch and canonical-revision tests in Tasks 2–3.
4. Conversation updates arrive between opening Search and a scheduled scroll/read callback; the hidden list must keep its saved position and emit no acknowledgement for found results; pin queued-callback tests in Task 3.
5. An invalid UTF-8-length query is submitted while valid results already exist; retain the previous submitted results and show field feedback without requesting invalid input; pin validation tests in Tasks 1–2.

---

## Task 1: Typed endpoint, keys and pure search contract helpers

**Files:** Modify `src/types.ts`, `src/lib/api.ts`, `src/lib/query.ts`, `src/lib/api.test.ts`; create `src/features/messages/message-search.ts` and `src/features/messages/message-search.test.ts`.

**Interfaces:**
- `SearchMessagesResponse` in `types.ts`: `{ messages: Message[]; next_before: number | null }`.
- `api.searchMessages(roomId: number, query: string, limit = 20, before?: number, signal?: AbortSignal): Promise<SearchMessagesResponse>`; GET `/api/v1/rooms/${roomId}/messages/search`, params `q`, `limit` and optional `before`.
- `queryKeys.messageSearch(roomId: number)` returns the prefix `['room', roomId, 'message-search']`; `queryKeys.searchMessages(roomId: number, userId: number, query: string)` extends it with user ID and submitted query. Existing room cleanup removes the entire prefix.
- `normalizeSearchQuery(input: string): { query: string; error: string }` trims and validates byte length using `messageContentBytes`.
- `validateSearchPage(page: SearchMessagesResponse, roomId: number, before?: number): void` rejects unsafe/wrong-room IDs, results outside the exclusive cursor, and unsafe/nonadvancing non-null `next_before`. A non-null cursor requires nonempty results and must not exceed the oldest returned ID. Reject invalid pages before caching; never use page length to guess an end.
- `mergeSearchResults(pages: SearchMessagesResponse[], known: Message[]): Message[]` deduplicates by ID/revision, sorts descending, excludes tombstones, and suppresses a result if canonical conversation state has a higher revision or a tombstone. It must not substitute new canonical text into an old match.

- [x] Write failing API/key tests: default `q/limit=20`, optional `before`, exact AbortSignal propagation, DTO preservation, different account/query keys, and `clearRoomQueries(7)` removing all Search keys for 7 while retaining room 8.
- [x] Write failing helper tests: `normalizeSearchQuery('  hello  ').query === 'hello'`; blank input fails; 256 ASCII bytes pass; 257 fail; 128 `á` characters pass and 129 fail. Assert descending dedupe, newer revision retention, tombstone suppression and suppression of an old match whose canonical message was edited. Assert terminal null cursor, valid exclusive cursor, empty non-null cursor, unsafe IDs and repeated/nonadvancing cursor rejection.
- [x] Run `npm test -- src/lib/api.test.ts src/features/messages/message-search.test.ts`. Expected: new tests fail because Search functions/keys/helpers do not exist, with valid fixtures.
- [x] Implement the interfaces above in the named files. Keep response validation in the feature helper consumed by the query function; do not change generic Axios handling.
- [x] Run the focused command and `npm test`. Expected: all tests pass, including existing auth, WS, membership and read-state suites. Commit the verified task.

## Task 2: Cancellable submitted-query search state

**Files:** Create `src/features/messages/useRoomMessageSearch.ts` and `src/features/messages/useRoomMessageSearch.test.ts`.

**Interfaces:** `useRoomMessageSearch(options)` consumes readonly refs `roomId: number`, `userId: number | undefined`, `open: boolean`, `enabled: boolean`, `knownMessages: Message[]`, and `onAccessLost(id: number): void`. It returns `input: Ref<string>`, readonly refs `submitted: string`, `results: Message[]`, `error: string`, `validationError: string`, `pending: boolean`, `loadingMore: boolean`, `hasMore: boolean`, `retryAfter: number`, plus `submit(): void`, `loadMore(): Promise<void>`, `retry(): Promise<void>`, and `clear(): void`. `clear` removes current Search cache and local input/submitted/errors synchronously and starts cancellation without waiting for a network response.

- [ ] Write mounted-composable failing tests with real Vue Query and Axios mocks: no request on typing; explicit trimmed submit; invalid input leaves submitted query/results unchanged; changing valid query restarts at `before=undefined`; page two uses `next_before` exactly; null ends pagination; overlapping pages render once; invalid cursors give safe feedback and cannot loop.
- [ ] Add failing privacy tests: delayed success/403 from an old room/account/query cannot render or revoke the new room; closing during pending pagination aborts its signal and removes cache; a replacement query with the same key cannot accept an old response; current 403/404 invokes cleanup once. Recovery disables/cancels requests and hides cache; reenabling requires fresh successful Search before exposing results. A failed refresh does not redisplay prior results.
- [ ] Add failing freshness tests: polling runs at 5,000 ms only when the panel/document are visible and authorized; refetching two loaded pages removes a message edited out of the query and a deleted match; an older search response cannot show text suppressed by known newer conversation revisions/tombstones. Assert query text is absent from location/session storage and logged diagnostics. A 429 uses the existing cooldown and blocks only Search retry/load-more until expiry.
- [ ] Run `npm test -- src/features/messages/useRoomMessageSearch.test.ts`. Expected: missing-composable failures first; control response completion explicitly, and use fake timers for debounce/poll/cooldown rather than browser wall-clock sleeps.
- [ ] Implement the declared composable using `useInfiniteQuery`, initial page parameter `undefined`, page size 20, Task 1 validation before caching and `next_before ?? undefined` for the next page. Use complete-query refetch so changing matches recomputes loaded cursor pages. Hide results while refetch/recovery validation is pending or failed; consult only the current live cache/query identity, not a removed observer snapshot. Scope cancellation/removal to this panel's old keys. Clear on room/account/close; recovery invalidates cached data while retaining valid same-account submitted text.
- [ ] Run the focused command and `npm test`. Expected: all pass; cancelled/stale responses cannot reintroduce private Search data. Commit the verified task.

## Task 3: Search panel, room integration and realtime freshness

**Files:** Create `src/features/messages/RoomMessageSearch.vue`, `src/features/messages/RoomMessageSearch.test.ts`, `src/features/messages/RoomChat.search.test.ts`; modify `src/features/messages/RoomChat.vue`, `src/features/rooms/useWorkspaceRealtime.ts`, `src/features/rooms/useWorkspaceRealtime.test.ts`, and `src/style.css` only if shared layout rules need adjustment.

**Interfaces:** `RoomMessageSearch` consumes props `roomId: number`, `userId: number | undefined`, `enabled: boolean`, `knownMessages: Message[]`; its mount is the open-panel lifetime. Emits `close: []` and `accessLost: [id: number]`. It uses Task 2 with `open=true` while mounted, focuses the labelled field on mount and clears/cancels on teardown. The parent handles focus/scroll restoration and rejects stale access-loss IDs. No new realtime-context API is required.

- [ ] Write failing panel tests: focus/label/Enter submit, escaped text and deleted-user display, edited/date metadata, validation/loading/empty/error/retry states, distinct pagination loading/end state, Escape/CLOSE emission, no result edit/delete controls, and safe rendering while authorization is gated.
- [ ] Write failing RoomChat integration tests with real queries/router and mocked HTTP/WS boundaries: SEARCH opens a panel and keeps composer draft; closing restores saved scroll/focus; query changes reset results; room/account/logout/revocation closes and clears Search. A refresh-token session event preserves query through gated recovery; explicit same-account login clears it. A stale error cannot navigate a new room away.
- [ ] Add failing queued-callback tests: flush preexisting visible-message acknowledgements before opening, then search for an unloaded high-ID message; no PUT is emitted for that found ID. Opening before a pending read debounce cancels it. Live messages and a previously queued `scrollBottom` while searching cannot move the saved reading position; close restores it. Opening while editing preserves the chat editor draft.
- [ ] Add failing freshness/realtime tests: local edit/delete invalidates the room's Search prefix; a pending earlier search is cancelled first. Successful current-generation realtime REST reconciliation invalidates Search before private results can resume, including unknown-event reconciliation. Revocation removes Search keys through existing room cleanup. Other-room invalidations do not trigger this panel's request. Pin multi-page edits/deletions and reconnect gating from Review Focus.
- [ ] Run `npm test -- src/features/messages/RoomMessageSearch.test.ts src/features/messages/RoomChat.search.test.ts src/features/rooms/useWorkspaceRealtime.test.ts`. Expected: tests fail on missing UI/invalidation behavior, without bypassing real composables.
- [ ] Implement the panel and integration. Add a member-only SEARCH button disabled while access recovery is pending. Keep the existing message list mounted with `v-show` while Search is open; mount the panel separately in the list area. Use a separate read-state enabled ref combining existing private access with `!searchOpen`; do not disable membership/message reconciliation. Guard both scheduling and execution of chat auto-scroll while Search is open. Capture/restore scroll, and restore focus only if the originating room/button still exists. Close on synchronous room/user boundaries and explicit session end/accountChanged; preserve same-account refresh. Render result text with interpolation, use the existing neutral deleted-user copy, pixel controls and accessible status feedback.
- [ ] Wire local mutation/realtime Search invalidation: cancel Search prefix requests before invalidating them; pause/gate affected results through refetch, without awaiting arbitrary background query work as a condition for room recovery. Cancellation and callback generation checks must remain effective. Leave existing five-second newest-message/read-state polling unchanged.
- [ ] Run the focused command and `npm run check`. Expected: all tests, formatting, lint, types and build pass; existing WS/read-state behavior remains green. Commit the verified task.

## Task 4: Live acceptance, plan record and independent review

**Files:** Update `PLAN.md`, `SPEC.md`, `docs/SEARCH_CONTRACT.md`; create `docs/SEARCH_ACCEPTANCE_2026-10-14.md` (use actual verification date if later).

- [ ] Recheck deployed Swagger/contract and use restricted test fixtures. Run the current feature branch at an allowed development origin against the real backend with two accounts. Verify Search finds matches beyond the newest 40 messages, cursor pages/query changes, edits/deletions no longer matching, removal while Search is open, draft/scroll preservation, keyboard focus/Escape and desktop/mobile layout without horizontal overflow. Do not re-invite an already removed guest or claim deployed frontend acceptance.
- [ ] Clean up disposable guest messages/accounts and record remaining owner/room fixture lifecycle. Keep credentials, tokens, query text and raw private responses out of Git and user-facing logs. Document actual test/artifact evidence and any failed/open gates; mark Search UI complete only after its automated and live acceptance succeeds.
- [ ] Run `npm run check` and `git diff --check`. Expected: all pass. Commit the independently verified task.
- [ ] Request one fresh-context whole-branch review against the Search task base (`74bfaa0`), with the approved spec, this plan, Review Focus and recorded rulings. Re-grade findings by user impact; fix Critical/Important once using reproducing RED→GREEN tests and a passing full check. Record deferred Minors and scoped/unverified contracts. No per-task agents or second review.
- [ ] Commit review fixes and execution evidence. Keep `feat/message-search` clean without pushing/merging/deploying. Report checks, live results, remaining deployment/backend gates and any deferred findings.

## Self-review and handoff

The four tasks cover the approved interaction, source boundaries, freshness/privacy and acceptance sections. API/keys/helpers are defined before composable consumers; the panel/composable interfaces match parent integration. All five Review Focus cases have owning regression steps. This plan introduces no new dependencies or generic transport/realtime abstraction.

Execution remains inline, with one independent final reviewer. The user has approved the design; this implementation plan is ready for user review before product changes start.
