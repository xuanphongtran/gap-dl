# WebSocket Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after user review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated WebSocket subscriptions that promptly reconcile the existing REST chat and recover safely without exposing stale private messages.

**Architecture:** One workspace-scoped VueUse socket per authenticated tab triggers targeted Vue Query refreshes. The active room registers callbacks for suspension, recovery, and revocation; REST supplies authoritative revisions, tombstones, and read state. Existing polling remains enabled.

**Tech Stack:** Vue 3, TypeScript, `@vueuse/core`, Axios, Vue Query, Pinia session state, Vitest, Chrome browser smoke.

**Spec:** [Approved design](../specs/2026-10-13-websocket-design.md).

## Global constraints

- Work in the existing checkout on the user-requested new branch `feat/websocket-integration`; do not create an additional worktree.
- Node >=22.18.0; use the installed Node 22.23.1 for commands.
- Keep REST endpoints in `src/lib/api.ts`, transport/configuration in `src/lib/http.ts`, keys in `src/lib/query.ts`, and session state in Pinia.
- Use `@vueuse/core` for WebSocket lifecycle. No new state-management or transport libraries.
- Send only JSON `join`/`leave` commands with decimal-string room IDs. Never log token-bearing URLs or raw frames/errors.
- Retain five-second newest-page/read-state polling. No application heartbeat, SSE, presence/typing presentation, inbox UI, or distributed-delivery claims.
- Recovery bridges at most ten additional 40-message pages. Backoff allows at most five retries, with jitter and a 30-second delay cap.
- English code comments, tests, documentation, and UI; retain pixel tokens and accessible interactions.

## Review focus

1. Token refresh during recovery must close the old socket and prevent old-account callbacks from populating new caches. Task 2 covers a delayed REST result crossing `session:changed`.
2. Removal must beat a message event in the same newline batch, even if the message appears first. Task 2 covers immediate private rendering/cache cleanup.
3. A gap larger than 40 messages must not silently lose messages; exceeding the ten-page bridge must expose a reload action. Tasks 1 and 3 cover both boundaries.
4. Undocumented presence batches must not cause reconnect/refetch storms or produce authoritative presence UI. Tasks 1 and 2 cover unknown events and burst coalescing.
5. Hidden/offline room changes must not queue stale joins; intentional close/unmount must not reconnect. Task 2 covers rapid switches, offline retries, and cleanup.

## File responsibilities

| File | Responsibility |
| --- | --- |
| `src/lib/realtime.ts` | WS URL derivation and runtime envelope validation; no connection or cache state |
| `src/features/messages/recoverMessageGap.ts` | Authorized REST page bridging with an abort signal and bounded gap result |
| `src/features/rooms/realtime-context.ts` | Typed injection contract for active-room callbacks and connection status |
| `src/features/rooms/useWorkspaceRealtime.ts` | VueUse connection/session lifecycle, event routing, coalescing, retries, and recovery |
| `src/features/rooms/RealtimeStatus.vue` | Safe connection/retry status using existing pixel controls |
| Existing workspace/chat components | Provide/register context, gate private rendering, apply recovered messages, and offer gap reload |

## Task 1: Typed protocol and bounded REST gap recovery

**Files:** Create `src/lib/realtime.ts`, `src/lib/realtime.test.ts`, `src/features/messages/recoverMessageGap.ts`, and `src/features/messages/recoverMessageGap.test.ts`. Modify `src/lib/http.ts` to export its existing API base URL.

**Interfaces:**
- `websocketURL(apiBaseURL: string, accessToken: string): string`: validated HTTP(S) origin mapped to `/api/v1/ws` with encoded query token.
- `parseRealtimeFrame(frame: unknown): { events: RealtimeEvent[]; malformed: boolean }`: discriminated documented envelopes plus unknown envelopes with a validated optional room ID. Known payloads are validated without coercion; notification payloads are recognized but not rendered. A bad line does not discard valid revocation events from other lines.
- `recoverMessageGap(roomId: number, known: Message[], signal: AbortSignal): Promise<{ messages: Message[]; gap: boolean }>`: fetch the newest 40, then at most ten older pages using `before`; stop at overlap/end, merge using existing `mergeMessages`, and propagate abort/errors.

