# Mentions and inbox acceptance — 2026-10-15

**Later recheck (2026-10-15, 07:49–07:54 UTC):** [Fresh backend evidence](./BACKEND_RECHECK_2026-10-15.md) confirms CORS header allowance, direct Chrome send/retry, private re-invitation, and response-header exposure. These fixes supersede the earlier blocker descriptions below; attachments, legacy cleanup and final deployment remain open.


Status: implemented on `feat/mentions-inbox`, independently reviewed and locally accepted against the deployed API through an explicit temporary same-origin proxy. **Release remains blocked by backend CORS.** No merge, push, or deployment was performed by this run.

## Implementation and verification

Typed numeric recipients, immutable explicit-retry identity, metadata-only paginated inbox, explicit read actions, and account/room preferences are implemented. Pending mention intent survives route changes within the current tab and account; logout and room revocation purge it. Plain `@name` remains ordinary text. Notification rows require current membership and fresh authorization after reconnect.

`npm run check` passes formatting, lint, TypeScript, 191 tests across 33 files, and production build on Node 22.23.1. `git diff --check` passes. `npm run contract:check` passes 29 required routes: deployed API version 1.0, 31 paths, 41 operations, SHA-256 `a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de`.

One independent final review identified six Important findings and one Minor finding, regraded Important because room cooldown isolation is required. All seven were fixed with failing regressions first: uncertain retry identity after later rejected attempts, pending identity across Settings navigation, fresh preference remounts, stale save callbacks, inactive-room revocation, polling keyboard focus, and per-room cooldown isolation. No Minor finding remains deferred.

Native acceptance additionally exposed inbox height/scroll behavior, WebSocket reconciliation cancelling preference reads and initial history, and filter changes cancelling a shared membership read. Layout was corrected and rechecked in Chrome; the query races have RED→GREEN regressions. Final focused membership tests pass 12/12 and realtime tests pass 20/20.

## Native browser evidence

Chrome 155.0.8059.39 used two isolated browser contexts, a retained authorized owner and a newly registered disposable guest, against the real backend. The temporary Vite proxy at `http://localhost:3000` forwards `/api` to `https://gogo-dl.onrender.com`; repository transport/configuration was not changed for acceptance. This proves local functional behavior through the proxy, not direct cross-origin or deployed-host readiness.

The main report is `/tmp/gogo-inbox-acceptance-pz2er5/report.json`: 14 functional checks passed, plus one expected-negative direct CORS probe; no application exceptions. Checks cover login isolation, Search draft/selection retention, native Enter typed mention and observed eventual delivery, explicit read/filter, pagination beyond 20 rows, native scroll and keyboard focus across polling, account false/true preferences, ordinary-member room mute true/false, accepted-201 response loss followed by a same-key canonical retry without duplication, deleted references, offline/reconnect authorization, mobile 390×844 without horizontal overflow, revocation, and public leave/rejoin generation isolation. Delivery was observed during this run; no latency or distributed guarantee is inferred.

A separate native Enter probe passed plain `@literal-name` with exactly the `content` field and no Idempotency-Key: `/tmp/gogo-inbox-acceptance-8hVG7a/report.json`. Its message 277 was deleted with 200. Earlier failed harness attempts are not counted as acceptance passes.

Desktop and mobile screenshots were inspected: `/tmp/gogo-inbox-acceptance-pz2er5/desktop.png` and `mobile.png`. Raw browser artifacts remain private temporary evidence; no credentials or tokens are committed.

## Fixture cleanup

Main-run private messages 252–274 and public messages 275–276 were deleted with 200. Initial 502 deletions for 253, 254 and 257 were recovered with 200 and appended to the report. Guest 46 was deleted with 204 and the owner's temporary public membership was removed with 204. The retained owner/private room remain intentional fixtures.

Interrupted-run guests 39–45 were deleted with 204; created messages 207–251 were deleted with 200. Runs that failed owner login before registration created no guest. The earlier unsuccessful plain-text probe found no matching created message during recovery. Legacy accounts 35/36 from the previous contract work remain unconfirmed and require authorized backend/admin cleanup; this run does not claim otherwise.

## Release gates and scope

Direct preflight for both `http://localhost:3000` and `https://chat-sb.xuanphong.io.vn` allows the origin but returns `Access-Control-Allow-Headers: Origin,Content-Type,Authorization`, omitting `Idempotency-Key`. Chrome reports `HeaderDisallowedByPreflightResponse` / `TypeError`. Evidence: `/tmp/gogo-cors-idempotency.txt` and `/tmp/gogo-cors-sandbox-idempotency.txt` (sandbox-origin probe at 2026-10-15T03:12:48Z).

The backend must allow **Idempotency-Key** for the frontend origins, then direct two-account browser acceptance must be rerun before release. Do not remove retry identity to bypass this gate. Final hosting and deployment remain unaccepted. Keep the existing text-only deployment until the gate closes; no backend changes are included here.

Attachment scanner/provider readiness and private-room re-invitation remain separate gates from prior evidence, not reaccepted here. Reload/cross-tab exactly-once, external channels, message previews, arbitrary historical jumps and notification WebSocket events remain outside scope.
