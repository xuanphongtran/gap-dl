# Room message search contract

**Hosted continuation (2026-10-16):** [Eight native sandbox checks](./RELEASE_HARDENING_ACCEPTANCE_2026-10-16.md#hosted-search-acceptance) now verify query/pagination, edit/deletion freshness, read-state isolation, keyboard/mobile and revocation. Earlier named-host limitations below are historical; other production origins remain separate.


## Reviewed deployment — 2026-10-14

Source: https://gogo-dl.onrender.com/swagger/doc.json. Swagger 2.0, API version 1.0. Document SHA-256: `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`.

`GET /api/v1/rooms/{id}/messages/search` requires bearer authentication and current room membership. Parameters: trimmed `q` of 1–256 UTF-8 bytes, `limit` of 1–100 (default 20), and optional positive exclusive `before` message ID. Search is plain-text AND matching using PostgreSQL's simple configuration; stemming and accent folding are not guaranteed. Results sort by descending message ID and exclude deleted messages. Restart pagination whenever `q` changes.

The response is `{ messages: Message[], next_before: number | null }`, using complete REST Message DTOs with revision, edited/deleted timestamps, room ID, and nullable author identity. Treat a null cursor as the end; never infer the cursor from page length. No total count or highlighted snippets are documented.

## Authenticated runtime evidence

The probe used the retained owner/private room 6 and a newly registered disposable guest. Twelve checks passed:

- Unauthenticated search is denied with 401.
- Private room search concealed from a nonmember with 404.
- Public room search requires membership with 403.
- Blank/over-256-byte queries and invalid limit/cursor return 400.
- A 256-byte query is accepted.
- Results are complete Message DTOs from the requested room in descending ID order.
- Plain-text AND matching and whitespace trimming.
- Exclusive next_before pagination has no overlap and terminates.
- An invited member can search the private room.
- Edited text/revision replace old search matches.
- Deleted messages are excluded from matching results.
- Removed member immediately loses private search access.

Exclusive cursor pagination was exercised with a page size of one over three matching messages, with no duplicate IDs and a terminal null cursor. After an edit, the old term stopped matching and the new term returned the updated revision. A deleted message disappeared from matching results. A freshly invited member could search; after removal, private-room search returned 404 again. No re-invitation of the removed guest was attempted.

All three probe messages were deleted; the guest account was deleted with 204. The existing owner and room remain. Credentials and raw probe fixtures remain outside Git in restricted local storage. No other room's content was printed. This is HTTP contract evidence, not frontend Search/browser acceptance.

## Frontend gates

- Query and result caches must be room-, account-, and submitted-query-scoped, cancellable, and removed with the existing room/session cleanup.
- Pause and hide private search results while realtime authorization recovery is pending. Responses from earlier rooms, accounts, searches, and cache instances must not restore snippets.
- Refresh active search on local edit/delete and realtime REST reconciliation. Keep visible-page polling while complete lifecycle events remain undocumented.
- Search matches must not advance the normal conversation's read cursor or change exact unread counts.
- Search UI and automated privacy tests are implemented; [local-branch Chrome acceptance](./SEARCH_ACCEPTANCE_2026-10-14.md) passed with the deployed backend. Final-host deployment acceptance remains open.
