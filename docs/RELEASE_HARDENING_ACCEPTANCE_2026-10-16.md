# Release hardening acceptance — 2026-10-16

Status: planned frontend deliverables and one independent review completed; review corrections committed as `67bebd6`, verified on 2026-10-17. Hosted Search evidence is dated 2026-10-16; deployment of the new recovery changes remains open. Branch `feat/release-hardening` starts at `5650316`. This run does not push, merge, deploy, change deployment protection or configure R2.

## Product changes and deterministic checks

Workspace read failures now have an explicit RETRY WORKSPACE action. Only active profile/rooms/invitations reads are retried; double retry is single-flight, observed Retry-After blocks explicit retry, and successful reads do not erase failed mutation feedback. Session/account changes cancel owned reads and suppress old feedback. Six composable regressions and one real workspace integration regression were written before implementation.

The long-history native run exposed a fallback recovery defect: changing rooms while an earlier REST recovery was pending could leave the new room permanently paused when WebSocket was unavailable. A mounted regression failed first; the minimal registration fix starts new-room recovery while the old workspace recovery status remains. Existing account/room guards, polling and history bounds are unchanged. The WebSocket suite passes 21/21 and six final native history runs pass.

The 2026-10-16 `npm run check` passed format, lint, TypeScript, 207 tests in 37 files, and build. Local assets: `index-DZOtRLxK.js`, `index-_lAJKJ8Y.css`; log `.superpowers/sdd/2026-10-16-release-hardening/task3-check.log` during execution. These product changes are not yet deployed by this run.

`npm run contract:check` passes 29 required operations; API 1.0, 31 paths, 41 operations, unchanged Swagger SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`.

## Repeatable local browser evidence

`npm run acceptance:recovery` passes all seven simulated scenarios after the recovery handoff fix: login 503 without automatic POST replay, workspace 503/retry, accepted mention response loss with one canonical message after explicit retry, Inbox 429 with a five-second deadline, missing/malformed Retry-After without an invented countdown, and delayed recovery across logout/account change. GET request timestamps verify the five-second deadline; CORS preflights are excluded. Fixtures reject changed payloads under an existing mention key. Focus/invalidation and manual retry do not bypass the Inbox cooldown.

2026-10-16 recovery evidence: `/tmp/gogo-recovery-2rZa49/report.json`. API fixtures bind loopback only, app configuration points to that local origin, and the browser blocks HTTPS. No real backend mutations occur. Reports whitelist status/count metadata and exclude payloads, tokens, retry keys and raw transport traffic. Expected WebSocket refusal exercises REST fallback; it is not a simulated successful socket or an actual backend drain.

`npm run acceptance:history` passes six final runs (three each at 40/1,000 rows), preserving all rows after ten room switches. [History cost evidence](./HISTORY_COST_2026-10-16.md) records load, REST traffic, optional heap samples, simulated visibility and measurement limits. Evidence: `/tmp/gogo-history-V19yxV/report.json`. Do not combine earlier failed probes with this final baseline or infer a production SLA/memory leak from unforced-GC development-build heap samples.

`npm run search:scroll:check` passes native same-query scroll restoration and new-query reset; evidence `/tmp/gogo-search-scroll-V0pjZ6/report.json`.

## Hosted Search acceptance

Eight native Chrome checks passed directly on `https://chat-sb.xuanphong.io.vn` with the real backend, a retained owner and a fresh disposable guest:

1. An uninvited account cannot search the private room (404).
2. Keyboard Enter submits the query; exclusive cursor paging produces 22 unique matches.
3. Polling refreshes an edited loaded result and removes a deleted result.
4. Same-query polling retains scrollTop 400; a new query resets it to zero.
5. Search actions and result refreshes issue no room-read PUT while Search is open.
6. Escape restores the conversation draft and Search button focus.
7. Desktop and mobile 390×844 fit without document horizontal overflow.
8. Removal navigates away from open Search, clears private results and conceals the endpoint with 404.

