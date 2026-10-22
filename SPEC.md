# Product specification

Current frontend behavior, updated 2026-10-22. Status is in [PLAN.md](PLAN.md); unresolved work is in [docs/PENDING.md](docs/PENDING.md).

## Account and rooms

- Register/sign in, retain the session across reloads in the same tab, and share one token-refresh request between concurrent 401s. Final auth failure/logout clears session and private cache.
- Discover public rooms before joining; messages/members require membership. Concealed private-room 404 must reveal no private details.
- Support create/join/leave, invitations, role management, profile updates and deletion. Explain owner transfer conflicts on 409. The server remains authoritative for every action.
- Membership loss immediately clears room data, drafts, editors, read state, Search and pending private UI. Late callbacks cannot restore removed data or another account's cache.

## Messages and read state

- Trim message content; require a nonblank caption and at most 4,000 UTF-8 bytes. Preserve drafts on failed sends. No automatic replay of uncertain writes.
- Eligible authors edit their own messages using `{ content, revision }`; managers can delete eligible messages. On409 preserve the edit and offer explicit retry/discard against the fresh revision.
- Merge by message ID and increasing revision. Tombstones stay ID-stable and content-free; nullable/deleted authors render neutrally. Keep scroll while loading older pages with `before`.
- Read state is `{ room_id, last_read_message_id, unread_count }`. Advance only for viewed messages in a visible/focused conversation; debounce and keep cursors monotonic. Use authoritative unread counts; own messages are excluded and tombstones count by ID.
- Read state is account/membership scoped. Reload, foreground recovery and explicit failed-write retry converge through REST; leaving/rejoining starts a new membership state.

## Realtime and recovery

- Use one authenticated `@vueuse/core` WebSocket per tab. Authorize through REST before joining; close/reconcile on token/account/room boundaries. Apply revocation before other events in a batch.
- Parse newline-separated envelopes; treat message/lifecycle events as REST reconciliation hints. Keep REST writes and newest-page polling every five seconds while visible.
- Reconnect/foreground recovery reauthorizes and bridges at most ten additional 40-message pages. Beyond that bound, offer explicit conversation reload while preserving the draft.
- Presence aggregates subscriptions across tabs. Only a current-socket snapshot confirms activity readiness; unknown/recovering state does not mean zero online.
- Native editable input starts typing. Refresh at most once/2,000 ms; stop after 1,500 ms idle or blur/send/Search/hide; expire within 5,000 ms. HTTP repair is scoped/coalesced and cannot restore stale activity.
- Workspace/network errors have explicit retry. Honor valid `Retry-After`; do not invent a countdown for missing/malformed values. Preserve action failures separately from read-recovery feedback.

## Search, mentions and attachments

- Search is room scoped, paginated and deletion/revision aware. Opening or reading Search does not acknowledge found messages. Preserve conversation drafts and scroll; clear results on access loss.
- Select mention recipients by user ID. Retry uncertain mention/file sends only with the original immutable caption, recipients, attachment IDs and idempotency key. Clear pending private state on account/access loss.
- Inbox is private and metadata-only, with pagination, explicit read/retry and account/room preferences. Leave/rejoin generations and deleted references cannot restore old notification content.
- Select up to five PNG/JPEG/TXT files, at most 10 MiB each. Upload progress/cancel/retry and processing state precede verified-file sends. The frontend requires captions; inbound file-only messages still render.
- Discarding an unsent selection cancels its owned upload; a file already owned by an uncertain keyed send is not canceled on ordinary room navigation. Enforce expiry and show processing failures without claiming success.
- Keep Files, bytes and signed tickets outside persistent stores/query caches/logs. Provider PUTs carry only the issued ticket headers and no API credentials/cookies.
- Download requests obtain fresh authorized short-lived HTTPS tickets. History/Search use safe processed metadata; tombstones expose no files. Membership/deletion denies new tickets; already-issued links are not claimed instantly revocable.

## Architecture and presentation

- Typed endpoints: `src/lib/api.ts`; Axios/refresh: `src/lib/http.ts`; Vue Query server state/keys: `src/lib/query.ts`; Pinia: session only.
- Base controls in `src/components/base/` have no API/router/session dependencies. Feature UI lives in `src/features/`; views compose routes. Local refs own drafts/panels.
- Pass AbortSignals to cancellable reads; isolate callbacks by account, room, connection and query generation. Do not log credentials, message bodies, raw socket URLs, signed URLs or provider errors.
- Preserve the pixel tokens in `src/style.css`, accessible labels/focus/keyboard behavior, contrast, reduced motion and mobile navigation. Distinguish loading, empty, offline, rate limit, retry and permission loss.
- Runtime authorization and current contracts govern behavior. SSE, cross-node guarantees and external email/push are outside the current frontend release; [pending gates](docs/PENDING.md) track what requires further evidence.