- [ ] Write failing protocol tests with literal envelopes: newline batches/blank lines, non-text frames, malformed JSON, unsafe/zero room IDs, malformed known payloads, valid membership revocation alongside an invalid line, and unknown `presence_snapshot`. Assert parsed event classifications and safe failure results.
- [ ] Write failing gap tests using Axios-mocked full Message DTOs: a 45-message disconnect gap is bridged, tombstones/newer revisions survive merging, empty/exact-page boundaries terminate, ten nonoverlapping older pages yield `gap: true`, and abort stops recovery without returning partial success.
- [ ] Run `npm test -- src/lib/realtime.test.ts src/features/messages/recoverMessageGap.test.ts`; confirm failures are caused by missing behavior, not invalid fixtures.
- [ ] Implement the interfaces, expose the existing transport base URL, and preserve all endpoint functions in `api.ts`.
- [ ] Run the focused tests and full `npm test`; verify HTTP request cursor boundaries and actual merged results. Commit the independently verified task.

## Task 2: Workspace connection, events, and recovery lifecycle

**Files:** Create `src/features/rooms/realtime-context.ts`, `src/features/rooms/useWorkspaceRealtime.ts`, and `src/features/rooms/useWorkspaceRealtime.test.ts`; add `@vueuse/core` in `package.json`/`package-lock.json`.

**Interfaces:**
- `RealtimeRoom` contains `id: number`, `userId: number`, `messages: () => Message[]`, `setPaused: (paused: boolean) => void`, `applyRecovered: (messages: Message[]) => void`, `reset: () => void`, and `onAccessLost: () => void`.
- `RealtimeContext` contains readonly refs `status` (`connecting | connected | recovering | offline | fallback`), `gapRoomId` (`number | null`), `registerRoom(room: RealtimeRoom): () => void`, `retry(): void`, and `reloadConversation(): Promise<void>`.
- Export an `InjectionKey<RealtimeContext>` from `realtime-context.ts` and `useWorkspaceRealtime(): RealtimeContext` from the composable.

- [ ] Install `@vueuse/core` using npm on Node 22. Read the installed `useWebSocket` implementation/types to confirm unbuffered sends and close/URL behavior; keep the real composable in tests and fake only the external WebSocket boundary.
- [ ] Write failing mounted-composable tests using a real Vue Query client and Axios mock responses. Cover event-triggered REST cache changes, membership removal before a message in the same batch, nonmember join denial, unknown-event burst coalescing, malformed-known-event rendering suspension, and invitation invalidation without fetching uninvited private room details.
- [ ] Add failing lifecycle tests: token/account change with a pending recovery, callbacks from an old socket, switching rooms before authorization completes, five retry attempts with no sixth retry, 1001 recovery, offline pause/online resume, intentional close, and unmount without reconnect. Assert visible status, real cache contents, and boundary join/leave frames where command ordering is the contract.
- [ ] Run `npm test -- src/features/rooms/useWorkspaceRealtime.test.ts` and observe missing-behavior failures.
- [ ] Implement the context and lifecycle. Configure VueUse with immediate/automatic URL opening disabled, no application heartbeat, and no send buffering. Own bounded retry scheduling in the composable, guard every asynchronous callback with account/room/socket generations, and remove all listeners/timers/controllers on scope disposal.
- [ ] Use `api.profile()` to verify/refresh through the existing single-flight Axios path before connection attempts. REST handshake/authorization failures must not create a second refresh pipeline or clear a newer account's session.
- [ ] Coalesce data events over 100 ms; process revocation immediately before other batch effects. Unknown events schedule REST reconciliation without restarting the connection. Capture recovery baseline IDs before refetching, verify room authorization, refetch active loaded pages, bridge the gap through Task 1, refresh read state, and resume private rendering only on current-generation success.
- [ ] On the ten-page limit, set `gapRoomId` and leave the conversation gated until explicit reload succeeds. `reloadConversation` calls the registered reset callback, removes stale message queries, reloads latest authorized REST state, retains the draft, and leaves older pages available on demand.
- [ ] Run focused tests and full `npm test`. Commit the independently verified task.

