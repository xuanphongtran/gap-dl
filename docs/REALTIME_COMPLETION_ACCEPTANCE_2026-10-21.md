# Phase 5 realtime completion acceptance — 2026-10-21

The Phase 5 frontend implementation and independent-review fixes are complete on `feat/realtime-completion`. Native synthetic acceptance passed again on 2026-10-21. The 2026-10-20 real-BE native journeys passed; a post-review real-BE rerun remains pending because the private reusable registry/journals are no longer available after session continuation. Further Phase 4 work remains pending. Selected-host deployment, real attachment-provider acceptance, AsyncAPI publication drift and distributed/SSE behavior remain separate gates.

## Verified scope

| Gate | Evidence |
| --- | --- |
| Local activity wire contract | [17/17 checks](./evidence/realtime-activity-contract-2026-10-20.json): authorization, initial/duplicate-join snapshots, first/last-tab presence, typing start/rate/refresh/null stop/expiry |
| Native synthetic transport | [8/8 scenarios](./evidence/realtime-native-2026-10-21.json), 2026-10-21 actual Chrome and ws upgrades, zero escaped navigations/privacy violations, process cleanup complete |
| Native local BE | [7/7 journey groups](./evidence/realtime-local-native-2026-10-20.json), 2026-10-20 two accounts/multiple tabs, guest cleanup confirmed; post-review rerun pending private registry |
| Regression acceptance | Post-fix 2026-10-21: `acceptance:recovery` 7/7; `acceptance:attachments` 7/7, synthetic only |
| Repository checks | PASS on 2026-10-21: formatting, ESLint, TypeScript, 335/335 tests in 55 files, production build |

Synthetic scenarios cover retained older-page edits/tombstones without reconnect and draft loss, first/last-tab online aggregation, typing refresh/blur/5000ms expiry without member/history storms, current-socket snapshot acknowledgement, late HTTP/account boundaries, rate-limit/reconnect/offline recovery, same-batch revocation real window minimize/restore with observed hidden/visible states and remote typing stop, and 390px keyboard/layout. A real HTTP proxy rejects external destinations before new targets can issue requests. CONNECT accepts only exact frontend/API hosts and parses the subsequent upgrade; it forwards the real upstream response, original Origin and key, including actual authorization rejection. CDP additionally checks requests, frames, sockets and future web targets. Chrome's internal browser UI targets are excluded from web-navigation reporting.

Local journeys cover public nonmember denial/join, private invitation/acceptance, online aggregation across tabs, native typing refresh/idle/blur and a real unrefreshed server-expiry observation, edit/delete of a retained older-page message, foreground duplicate join/offline recovery, removal/reinvitation, public leave and private logout. Forty-one journaled filler messages keep the lifecycle target outside the newest page. Cleanup is paced at 650ms to respect the local write limiter. The cumulative reusable journal reports 166 confirmed entries, zero unconfirmed and zero cleanup errors across protocol/acceptance reruns; this is not a count of new resources in one run. Guest account deletions are confirmed with 204. No retained owner/room is classified as cleaned.

## Contract and environment

- BE: `http://127.0.0.1:8080`, source `e8f704179367cb80c72f9571fb477df725c4f42e`.
- AsyncAPI SHA-256: `f9d402402bdacad3ff032110c587fb6b678d2dd36f49f034cc171adbb5494626`.
- Swagger SHA-256: `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de` (32 paths/42 operations).
- Presence/typing follows written BE spec 07 and observed local wire behavior; AsyncAPI still omits activity/read-state events and typing commands. Lifecycle DTOs are published.
- Native local browser origin is the BE-allowed `http://localhost:3000`; only frontend assets are remapped to a temporary Vite instance. Unrelated applications on ports 3000/5173 remain running. API/WS Origin/auth checks stay upstream. Chrome loopback/local-network permissions are granted only to the test context/origin, without global web-security disabling.
- Retained by explicit approval: owner 3, public room 1, private room 2. Credentials and journals remain private outside git; the same registry is reused. No Render calls, deployment, backend restart, migration, direct DB writes, push or merge occurred.

The frontend retains one VueUse socket per authenticated tab and REST as the durable authority. Lifecycle events expose only ID/revision hints; activity never enters Pinia or message DTOs. Snapshot confirmation belongs to the actual socket/account/room epoch. HTTP repairs are validated before caching, bounded by 2000ms/Retry-After, and rejected after an intervening activity transition. If an intervening activity event invalidates a repair response, a replacement read runs after the throttle/Retry-After deadline without reconnecting. Every `not_joined` clears confirmation immediately; only the guarded rejoin transmission is throttled. Journaled message cleanup uses the verified retained room owner, so deleting its guest author cannot prevent a cleanup retry. Starts require fresh editable input, preserve the 2000ms floor across rooms on one connection, stop after 1500ms idle and expire within 5000ms. Search, visibility, pending-send, reconnect and access-loss boundaries stop or clear activity without replaying old commands.

## Visual inspection and reproduction

[390px typing screenshot](./evidence/realtime-mobile-typing-2026-10-21.png) was visually inspected: readable typing text, pixel controls, visible composer, no document horizontal overflow. Native Enter sends; modified Enter retains the draft. Mounted component tests cover IME composition, programmatic restoration, escaped/member-filtered names, singular/plural labels and polite atomic status semantics. This is a bounded accessibility smoke.

```sh
npm run check
npm run acceptance:realtime
npm run acceptance:recovery
npm run acceptance:attachments
REALTIME_FIXTURE_DIR=/absolute/private/reusable-directory npm run acceptance:realtime:local
```

The local runner requires the existing approved registry and matching loopback API origin; it does not select Render or invent another retained owner. Reports are written privately even after scenario or cleanup failures, and unsuccessful cleanup exits nonzero. Synthetic runners never use real account credentials.

## Remaining gates

- Restore the existing private reusable registry/journals and rerun real-BE acceptance on the post-review build, including actual hidden-window behavior. [The failed preflight](./evidence/realtime-local-retest-2026-10-21.json) made zero fixture mutations: health is 200, source/AsyncAPI hash are unchanged, and no duplicate retained owner/rooms were created. Earlier real-BE acceptance remains dated 2026-10-20; it is not a fresh post-review pass.
- Deploy this completion build and accept it on the selected host; older hosted acceptance covers the earlier bundle.
- Publish the observed presence/typing/read-state contract in AsyncAPI.
- Verify cross-node delivery/presence, operational drain/rollout and SSE against their own contracts. Local process success establishes none of those guarantees.
- Keep Phase 4 follow-up and real attachment-storage/provider acceptance pending as instructed.

## Independent review and final checks

One fresh read-only whole-branch review inspected `2fbacd0..7d4e462`. No Critical finding. Three Important findings were reproduced RED→GREEN and fixed in one pass: repeated `not_joined` acknowledgement during cooldown; message cleanup after guest deletion; and stale HTTP repair that never replaces itself. Native hide/restore coverage was regraded Important and added using actual Chrome window state, with observed document visibility and remote stop, no hidden timer starts, fresh acknowledgement and fresh input after restore.

Regression coverage also verifies queued repairs cannot borrow another room/account, Retry-After remains absolute, stale data stays rejected and no old typing command is replayed. Final full check passes 335/335 in 55 files with a production build; post-fix synthetic native acceptance passes 8/8 with complete cleanup. No second review was dispatched. No Minor findings remain deferred; the visibility item was addressed in the single fix pass.

The plan's final execution ledger records every scope ruling and its cost. The post-review real-BE rerun is the outstanding local gate, not an application error or a reason to recreate retained resources without their registry.
