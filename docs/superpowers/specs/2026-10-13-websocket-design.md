# WebSocket integration proposal

Status: approved by the user on 2026-10-13; implementation is planned on `feat/websocket-integration`.

## Intent and scope

The user explicitly brought WebSocket work into scope on 2026-10-13 and supplied https://gogo-dl.onrender.com/asyncapi/. Make the existing REST chat react promptly to message, membership, and invitation events, recover safely after disconnection, and preserve message drafts, permissions, revision merging, and the pixel UI.

This first release adds a connection-status/retry control and room subscription lifecycle. Presence/typing presentation, notification inbox, SSE, and distributed-delivery guarantees are outside this slice. Keep REST for durable reads and all writes.

## Contract evidence

The published AsyncAPI 3.0 document declares protocol version 1.0.0, `/api/v1/ws`, browser query-token authentication, origin allowlisting, string room IDs, and `join`/`leave` commands. Each command is one JSON frame. Server text frames may contain multiple JSON envelopes separated by newline. Delivery is best effort with no replay or sequence cursor; graceful drain uses close code 1001.

Documented events are `join`, `leave`, `message`, `membership_changed`, `invitation`, `notification`, and `error`. A message payload lacks REST `revision`, `edited_at`, and `deleted_at`. The contract does not document edit/delete/read-state events or application heartbeat commands.

Authenticated live probes using the sandbox origin returned upgrade 101 for both test accounts. The owner joined room 5; the removed account received `error` with code `forbidden`. The owner also received `presence` and `presence_snapshot`, which are absent from both the published YAML and documentation page. No presence/typing schema is inferred from these samples.

## Alternatives and selected approach

1. **Recommended: event-triggered REST reconciliation.** WebSocket events coalesce targeted Vue Query invalidations. Message rendering uses REST DTOs and the existing revision/tombstone merge rules. Keep five-second latest-page/read-state polling because lifecycle/read-state changes have no documented event coverage.
2. **Direct event-backed message state.** This requires a complete backend lifecycle/revision and recovery contract before WebSocket payloads can safely replace REST responses. It increases backend and frontend scope and is deferred.

## Connection and source boundaries

- Add `@vueuse/core` and use `useWebSocket` inside a workspace-scoped composable. Each authenticated browser tab owns one socket, including while showing the room list so invitations can arrive.
- Derive the WS origin from the configured Axios API origin, changing `http`/`https` to `ws`/`wss`. Keep API configuration in the transport layer. Never log or display the token-bearing URL, raw socket errors, frames, or access tokens.
- Put pure envelope parsing/validation in a shared library module. Keep the connection composable and status UI in feature folders. Base controls remain presentation-only.
- Share active-room intent with route-level composition. Send `join` only after a REST room response establishes current membership; send `leave` on room changes. Neither command changes durable membership. Do not buffer subscription commands for later replay.
- Observe `session:changed` synchronously. Close the old socket, cancel reconnect/recovery, clear account-scoped transient state, and discard callbacks from previous generations before opening for a refreshed token or another account. Reuse the existing single-flight REST auth-refresh behavior; do not add a second refresh pipeline.

## Events, privacy, and state

- Validate JSON envelopes and positive decimal room IDs; reject unsupported frame formats and malformed known payloads. Treat all event payloads as untrusted and avoid rendering their content directly.
- `message`: refetch the matching active room's newest messages and read state. Coalesce event bursts without delaying membership revocation.
- `membership_changed`: refetch rooms, members, and active room authorization. If the affected user is the current account and the action is `left` or `removed`, stop the subscription and clear private room caches, seen messages, editor state, and rendering immediately through the existing access-loss path.
- `invitation`: invalidate the current account's invitation list and rooms. Do not read the invitation's private room details until REST grants access.
- `error`: `forbidden`/`membership_revoked` revoke the affected room; authorization failures suspend its private rendering and verify through REST. Use fixed, safe status copy rather than server error text.
- Unknown types, including undocumented presence envelopes, never update durable state or presence UI. Coalesce a REST authorization/data reconciliation when relevant; do not restart the socket on every unknown envelope. A malformed known event suspends private rendering until authorization/data recovery succeeds.
- Recognize documented notification envelopes without implementing an inbox or displaying private snippets. No authoritative events are emitted from the browser.

## Disconnection and recovery

Use bounded exponential backoff with jitter, at most five attempts and a 30-second delay cap, then show explicit retry with polling available. Offline status pauses connection attempts until connectivity returns. Do not enable VueUse's application heartbeat because the server only documents join/leave commands.

On connection/reconnection or foreground recovery, verify the session and room authorization through REST, refresh rooms/invitations/read state, and reconcile loaded message pages before accepting the room as synchronized. Keep drafts and scroll position, but gate private message rendering until authorization succeeds. Buffer/coalesce data refresh signals during recovery; revocation still takes effect immediately.

To recover a disconnect gap larger than the newest 40 messages, page backward with the existing `before` cursor until reaching a previously known message or the end of history, merge by ID/revision, and stop on room/account generation changes. Limit automatic bridging to ten additional 40-message pages. If no overlap is found within that bound, show an explicit conversation-reload action and a history-gap notice. Reload discards stale loaded pages and seen-message state, loads the latest authorized page, and preserves the composer draft; older history remains available on demand. Do not claim the entire gap has been recovered after that reset.

HTTP polling stays enabled in this release, including while the socket is healthy. Removing it is a separate change gated on lifecycle/read-state event coverage and measured recovery behavior.

## Verification and completion criteria

Use focused failing tests before implementing parsers and connection/state transitions. Cover newline batches, malformed envelopes, duplicate/late events, removed membership, stale account callbacks, room switches, token refresh, bounded retries, explicit close, drain 1001, gaps larger than one page, and aborted recovery. Test against real cache/render behavior rather than only mocked call counts.

Run `npm run check`. Use the sandbox with test accounts to verify WS handshake/join, event-triggered message refresh, invitations, membership removal, reconnect, logout, and REST fallback at desktop/mobile sizes. The existing private-room re-invitation blocker is independent and remains a release limitation. Record discrepancies between live runtime and AsyncAPI rather than inventing contracts.
