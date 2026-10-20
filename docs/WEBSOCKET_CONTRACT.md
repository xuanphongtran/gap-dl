# WebSocket contract and verification

**Local activity protocol verified (2026-10-20):** [Seventeen real-BE checks](./evidence/realtime-activity-contract-2026-10-20.json) pass on port8080: authorized/forbidden joins, typed initial/duplicate-join snapshots, first/last-tab presence, typing refresh/stop/TTL and controlled rate-limit errors. Owner3 and rooms1(public)/2(private) are intentionally retained by approval; disposable guests4/5 were deleted. This pins the written BE spec07 behavior despite AsyncAPI publication drift; frontend activity and typed lifecycle completion now have [local native acceptance](./REALTIME_COMPLETION_ACCEPTANCE_2026-10-20.md). Private reusable registry: `/tmp/gogo-realtime-phase5-R946Zj/registry.json`.

**Local contract recheck (2026-10-20):** Local port 8080 AsyncAPI SHA-256 is `f9d402402bdacad3ff032110c587fb6b678d2dd36f49f034cc171adbb5494626`. It now publishes `message_updated`/`message_deleted` with full Message revision/tombstone and typed attachment metadata, superseding the earlier lifecycle absence below. Presence/typing/read-state remain absent from AsyncAPI; presence/typing have a written BE contract in `spec/07-presence-read-state.md` at source `e8f7041`. The subsequent authenticated activity probe above confirms runtime behavior. [Evidence](./evidence/realtime-phase5-recheck-2026-10-20.json) and [approved design](./superpowers/specs/2026-10-20-realtime-completion-design.md) distinguish documented support from runtime acceptance. Further Phase 4 work is pending by user instruction.

**Hosted continuation (2026-10-16):** [Sandbox release acceptance](./SANDBOX_RELEASE_ACCEPTANCE_2026-10-16.md) closes the named sandbox's WebSocket multi-tab/reconnect and Mentions/Inbox deployment gates with native browser evidence. Earlier deployment limitations below are historical. Attachments and operational/distributed gates remain open.


