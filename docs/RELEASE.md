# Release preparation

Status: draft/local candidate preparation, 2026-10-22. No release tag, publish or deployment is performed by this preparation. Package version remains 0.1.0; a release version is not assigned here.

## Draft release notes

The client includes room membership/invitations, revision-aware edit/delete, durable unread state, guarded WebSocket recovery, online/typing indicators, room Search, Mentions/Inbox, and verified-file caption sends/downloads. Workspace errors have explicit recovery; uncertain keyed sends preserve their original payload for explicit retry.

Local acceptance covers core privacy/revocation, real provider upload/download, hash rejection, natural expiry and navigation cancellation. Broker/cross-node/SSE and production operational guarantees are excluded. Known history-test timeout and remaining gates are listed once in [PENDING.md](PENDING.md).

## Build and verification

Requires Node 22.18+. Choose a source commit, working API origin and allowed frontend Origin before building.

```bash
npm ci
npm run check
```

For a local-only candidate, explicitly compile the local target:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8080 npm run build
npm run preview -- --host localhost --port 5173 --strictPort
```

Use a free port permitted by backend CORS/WS Origin settings. Production must be rebuilt with its working public HTTPS API; do not publish the local :8080 build for remote users. Preserve the API environment with the artifact record because it changes JavaScript bytes.

Optional local contract check:

```bash
SWAGGER_URL=http://127.0.0.1:8080/swagger/doc.json npm run contract:check
```

Synthetic native checks require Chrome; they do not mutate the live backend:

```bash
npm run acceptance:recovery
npm run acceptance:attachments
npm run acceptance:realtime
npm run acceptance:history
```

Live activity/native commands require the approved private fixture directory. Run one live runner at a time; the current helper can clean all outstanding guests in that registry. Follow [fixture cleanup](LIVE_FIXTURE_CLEANUP.md); do not execute these concurrently or improvise new owned rooms.

## Candidate checklist

- [x] Consolidate current docs, phase status and pending ownership.
- [x] Preserve dated acceptance evidence and limitations.
- [ ] Resolve P01–P03 for the local release candidate.
- [ ] Record chosen source commit, Node version, API origin, build digest and checks for the exact candidate.
- [ ] Complete production-build desktop/mobile, keyboard, two-account, reconnect/revocation and attachment smoke.
- [ ] Confirm disposable fixtures are cleaned; preserve unresolved journals explicitly.

## Hosted rollout checklist

- [ ] Resolve applicable B01–B06 gates or record the owner-approved release scope; retain deferred/admin items.
- [ ] Build with the intended public API and record digests. Configure REST CORS, WebSocket Origin and real provider CORS.
- [ ] Verify SPA fallback for `/login` and `/app/rooms/:id`; `vercel.json` supplies the Vercel rewrite.
- [ ] Deploy through the authorized hosting workflow and repeat affected-flow smoke on the selected host.
- [ ] Record operator, time, version/source/artifact and a previously verified artifact with its API environment for rollback.
- [ ] Publish/tag only after the release decision. If smoke fails, restore that known artifact/configuration, verify core access and retain failure evidence; do not roll back backend data from this frontend runbook.

The baseline before documentation consolidation is341 passing tests and the dated results in [ACCEPTANCE.md](ACCEPTANCE.md). Fresh verification of this documentation preparation is recorded there separately.
