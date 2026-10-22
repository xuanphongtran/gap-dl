# Phase 4 local acceptance — 2026-10-22

The user resumed Phase 4 after committing the attachment acceptance as `1332e80`. The existing read-state/unread implementation passes ten fresh live groups on `http://127.0.0.1:8080`, including native Vue browser journeys. No product behavior change was required. Work continues on `test/phase-four-read-state`; [sanitized evidence](./evidence/read-state-local-2026-10-22.json) records results, request IDs and cleanup.

## Verified behavior

| Group | Observed result |
| --- | --- |
| Authoritative unread | Own sends do not increase unread; two incoming messages add two. Editing and tombstoning preserve that count. Reading history alone leaves cursor0. |
| Cursor validation and convergence | Zero/negative PUT400; a different room's message404. Concurrent higher/lower cursor PUTs converge on the higher cursor; duplicate/stale retries do not regress it. |
| Private event fanout | Two raw WebSocket connections for the same user receive the changed `read_state`; a different current member receives none during the bounded observation. A no-op PUT emits no additional event. |
| Membership generation | Public leave denies GET/PUT403; rejoin starts at0. Private removal conceals GET/PUT with404; fresh invitation/acceptance starts at0. |
| Native room list | The badge matches authoritative unread while cursor remains0; listing rooms does not acknowledge the conversation. |
| Native visibility | An actually minimized/hidden Chrome window does not advance the cursor after an incoming message. Restoring focus and viewing the row advances it. |
| Native second tab and reload | A second context for the same account obtains the durable cursor on foreground; reload preserves it. |
| Native failed write/retry | One intercepted PUT503 leaves the backend cursor unchanged and shows read-save failure. The actual RETRY READ STATE control persists the cursor and clears the error. |
| Native room switching and revocation | Public/private/public/private navigation settles the current room; private removal clears the composer and read access returns404. |
| Native logout | Session removal clears unread badges/private conversation UI and returns to login. |

The injected503 is controlled acceptance evidence, not a naturally occurring backend outage. The raw WebSocket observer checks account-scoped delivery; browser convergence is observed through authoritative REST responses. It does not claim the frontend directly consumes the unpublished `read_state` wire schema. Event publication drift remains in the backend handoff.

## Browser and test boundaries

The real Vue application runs through an asset-only remap for `http://localhost:3000` to a private Vite instance. API requests preserve normal CORS and the local WebSocket handshake. A fail-closed loopback proxy restricts frontend/API/WebSocket destinations; external HTTPS remains blocked. Browser local-network permissions are scoped to the test origin/context. No global web-security or TLS-validation bypass is used.

The two native contexts share only the fixture account; session storage and browser contexts are independent. New read-state writes are privately journaled before dispatch. The failed-write assertion inspects the backend cursor before the explicit retry. Native rapid navigation does not claim deliberately inverted responses: the existing mounted Vue Query/Axios tests provide deterministic cancellation, delayed-response, overlapping-write and account/query replacement coverage.

The focused command `npm test -- src/features/messages/read-state.test.ts src/features/messages/useViewedReadState.test.ts src/features/rooms/useWorkspaceRealtime.test.ts` passes 40 tests in 3 files, including the existing eight race regressions. The first disposable harness run reached retry but used the wrong button selector (`RETRY`); correcting it to the existing `RETRY READ STATE` yields the final ten-group pass. No UI/source fix was needed.

## Cleanup and scope

Reuse the approved retained owner9 and public/private rooms3/4. No owner or room was created. Both runs explicitly tombstoned journaled messages and deleted their disposable accounts with204. The final cumulative fixture journal has130 confirmed/0 unresolved entries; the dedicated REST read-state journal has22 confirmed/0 unresolved. Eight native write intents across the two runs are resolved by confirmed deletion of the disposable accounts and their membership-scoped read states. Counts include earlier fixture work and are not new account counts.

Private journals/recovery evidence remain under the ignored, permission-restricted `.realtime-fixtures.local/phase4-2026-10-22/` directory. The diagnostic script is archived with a `.private` suffix to avoid entering repository-wide lint. Original owner3/rooms1/2, legacy account cleanup and uncertain Render registrations remain separate unresolved records. No Render API calls, backend changes/restarts, direct database writes, push or deployment occurred.

Phase 4 is locally accepted again. Selected-host functional acceptance remains pending under the user's local-only instruction; distributed delivery and operational guarantees retain Phase 7 gates. Attachment edge cases/physical cleanup remain Phase 6 follow-ups.

## Repository verification

The full `npm run check` passes after this acceptance: formatting, lint, typecheck,335 tests in55 files, and production build. `git diff --check` also passes. Product source and the committed test harnesses are unchanged.
