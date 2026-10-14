# Room message search design

Status: approved by the user on 2026-10-14. The approved [implementation plan](../plans/2026-10-14-room-message-search.md) is implemented on `feat/message-search`; [local acceptance](../../SEARCH_ACCEPTANCE_2026-10-14.md) passed. Final-host deployment remains open.

## Purpose and scope

Implement the Search slice in Phase 6 of PLAN.md: a current room member can find text messages beyond the loaded newest/history pages, paginate matching results, and get safe feedback when access changes. Preserve the existing room routes, pixel UI, composer draft, conversation scroll, message lifecycle, and durable read state. The live search contract is verified in `docs/SEARCH_CONTRACT.md`.

This release searches only the active room. Attachments, inbox, mentions, global search, highlighted HTML, ranking, total result counts, and jumping to arbitrary historical context are outside scope. Search does not imply accent folding or substring matching beyond the backend's documented plain-text AND behavior.

## Approaches considered

1. Filter already-loaded conversation messages: minimal UI, but misses server history and cannot meet the product requirement.
2. Dedicated search route: supports shareable navigation but adds routing and room-context transitions; URLs would contain private query text unless separately designed.
3. A room-local search panel: uses the verified endpoint and existing authorization context, keeps query text local, and preserves draft/scroll. This is the proposed approach.

## User interaction

Add a SEARCH button beside the room-header controls, visible to members. Opening search focuses a labelled field. Submit with Enter or SEARCH; do not make a request on every keystroke. Trim and validate 1–256 UTF-8 bytes before submitting. Show a brief helper that all query words must match. Invalid text leaves the field editable and does not silently discard the current results.

The search panel occupies the conversation-list area while open; the original list stays mounted but hidden. Keep the composer and its draft. Save the original reading position on open, suppress conversation auto-scroll while searching, and restore the position after closing. Hidden conversation rows have no visible viewport and must not trigger acknowledgements. Search rows do not register with `useViewedReadState`.

Display full safe text, author, date/time and an edited indicator in descending ID order; deleted authors use the existing neutral label. Search results offer no edit/delete controls in this slice. Use escaped Vue text interpolation. Search and pagination have distinct loading, empty, failure, retry and end states. LOAD MORE uses server `next_before`, deduplicates overlaps, and refuses a nonpositive/nonadvancing cursor rather than repeatedly requesting it. Do not claim a total count.

Changing the submitted query restarts cursor pagination. Closing the panel cancels in-flight search and clears its local state/cache. Changing rooms, explicit account changes, logout, membership loss, or room cleanup immediately closes/clears the panel. Escape closes it and focus returns to the SEARCH button. On mobile, keep controls reachable without horizontal overflow. Controls use existing PixelField/PixelButton/PixelAlert patterns.

## Source and state boundaries

- Add a typed `SearchMessagesResponse` DTO and `api.searchMessages(roomId, query, limit, before, signal)` in the existing types/API modules. Continue using the existing Axios transport and single-flight auth refresh.
- Extend `queryKeys` with room/account/query-scoped search keys nested under the room prefix so `clearRoomQueries` removes them. The raw query must never be written to browser navigation URLs, persistent storage, analytics, or diagnostics.
- Add a feature composable and `RoomMessageSearch.vue` under `src/features/messages/`. Use Vue Query for server results and cursor state; refs hold open state, input and submitted query. Base controls remain presentation-only.
- `RoomChat.vue` owns panel visibility, scroll/focus restoration and authorization props. Search emits current-room access loss into the existing cleanup path. Neither API modules nor base controls import feature UI.

## Freshness and privacy

Only enable reads/render results when the current profile and room membership are valid and `canReadPrivateData` is true. During WebSocket authorization recovery, hide prior results, cancel requests, and mark them stale; successful recovery must validate the current search before redisplaying private results. Guard async results and errors against the current account, room, submitted query and cache identity. Old errors cannot revoke a new room.

A local edit/delete invalidates that room's active search. Successful realtime REST reconciliation also invalidates search, including undocumented event hints, without rendering raw WS content. Search results keep visible-page five-second polling because remote edit/delete coverage remains incomplete; disable it while hidden/closed/recovering. Refetch loaded result pages when relevant changes occur; if the server no longer returns a match, remove it. Do not retain old matching text through the chat's `seenMessages` map. Never show a lower revision after a newer mutation; suspend results while reconciling if necessary rather than displaying a known stale match.

403/404 invoke current-room access cleanup. Final authentication failure follows the existing session/cache path. Handle safe read retry and existing 429 cooldown feedback; never introduce write replay or another refresh pipeline. Search operations are reads and must not acknowledge found messages or modify unread counts.

## Verification and completion

Use the real Vue Query and Axios boundaries in focused tests for byte validation, submitted-query isolation, descending ordering, exclusive/null/nonadvancing cursors, overlap, edits that stop matching, deletion, cancellation, access loss, stale room/account responses, and recovery gating. Test search does not emit read acknowledgements; closing preserves draft/scroll and restores keyboard focus.

Run `npm run check` and `git diff --check`. Then verify the current branch with two accounts and the deployed backend at an allowed development origin: Search beyond loaded history, edit/delete freshness, revoked access, query changes, pagination, keyboard controls and desktop/mobile layout. Retain production/sandbox deployment as a separate gate. Use disposable guest/message fixtures and clean them up.

After this design is approved, write the implementation plan with explicit API/query, component integration, privacy regression and live acceptance tasks. Keep work on `feat/message-search`; do not push, merge or deploy without the corresponding instruction.
