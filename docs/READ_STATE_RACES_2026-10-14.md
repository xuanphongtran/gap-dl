# Read-state race verification — 2026-10-14

This closes the deterministic rapid-room-switch and overlapping-write checks in Phase 4 of PLAN.md. The private-room re-invitation acceptance gate remains open because of the recorded backend blocker. The WebSocket branch has not been deployed to the final host.

## Approach

Use the existing `useViewedReadState` composable mounted in Vue with the real Vue Query plugin, shared cache, and Axios transport. Mock HTTP responses, browser focus/visibility/viewport geometry, and timers to control response ordering and the 500 ms acknowledgement debounce. No API or product-flow changes are required.

## Covered journeys

Eight tests in `src/features/messages/useViewedReadState.test.ts` verify:

1. Three rapid room changes before the debounce acknowledge only the final room's visible message ID; earlier room cursors stay unchanged.
2. A room switch aborts the previous room's write; its delayed 403 neither revokes the new room nor displays a stale error.
3. Newly viewed messages wait for an outstanding write and produce one subsequent acknowledgement with the newer cursor.
4. A delayed response from an earlier room visit cannot overwrite read state after returning to the same room.
5. Independent mounted viewers sharing a cache retain the greatest cursor when concurrent responses finish in reverse order. This is a cache race check, not new browser multi-tab acceptance.
6. A pending response cannot recreate private cache after membership loss.
7. An account change isolates the old response from the new user's room-scoped cache.
8. A pending response cannot update a replacement query using the same cache key.

## Regression sensitivity

With generation increment and write cancellation temporarily removed, four of eight tests fail. With monotonic cursor merging temporarily replaced by accepting every response, five of eight fail. Both temporary mutations were restored before the final check; no production source changes are retained. The focused suite passes 8/8 on the restored implementation.

## Validation

Full repository validation: `npm run check` passed, including formatting, lint, typecheck, 93 tests in 19 files, and production build. `git diff --check` passed.

The work is on `test/read-state-race-verification`, based on WebSocket branch commit `37ef351`; neither feature branch is claimed merged or deployed. Only tests and planning/evidence documentation are changed.

This work does not repeat live backend/browser checks or resolve the previously documented backend re-invitation issue. Existing sandbox multi-tab acceptance and local-branch WS evidence remain separately scoped in their reports.
