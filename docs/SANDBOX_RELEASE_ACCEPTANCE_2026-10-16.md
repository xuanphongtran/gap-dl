# Sandbox release acceptance — 2026-10-16

Target: `https://chat-sb.xuanphong.io.vn`, using the deployed API directly at `https://gogo-dl.onrender.com`, without a proxy. The user published the Mentions build during this session; this run performed no push, merge or deployment. Deployment Protection was temporarily disabled by the user for acceptance.

## Build and deterministic verification

The hosted JavaScript is byte-identical to the local production build: `index-P4Ch8try.js`, SHA-256 `eb8b39ad90dd003072ec9a75c4965fcc5d641ae6f1464ed1f38018925cb1b25d`; stylesheet `index-_lAJKJ8Y.css`. The initial hosted version lacked Inbox/recipient selection; it was rechecked after the user's release before feature acceptance.

A fresh `npm run check` passes formatting, lint, TypeScript, 191 tests in 33 files, and production build on Node 22.23.1. Log: `/tmp/gogo-check-20261016.log`. `npm run contract:check` passes 29 required operations; API 1.0, 31 paths, 41 operations, unchanged Swagger SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`.

## Hosted native browser journeys

Chrome used three isolated browser contexts: retained owner, disposable recipient, and a second recipient tab logged into the same account. Real REST requests and native authenticated WebSockets reached the backend from the sandbox origin. The main run records 16 passed functional checks:

1. Owner and both recipient tabs log in and establish native authenticated WebSockets.
2. Opening/closing Search preserves draft and typed recipient selection.
3. Native Enter sends a typed mention; the room tab receives the message and the recipient inbox observes delivery.
4. Explicit MARK READ and ALL/UNREAD roundtrip work.
5. Chrome drops an accepted 201 response. Explicit retry preserves the exact payload/key and yields one canonical message.
6. An offline recipient tab recovers a missed message after reconnect and preserves its draft. After foregrounding and scrolling the message into view, REST read state advances to its ID.
7. Plain `@literal-name` sends only `content`, without mention IDs or an Idempotency-Key.
8. Account mention preferences save false and restore true through the UI.
9. An ordinary member saves room mute true and false through the UI.
10. The inbox loads 20 rows, then LOAD MORE reaches all 24 observed notifications.
11. Native list scrollTop 500 and the focused row action survive polling.
12. Message deletion produces a metadata-only deleted reference without exposing message text.
13. Mobile 390×844 has no document horizontal overflow.
14. Membership removal clears inbox rows and removes private room content in the other tab.
15. Private re-invitation restores membership with no old inbox rows; a fresh mention then reaches the new membership.
16. Public leave/rejoin hides old-generation rows; replaying the old key retains canonical identity and creates no new-generation row during the observation window, while a fresh key delivers.

Main evidence: `/tmp/gogo-release-20261016-KaZgrr/report.json`. Browser exceptions: zero. Desktop/mobile screenshots in the same directory were visually inspected. Delivery and retry results are observations from this run, not latency, cross-tab exactly-once or distributed guarantees.

## Harness findings and logout verification

An initial attempt stopped while waiting for read acknowledgement. The screenshot showed the message outside the viewport, and the tab had not been explicitly foregrounded. The product intentionally acknowledges only focused, visible messages. The corrected harness foregrounded the tab, scrolled to the message, and passed without frontend changes. Initial messages 280–282 and guest 48 were cleaned (200/204).

The main run's final aggregate socket-close assertion timed out after all three tabs reached `/login`: historical counters were 2/2, 6/5 and 3/3 created/closed across multiple full document navigations. It is recorded as an incomplete assertion, not an all-green main run or a confirmed leaked socket. A separate focused probe checks the active connection identity at logout, observes its close event, waits for no reconnect, and inspects current-document WebSocket ready states. The strengthened probe explicitly confirms an authenticated active socket is open immediately before each logout. Both active socket close events arrive, no reconnect occurs during the three-second observation, and both current documents contain no WebSocket instances. Evidence: `/tmp/gogo-logout-20261016-oxS24N/report.json` (two checks pass, no exceptions, no fixture writes). The earlier exploratory logout probe also passed; this strengthened run is the acceptance evidence.

## Cleanup

All 28 main-run messages were deleted with 200: private room 6 messages 283–308 and public room 2 messages 309/310. Guest 49 was deleted with 204. The owner's temporary public membership was removed with 204. The retained owner/private room remain intentional fixtures. Private credentials were saved before writes; no tokens, retry keys or credentials are committed. Earlier legacy accounts 35/36 remain a separate unconfirmed admin-cleanup gate.

## Backend recheck and remaining gates

Fresh 2026-10-16 evidence: `/tmp/gogo-continue-20261016-MpRPmx/report.json`. Both allowed origins still receive OPTIONS 204 with Idempotency-Key allowed; authenticated WebSocket upgrade returns 101 and realtime readiness is 200/ready:true. Response CORS exposes Retry-After and X-Request-Id. Attachment reservation still returns 503 (`attachment uploads unavailable`), creating no reservation or upload. Notification `before=0` still returns 200 despite the documented positive minimum.

Attachments, legacy admin cleanup, actual 429/Retry-After behavior, prior transient 502 root cause, warm-up/rolling deployment, traffic/memory measurements, and distributed delivery remain open. Presence/typing, SSE, replay and cross-node guarantees are outside this acceptance. This closes only the sampled WebSocket/Mentions journeys on the named sandbox host; another production origin needs its own deployment verification.

Rollback: if a release regression appears, redeploy the previously accepted text-chat deployment through the hosting workflow; keep attachment UI disabled while provider/scanner gates remain open. No rollback or hosting change was performed by this run.