Evidence: `/tmp/gogo-search-host-20261016-Jva3yO/report.json`, started 2026-10-16T07:31:01Z; no browser exceptions. Desktop/mobile screenshots in that directory were visually inspected. The initial attempt stopped because its condition dereferenced results while the UI correctly hid them during authorization/refetch. It is not counted as a full pass; `/tmp/gogo-search-host-20261016-jmtPp6/report.json` preserves that partial run. The condition was corrected without product changes.

Both attempts deleted all 22 created messages with 200 and their disposable account with 204: 44 messages/two accounts in total, zero unconfirmed cleanup. Credentials were persisted privately before writes; resource IDs were captured after successful responses. Review found that ambiguous writes and interrupted cleanup were not safely accounted for by that temporary harness. Existing owner/private room and legacy accounts 35/36 were not altered.

The hosted build is the previously released `index-P4Ch8try.js`. Search code and API transport are unchanged by this branch; this closes Search's named-host gate. It does **not** prove the new RETRY WORKSPACE or fallback handoff fix is deployed. Those changes are covered locally and need a separate deployment plus affected-flow smoke after the user publishes them.

## Remaining gates and rollback

Attachments stays pending by user instruction while R2 is not configured; no upload UI or repeated reservation probes were added. R2 alone will not close scanner, quota, binding, authorized download and cleanup requirements.

Actual backend 429 headers/countdown, real warm-up/readiness failure, rolling deployment/drain, cross-node delivery, production traffic/latency/long-session memory and legacy admin cleanup remain open. Local injected responses do not close them. No live request flood or service restart was performed. Presence/typing, SSE and distributed delivery guarantees remain outside scope.

Rollback: retain or redeploy the previously accepted `index-P4Ch8try.js` release through the authorized hosting workflow if a future deployment of this branch regresses. This run makes no hosting change and claims no broader production rollout.

## Review corrections — 2026-10-17

One independent whole-branch review returned three Important findings and no Critical findings. A staggered pair of 429 responses reproduced three early GETs: a five-second header received 500 ms later was compared with rounded remaining time. Recovery now retains the maximum absolute deadline; its regression verifies zero requests at the earlier deadline and all three active reads at the later one.

The native session-change scenario previously used a direct query-client refetch. It now starts with an actual workspace failure, clicks RETRY WORKSPACE, confirms that the fixture received the held read and the query is fetching, switches accounts, then explicitly releases the old response. It asserts no restored private rooms, old feedback or old-account profile/cache state.

The historical hosted cleanup outcomes remain valid for the confirmed responses, but the temporary harness cannot support a general claim about ambiguous writes or interruption. Its source is no longer available. A tracked [private cleanup journal and adapter protocol](./LIVE_FIXTURE_CLEANUP.md) now persists uncertainty before transmission, reconciles lost message/registration responses without relying on a returned token, and saves deletion progress incrementally. Three local failure-injection tests cover these cases. Future hosted harnesses must integrate and verify the service adapters before creating fixtures; no new hosted replay was performed.

Deferred Minor findings: later unavailable heap samples lack a reason if the initial sample succeeded; post-switch history verifies row count while unique IDs are checked before switching; a rejected recovery-runner close can prevent report persistence. These limit evidence and failure diagnostics; they do not change successful-run results. Production memory budgets, global automatic workspace request cooldown coordination and operational/backend gates remain separate follow-ups.

Historical `/tmp` reports and private harnesses from 2026-10-16 are no longer retained in the resumed environment. The checked-in records preserve the observations; those paths are historical references, not fresh reruns or durable downloadable artifacts.

Final verification on 2026-10-17: `npm run check` passes format, lint, TypeScript, **211 tests in 38 files**, and build. Current local assets are `index-Co9oDiiM.js` and `index-_lAJKJ8Y.css`; JavaScript SHA-256 `9d41a569403a4a6d76e97bd062205b3d01b66bce948dbbde0c311d1678ca3b14`. The corrected `npm run acceptance:recovery` passes **7/7**, evidence `/tmp/gogo-recovery-Xyl9tT/report.json`. A prior native retry assertion incorrectly expected an error button to stay mounted while its error was cleared during refetch; it was replaced with the real query fetching state, without weakening the request-receipt or account-isolation assertions. No product code changed after the final full check. History, hosted Search, contract and scroll observations above retain their original dates and were not needlessly repeated.