## Task 3: Workspace and room UI integration

**Files:** Create `src/features/rooms/RealtimeStatus.vue`, `src/features/rooms/RealtimeStatus.test.ts`, and `src/features/messages/RoomChat.realtime.test.ts`. Modify `src/features/rooms/RoomWorkspace.vue` and `src/features/messages/RoomChat.vue`.

**Interfaces:** Consume Task 2's injection key/context. The workspace provides one context; the room watches its ID, authorized role, and current profile ID and registers callbacks only for a current member. Standalone existing room tests without the provider retain the current REST behavior.

- [ ] Write failing integration tests mounting the real workspace/chat components: socket event refreshes messages before the polling interval; revocation removes cached/private rendered content; recovery gates content while preserving drafts and scroll; the gap notice/reload action resets stale history; rapid room/account changes cannot restore previous-room content.
- [ ] Write status-control tests for accessible retry and `aria-live` feedback, disabled retry while connecting/recovering, offline status, and absence of raw server error/token text. Verify keyboard activation through the rendered button.
- [ ] Run focused component tests and confirm the missing integration behavior fails.
- [ ] Provide the context from the workspace; add a compact status control without replacing the room list or profile navigation. Register room callbacks with synchronous cleanup and unregister on unmount.
- [ ] Add a recovery pause flag separate from durable membership loss. While paused, gate message rendering/private reads and read acknowledgements, and disable message writes until authorization recovers; preserve drafts and restore scroll on success. Membership revocation still invokes the existing destructive access-loss path.
- [ ] Apply recovered messages through revision-safe merge/query updates. Add explicit gap/reload UI using existing PixelAlert/PixelButton; do not expose protocol internals in product copy. Keep both five-second polling intervals unchanged.
- [ ] Run focused tests and full `npm run check`; fix any integration regressions and commit the verified task.

## Task 4: Live verification, documentation, and final review

**Files:** Update `SPEC.md`, `PLAN.md`, `docs/API_CONTRACT.md`, and add `docs/WEBSOCKET_CONTRACT.md`. Add an opt-in `scripts/check-ws-contract.mjs` and `ws:contract:check` script if needed to retain the authenticated read-only probe; deterministic CI must not depend on network availability.

- [ ] Record the reviewed AsyncAPI URL/version and runtime discrepancy, supported commands/events, safe origin/token configuration, polling rationale, retry/recovery limits, and remaining presence/typing gates. Mark only independently verified Phase 5 items complete.
- [ ] Run local frontend browser smoke against the deployed backend with the configured allowed development origin, using test fixtures. Verify message/invitation-triggered refresh, revocation, logout, interrupted connection recovery, and polling fallback at desktop/mobile sizes. Avoid re-inviting the retained removed account; preserve the known re-invitation blocker rather than bypassing it in acceptance claims.
- [ ] Verify origin and query-token handshake on sandbox as a contract probe. Do not claim the changed frontend is deployed there until its bundle is actually deployed; do not deploy without the user's deployment authorization.
- [ ] Run `npm run check` and `git diff --check`, inspect results, and complete one independent whole-branch review. Resolve critical/important findings with reproducing RED→GREEN tests and rerun the full check.
- [ ] Commit verified changes on the feature branch. Report tests, live checks, any unverified deployment gates, and retained fixture lifecycle. Do not merge or push unless requested.

## Execution handoff

Recommended method: implement inline in this session, then request one independent whole-branch review. The tasks depend on a shared room-registration interface and no per-task parallel implementation is needed. Await the user's plan review before installing product dependencies or writing product code.
