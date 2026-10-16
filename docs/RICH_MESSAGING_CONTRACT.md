# Rich messaging contract review — 2026-10-14

Source: the deployed [Swagger JSON](https://gogo-dl.onrender.com/swagger/doc.json), API 1.0, 31 paths and 41 operations. SHA-256: `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`. These are authenticated HTTP probes, not frontend browser acceptance or a delivery latency guarantee.

## Attachments remain blocked

`POST /api/v1/rooms/{id}/attachments/uploads` requires an `Idempotency-Key` and `{ filename, content_type, sha256, size_bytes }`. The documented size range is 1–10,485,760 bytes. A current private-room owner submitting a valid small text-file reservation received `503` with `attachment uploads unavailable`, matching the route's scanner-pending description. No reservation or signed URL was returned; no bytes were uploaded.

The document also lists owned metadata GET/DELETE and POST `complete`. Completion only queues a scan; it does not verify or publish the file. Metadata has a string `state`, `verified`, and expiration fields, without a state enum. `attachment_ids` on message creation is reserved for scanner-backed binding. Authorized download, immutable provider storage, quota enforcement, scan outcomes, cancellation/retry, expiration, and delayed cleanup are not accepted. Do not add upload UI until these gates pass.

## Mentions and inbox are eligible for frontend design

| Operation                      | Published contract                                                                                                        | Observed behavior                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET room members               | Typed `user_id`, `username`, role, `joined_at`                                                                            | Fresh invited member appears; use identity selection rather than parsing names                                              |
| POST room messages             | `content`, optional `mention_user_ids`; mentions require 16–128 printable ASCII byte `Idempotency-Key`, retained 24 hours | Missing key: 400. Valid mention: 201. Identical retry: 201 with the same message ID. Changed content with the same key: 409 |
| GET personal notifications     | `limit` 1–100, exclusive positive `before`, `unread_only`; `{ notifications, next_before }`                               | Descending pages of two, advancing exclusive cursor, no overlap; unread filter excludes acknowledged item                   |
| PUT personal notification read | Notification ID; returns notification                                                                                     | Recipient: 200. Repeated read preserves `read_at`. Other account: 404                                                       |
| GET/PUT personal preferences   | `{ mentions_enabled: boolean }`                                                                                           | Default true; false and true accepted                                                                                       |
| GET/PUT room preferences       | `{ muted: boolean }`                                                                                                      | Default false; true and false accepted; private nonmember/removed member: 404                                               |

Notification fields are `id`, string `kind`, `room_id`, `message_id`, `created_at`, nullable `read_at`, and `availability` (`available` or `deleted`). The observed kind is `mention`. No body/snippet, author, unread total, membership-generation token, or historical-message lookup is provided. Do not invent those fields or a jump-to-message behavior. Unknown kinds need neutral rendering.

Delivery is asynchronous. An initial probe stopped on an empty immediate feed; it does not establish delivery failure. The corrected probe waits for expected notification IDs before pagination assertions. Notifications appeared after one or two polling iterations in sampled private-room runs. Disabled-account and muted-room sends produced no notification during five-second observation windows while the preference remained in effect; this is bounded evidence, not proof over an arbitrary worker delay.

## Privacy and membership generation

- Unauthenticated inbox GET returns 401. A different account cannot acknowledge the recipient's notification (404).
- Deleting a mentioned message retains a metadata-only notification with `availability: deleted`.
- Leaving a private room removes its feed entries; old read actions and room preferences return 404. New mentions targeting the departed member return 400.
- In a public room, leaving and rejoining does not restore the old notification. Replaying the original message key still returns the original message and produces no notification for the new membership during a five-second observation window. A fresh message/key reaches the new membership. The server owns this generation rule; the client must not manufacture a generation field.
- Private-room re-invitation remains a separate known backend blocker. Public rejoin evidence does not close it.
- `limit=101` returns 400. Contrary to the published minimum, `before=0` returns 200 as an initial page. The frontend should only emit valid positive advancing cursors, never depend on this permissive behavior.

## Evidence, cleanup, and remaining gates

Final private-room contract run: 40/40 checks passed, `/tmp/gogo-rich-contract-Zmq2Bn/report.json`. Public membership-generation run: 10/10 passed, `/tmp/gogo-mention-generation-siIHQK/report.json`. This total includes setup/send checks and the expected attachment 503; it is not 50 frontend acceptance journeys. Final runs cleaned eight messages (200) and three disposable accounts (204), including public memberships (204). Earlier private-room attempts also cleaned their seven messages and two accounts.

An earlier public-generation attempt lost its report when a connection timeout interrupted account cleanup. Follow-up audit confirms its messages 203 and 204 are tombstones. Account 35 is no longer a room member; account deletion is unconfirmed. Account 36 still has membership in public room 2. Its retained access token now returns 401, and no refresh token or login credentials were retained for that attempt. Backend administration is needed to confirm/remove these two disposable accounts. The audit temporarily joined the owner to inspect the public room and restored the owner's nonmembership with 204. Evidence: `/tmp/gogo-mention-generation-BB9jjw/audit.json` and `recovery.json`. Do not claim complete cleanup for that attempt.

Frontend design can proceed for mentions, metadata-only inbox, and preferences independently of attachments. Before shipping, implement and test cancellation/account isolation, safe send retry, preference-write errors, polling cooldowns, deleted/revoked rows, keyboard/mobile interaction, and two-account browser acceptance. Deployment, real 429 headers, cross-node delivery, and private re-invitation remain independent gates. Remote worker configuration/root cause and exact recipient-count/normalization limits have not been audited.
