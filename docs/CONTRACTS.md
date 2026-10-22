# Integration contracts

Observed local baseline: 2026-10-22, backend8080. See [acceptance](ACCEPTANCE.md) for evidence and [pending](PENDING.md) for publication/deployment gaps. Recheck the target contract before changing a flow; this page is not a replacement for live authorization.

## REST

Keep endpoint functions in `src/lib/api.ts`, transport/refresh in `src/lib/http.ts`, server cache keys in `src/lib/query.ts`. The last local Swagger snapshot has 32 paths/42 operations; the checker requires 34 operations and core DTOs.

| Area                | Boundary                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rooms               | Public detail/discovery can precede join; messages/members need membership. Private denial is concealed404.                                                       |
| Message edit/delete | PATCH sends `{ content, revision }`; stale revision 409 preserves the draft. DELETE returns an ID-stable tombstone.                                               |
| Read state          | GET/PUT room read-state; positive `last_read_message_id` PUT; returned cursor can be 0. Monotonic/account/membership scoped.                                      |
| Search              | Room-scoped `q`, bounded pagination with `before`; deleted content cannot reappear.                                                                               |
| Mentions            | Explicit `mention_user_ids`; keyed sends preserve immutable payload and canonical message identity; changed payload409.                                           |
| Attachments         | Reserve upload → provider PUT → complete → verified metadata. Bind up to five `attachment_ids` with a caption. Download uses a fresh authorized 60-second ticket. |
| Inbox/preferences   | Account-scoped feed and explicit read/preferences; membership generations isolate delivered references.                                                           |

Provider PUT uses only issued headers, no API Authorization/cookies. Published/source success does not prove physical cleanup or released quota. New download-ticket denial does not instantly revoke previously issued links.

Errors use safe feedback for400/401/403/404/409/413/429/503. Respect valid `Retry-After`; request IDs are support references. Do not automatically replay uncertain writes or infer absence from401/500/network failure.

## WebSocket

Derive `/api/v1/ws` from the API origin using WS/WSS; authenticate with the current encoded access token in its query. Never log the URL. Backend WebSocket Origin validation is separate from REST CORS.

One socket per authenticated tab; `@vueuse/core` owns lifecycle. REST remains the write/authority path. Join/leave subscription commands use decimal-string room IDs after REST authorization; they do not change membership.

Parse nonempty newline-separated JSON envelopes. Membership revocation wins before other events in the same batch. `message`, `message_updated`, `message_deleted`, invitation and unknown events trigger scoped REST repair; do not trust event content as durable chat state. Reconnect has no assumed replay guarantee; retain polling and bounded history recovery.

Activity snapshots use string room IDs and distinct positive online/typing user IDs. Only the current connection's snapshot confirms subscription. Presence aggregates tabs; typing starts/refreshes at most once/2,000 ms, stops after 1,500 ms idle and expires within 5,000 ms. The written backend spec07 and runtime checks cover these fields; AsyncAPI publication remains B01. The backend emits private `read_state` events; current frontend convergence still relies on REST.

## Local verification sources

The target serves `/swagger/doc.json` and `/asyncapi/asyncapi.yaml`. Last recorded SHA-256:

- Swagger: `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de`.
- AsyncAPI: `f9d402402bdacad3ff032110c587fb6b678d2dd36f49f034cc171adbb5494626`.

Hashes identify observed documents, not a cryptographic attestation of the running binary or cross-node guarantees.
