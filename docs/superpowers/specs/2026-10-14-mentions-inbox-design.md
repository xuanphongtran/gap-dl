# Mentions, inbox, and notification preferences design

Status: approved by the user on 2026-10-14. The [implementation plan](../plans/2026-10-14-mentions-inbox.md) awaits review on `feat/mentions-inbox`; no product implementation is included. Phase 6 contract evidence is in [the rich messaging review](../../RICH_MESSAGING_CONTRACT.md).

## Scope and approaches

Recommend one independent mentions/inbox release: typed recipients in the existing composer, a private metadata-only inbox, and account/room notification preferences. Attachments remain blocked by scanner/provider/download gates. External email/push, message previews, arbitrary history jumps, unread totals, and notification WebSocket events are outside this slice.

An inbox-only release would be smaller but leaves the frontend unable to create mentions. Waiting for attachments would delay usable, separately verified endpoints. The proposed combined slice gives users a complete send/receive flow while preserving the existing text-chat behavior.

## Mention composer and retry identity

Add a labelled recipient picker beside the existing composer. Load recipients from the authorized room-member query; select numeric user IDs with usernames as labels. Exclude the current sender from the picker. Selected recipients are visible removable controls. Typing `@name` has no special meaning. Selection is local to the current account/room and clears on successful send, account change, or access loss. Search opening preserves it along with the text draft. On room change, follow the existing draft lifecycle and never carry recipients into another room.

Text remains required and uses the existing 4,000-byte validation. Preserve the current text-only API behavior when no recipients are selected. A mention send snapshots trimmed content and sorted distinct recipient IDs and creates a random UUID idempotency key. Use exactly that payload and key for an explicit retry after an uncertain result; never replay a write automatically. A successful canonical response is merged through existing message handling and clears the pending send once.

While a send outcome is uncertain, freeze its snapshot and expose RETRY or DISCARD PENDING SEND. Discard requires confirmation that the original message may already have been accepted. Editing becomes a new intent only after discard. Definite validation/access errors keep the editable draft and require current membership validation before another attempt. A 409 never silently generates a replacement key. The in-memory pending snapshot expires for retry at 24 hours; require checking the conversation before a new send rather than rekeying automatically. This is per-tab retry safety, without a reload or cross-tab exactly-once guarantee. Store no payload/key in persistent storage or telemetry.

## Private inbox interaction

Add an INBOX navigation entry and `/app/inbox` route, composed from a feature component under `src/features/notifications/`. Show newest-first metadata rows, created time, read/unread state, and a neutral room label from the current authorized room list. The server does not provide content previews or authors. Known mentions use a mention label; unknown kinds use a generic notification label. Deleted references show MESSAGE DELETED without loading old content.

Use explicit ALL/UNREAD filters and LOAD MORE with a page size of 20 and the server's advancing positive `next_before`; deduplicate by notification ID. Provide loading, empty, error, explicit retry, and end states. Do not display a global unread count from only loaded pages.

MARK READ is an explicit action and calls PUT; reading the inbox or opening the room does not implicitly advance room read state. Repeated read retries are safe with the documented response, but remain user-triggered. Disable the affected row while pending. Merge successful acknowledgements without reverting non-null `read_at`, and invalidate the current feed/filter. OPEN ROOM reauthorizes room membership before navigation and opens the ordinary room route; it does not claim to scroll to the referenced message. Deleted entries have no open-message action.

## Preferences

Add an account-level MENTION NOTIFICATIONS control to the existing profile/settings screen, and a room-level MUTE MENTIONS control to existing room settings for current members. Explain that these affect future notifications, not previously delivered rows. Use explicit boolean PUT payloads including false. Confirm state from the server response; avoid optimistic preference success. Keep failed controls editable for explicit retry after any cooldown, and isolate each mutation's pending/error state.

## Data and privacy boundaries

Keep typed endpoints in `src/lib/api.ts` and existing Axios transport. Add DTOs and shared account-scoped feed/preferences keys in `src/lib/query.ts`; room preferences remain nested under the room prefix and account identity. Vue Query owns remote state, local refs own selection/pending snapshots, and Pinia remains session-only. Base controls have no API/router/session dependencies.

Pass AbortSignal to reads and guard late read/mutation callbacks against account, room, pending identity, and cache generation. On explicit account change/logout, clear the inbox, preferences, recipient selection, and pending sends. On membership loss, immediately remove affected inbox rows and room preferences and cancel related reads; stale callbacks cannot repopulate them. A rejoined membership must obtain a fresh server feed rather than reuse cached rows from the earlier membership.

Poll loaded inbox pages and authoritative room membership every five seconds only while the inbox is visible and authenticated. On foreground/reconnect, suspend private rows until fresh feed and membership checks complete. Display room entries only for current members; a publicly discoverable room with null role is insufficient. Server generation filtering remains authoritative. Local leave/removal and existing realtime revocation cleanup must also purge/invalidate the account's feed. Do not consume invented notification events or cache message bodies from notifications.

Refetch loaded feed pages after relevant changes so deleted/revoked entries cannot be resurrected by an older page. Hide previous rows during required authorization/reconciliation, cancel conflicting requests, and use the current cache identity for callbacks. Preserve scroll for same-filter refresh and reset for filter change. Honor 429 Retry-After in both explicit and automatic reads, use bounded safe-read retry, and expose errors without silently retrying writes. Apply the existing authentication refresh and final cache-clear behavior.

## Verification and handoff

Write focused tests with real Vue Query/Axios boundaries for typed selection, exact mention retry payload/key, 409 and uncertain outcomes, positive cursor pagination, asynchronous feed refresh, monotonic reads, false preferences, write isolation, cooldown-gated automatic requests, and account/room cancellation. Cover deleted references, revocation, public leave/rejoin cache reset, unknown kinds, keyboard controls, and draft/scroll preservation.

Run `npm run check` and `git diff --check`, then verify two accounts against the deployed backend in a local browser: mention selection/send, inbox eventual delivery/pagination/filter/read, preferences, deletion, revocation, public rejoin, offline/retry, mobile layout and keyboard navigation. Retain credentials securely until cleanup confirms completion; record any cleanup failure before discarding credentials. Obtain one independent final review and resolve critical/important findings with regression evidence.

After user review of this design, create the implementation plan and a new feature branch. Do not push, merge, or deploy without the corresponding instruction. Private-room re-invitation, provider/scanner readiness, distributed guarantees, and final-host acceptance remain separate gates.