Reviewed on 2026-10-14 against [AsyncAPI UI](https://gogo-dl.onrender.com/asyncapi/) and [YAML](https://gogo-dl.onrender.com/asyncapi/asyncapi.yaml), AsyncAPI 3.0.0 / API 1.0.0. This release uses events to reconcile durable REST state; it does not replace the REST write path.

## Completion behavior — 2026-10-20

`message`, `message_updated` and `message_deleted` require a matching full Message DTO, safe IDs/revision, nullable author, timestamps and typed arrays. The parser retains only ID/revision hints. Update/delete refresh retained history and invalidate Search; no raw event text/files enter durable state. Malformed activity is isolated from durable recovery, while revocation still wins within a batch.

`presence_snapshot` is `{room_id:string,online_user_ids:number[],typing_user_ids:number[]}` with distinct positive IDs. `presence` contains `{user_id,online}`; typing events contain `{user_id,expires_at}` with a valid start deadline or null stop. Commands contain only type and string room ID. The current socket's snapshot confirms subscription; full recovery sends one authorized duplicate join. HTTP repair cannot establish first confirmation. Local generations/event versions reject old reads and frames. Same-token reconnect has a distinct actual connection epoch.

Typing starts/refreshes at most once per 2000ms, including room changes on the same connection; idle stop is 1500ms and visible deadlines are capped at 5000ms. Actual input is required after a recovery. Activity updates do not fetch history/member/read-state on each keystroke. `not_joined` clears readiness and performs a guarded rejoin; authorization-pending/rate feedback is handled locally. Forbidden/revoked still clears private state. REST read-state behavior and five-second polling remain.

The historical 2026-10-14 protocol inventory below describes the first slice. This completion supersedes its presence/lifecycle deferrals only for the locally verified scope. AsyncAPI publication, selected-host rollout, SSE and cross-node guarantees are separate gates.

## Transport and authentication

The connection URL is derived from the configured `VITE_API_BASE_URL` origin: HTTP becomes WS, HTTPS becomes WSS, and the path is `/api/v1/ws`. Browser authentication uses an encoded access JWT in the `token` query parameter. Only the current token is used; URLs, frames, and raw transport errors are never logged or displayed by application code. The server separately validates the browser Origin against `WS_ALLOWED_ORIGINS`; REST CORS approval alone does not prove WS origin approval.

One authenticated workspace socket runs per tab, including the room list for invitations. `@vueuse/core` owns the native connection lifecycle. The client sends unbuffered `join`/`leave` frames with decimal-string room IDs only after REST confirms membership. These commands affect connection subscriptions, not durable room membership. All message and membership writes stay in REST.

Login/register mark `session:changed` as an account boundary and immediately clear private room callbacks/cache/drafts. Token refresh uses the existing single-flight Axios path and reopens the socket without treating a rotated refresh token as a new account. Generation and abort guards reject results from old rooms, accounts, and connections.

## Documented envelopes and observed differences

| Event | Frontend action |
| --- | --- |
| `message` | Coalesce authorized REST message/read-state reconciliation; never insert unversioned event text into message state |
| `membership_changed` | Refresh room/member state; self removal/leave revokes private rendering and cache before other events in the same batch |
| `invitation` | Refresh invitations/rooms without fetching uninvited private room details |
| `error` | Forbidden/revoked room errors clear private state; authorization/protocol problems trigger guarded REST recovery |
| `join`, `leave` | Recognize validated subscription notifications; no inferred presence UI |
| `notification` | Recognize the documented envelope; no inbox UI or private snippets |
| Unknown type | Coalesce REST reconciliation for the active room without rendering its payload or restarting the socket |

Parse every nonempty newline-separated JSON envelope in a server text frame. A malformed line does not discard a valid revocation elsewhere in the batch. Invalid known payloads suspend private rendering until REST authorization/data recovery succeeds.

Runtime also emits `presence`, `presence_snapshot`, and `read_state`; neither appears in the reviewed published AsyncAPI. Their payloads remain nonauthoritative. Typing and lifecycle edit/delete/read-state events are not documented. The published message event lacks REST revision/tombstone fields. The undocumented runtime read-state event is also treated only as a REST reconciliation hint. Presence/typing UI, direct event-backed message state, SSE, replay/sequence guarantees, and cross-instance delivery remain open contract gates.

## Recovery and polling

- Retry disconnects, including drain code 1001, with exponential backoff and jitter, at most five retries, capped at 30 seconds per delay. Then expose explicit retry. Offline pauses attempts; returning online reconnects.
- Do not send application heartbeat messages: only join/leave commands are documented.
- Revalidate session and room access, refresh all retained message ranges with stable exclusive cursors and refresh read state, and merge by ID/revision before resuming private rendering after reconnect/foreground recovery. Preserve composer draft and reading position.
- Bridge a disconnect gap backward from a synchronized history anchor using `before`, up to ten additional 40-message pages. A polled newest page does not establish that a gap is complete. If the bridge limit is exceeded, require explicit conversation reload; discard stale loaded pages and preserve the composer draft.
- Retain five-second newest-page/read-state polling while the socket is healthy, because the protocol does not provide complete lifecycle/read-state events. REST remains the transport fallback after authorization succeeds. Hidden tabs pause HTTP polling and reconcile when foregrounded.

## Verification evidence

Automated tests cover newline batches, validation, revision/tombstone retention, bounded/aborted gap bridging, event bursts, immediate revocation, stale account/room callbacks, token rotation, account switches, offline/retry limits, drain 1001, UI draft/scroll preservation, cached-room authorization gating, edits/deletions in displaced and bridged history, and explicit history reload. `npm run check` passed with 85 tests in 18 files, plus formatting, lint, typecheck, and production build.

Eight live headless-Chrome checks passed again after the review fixes against the deployed backend with this branch served at the allowed development origin `http://localhost:3000`:

1. Two-account browser login and native authenticated WS connections.
2. Private-room creation, authorized recovery, and room subscription.
3. Invitation arriving without browser reload and automatic member-list updates after acceptance.
4. A server message event followed by authoritative REST-rendered content; one measured update took about 622 ms on the post-review rerun (a smoke observation, not a latency guarantee).
5. Offline disconnect, missed messages, and reconnect recovery preserving the composer draft.
6. Desktop and 390 × 844 mobile conversation layouts without document horizontal overflow.
7. Socket membership revocation navigating the removed member away and removing private message content.
8. Logout closing native sockets without reconnect.

An additional authenticated read-only upgrade probe returned 101 with the sandbox origin `https://chat-sb.xuanphong.io.vn`. This confirms backend origin/auth acceptance; the changed frontend has not been deployed to that host. Multi-tab and large-gap recovery are automated checks; distributed delivery and a production rollout are not claimed.

Guest test messages were deleted and the disposable guest account was deleted with 204. Test owner and private room 6 remain because there is no REST room-delete operation. Credentials are in a restricted Git-ignored local fixture directory; screenshots/raw reports remain local. The previously confirmed private-room re-invitation blocker is still tracked separately.

## Opt-in upgrade probe

`npm run ws:contract:check` is outside deterministic CI. Provide `WS_ACCESS_TOKEN` through private local environment configuration, or `WS_FIXTURE_FILE` pointing to a private JSON file with `{ apiOrigin, accounts: [{ session: { access_token } }] }`. `WS_ORIGIN` defaults to `http://localhost:3000`; `WS_API_BASE_URL` overrides the default API origin when not supplied by the fixture. The probe validates the 101 upgrade/accept header, closes without subscribing, and performs no durable writes. Expired tokens or disallowed origins correctly fail the probe; do not put token-bearing URLs into reports.


## Independent review

The final independent review identified two Important findings: cached private content could appear during a room switch before REST authorization, and displaced/bridged retained history could miss later edits or tombstones. Both were reproduced with failing tests and fixed; the full 85-test check and eight browser smoke checks passed afterward.

Deferred minor: leaving the active conversation during a pending recovery can leave the workspace status at "Checking conversation updates" until another room or reconnect is selected. The private conversation is unregistered; this is a status issue.
