# Room Search acceptance — 2026-10-14

Branch: `feat/message-search`, served locally at the backend-allowed origin `http://localhost:3000` in native headless Chrome. Backend: `https://gogo-dl.onrender.com`, Swagger 2.0/API 1.0, rechecked SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`. The changed frontend is not deployed to sandbox or production.

## Browser evidence

Eleven checks passed with no failures or browser exceptions on the final full run. The first two establish accounts/fixtures; the remaining nine exercise the feature:

1. Two accounts log in and the invited member receives private access.
2. Prepare 46 searchable messages spanning beyond the newest 40.
3. Find a message outside loaded history with labelled focused Search.
4. Search paginates 20, 40 and 46 distinct descending matches.
5. Invalid UTF-8 query keeps existing results and gives accessible feedback.
6. Remote browser edit removes the old match and exposes updated text.
7. Remote deletion removes matching Search content.
8. Escape restores draft, scroll and header focus.
9. Offline Search hides private results and reconnect preserves draft and query.
10. Desktop and mobile Search layout retain accessible controls.
11. Membership removal while Search is open clears private UI.

Forty-six unique messages were prepared before opening the conversation. Search found the oldest anchor absent from the loaded newest 40; the three Search pages contained 20, 40 and 46 distinct messages in descending ID order. An over-256-byte query left valid results in place and set field validation. Editing and deleting from the second browser removed the old match, and a new term exposed the edited message. Search rows did not enter conversation read acknowledgement controls.

Escape restored the original composer draft, scroll position 123 and the header button's focus. Offline recovery hid private Search rows; reconnect fetched current Search state while keeping the submitted query and draft. Desktop and 390 × 844 mobile screenshots show reachable controls and no document horizontal overflow. Membership removal while the guest searched returned the guest to the room list and removed private Search text.

## Investigation and timing limits

An initial harness run stopped on an escaped-selector error; all 46 messages and its guest were cleaned up. After correcting the selector, an earlier run passed history/pagination/validation but timed out waiting nine seconds for remote-edit freshness, showing Searching rather than old content. A one-result probe, a 21-result paginated/query-change probe and controlled automated foreground/cancellation tests passed. The final full run used an 18-second freshness wait and passed. This establishes eventual convergence on the sampled deployment, not a latency guarantee or proof that a nine-second window always suffices. Five-second polling remains enabled because remote lifecycle events are incomplete.

Temporary diagnostics collected only epoch/fetch/visibility booleans and were removed from product code. No telemetry, tokens, query text or real message bodies were added to logs. Raw fixture reports/screenshots are local and excluded from Git.

## Automated checks and fixtures

Final `npm run check`: 137 tests in 23 files, plus format, lint, typecheck and production build. `git diff --check` passes. The new suites exercise API/cursor bounds, revisions and erased authors, account/room/query isolation, removed cache identities, cancellation, foreground/recovery, read-state suppression, draft/editor/scroll preservation, semantic fields and pagination/error states.

The final run deleted all 47 test messages (46 seeded plus one missed while offline) and deleted the disposable guest account with 204. Earlier diagnostic guests/messages were also cleaned up. Existing owner and private room 6 remain; credentials are in the restricted Git-ignored fixture directory. The backend has no room-delete endpoint. The known private-room re-invitation blocker remains unchanged; a removed guest was never re-invited.

Final full-run artifacts: `/tmp/gogo-search-acceptance-poNMKm/report.json`, `desktop-search.png`, `mobile-search.png`. Small probes: `/tmp/gogo-search-acceptance-pBMOt0` and `/tmp/gogo-search-acceptance-QlnZQt`. These are local observations, not release-host/multi-node acceptance.

## Remaining gates

Deployment and final-host browser acceptance, distributed recovery/presence/typing, attachments/inbox and backend re-invitation remain separate work. Search does not provide global search, highlighted HTML, total counts, result edit/delete controls or arbitrary history jumps.


## Independent review and fix verification

The independent final review identified two Important findings and no Critical or Minor findings. Both were reproduced with failing tests and fixed:

- Search polling now preserves the same submitted query's reading position while private rows are hidden during refresh, then restores scroll after the fresh DOM is rendered. A new query resets scroll to zero. The native Chrome mocked-HTTP probe reported before/after scroll 1000, zero visible rows during refetch, 20 fresh rows afterward, and new-query scroll zero. Evidence: `/tmp/gogo-search-scroll-FyF3UM/report.json`.
- All automatic Search requests honor cooldown. Polling and invalidation are disabled during `Retry-After`; a defensive query-function guard also blocks a request before observer options update. A 60-second mocked cooldown stays at one request after five seconds and invalidation, then resumes successfully after expiry.

`npm run search:scroll:check` reproduces the native layout check without calling the backend or loading real credentials. It requires installed dev dependencies and Chrome (`CHROME_PATH` overrides the default Linux binary). This opt-in check is separate from deterministic CI.

An additional live owner-browser keyboard check passed native Enter form submission, Escape closing/focus return, and Enter reopening the focused header control. Evidence: `/tmp/gogo-search-acceptance-y5J7vY/report.json`. Its single test message was deleted with 200; no new account was registered. Earlier keyboard harness attempts were corrected for readiness and CDP Enter text; their individual test messages were also deleted.
