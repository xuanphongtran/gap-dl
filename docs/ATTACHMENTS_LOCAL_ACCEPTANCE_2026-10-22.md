# Local attachments acceptance — 2026-10-22

The backend configuration update restores attachment uploads on `http://127.0.0.1:8080`. The final real-API run passes all seven binding/download/privacy groups, with real R2 storage and native Chrome provider checks. [Sanitized evidence](./evidence/attachments-local-acceptance-2026-10-22.json) records the source revisions, request IDs, results and cleanup. Four native product UI checks also pass against the same local backend.

## Target and contract

Frontend source: `5cbc6ff`, on acceptance branch `test/phase-six-live-acceptance`. Backend checkout: `fe6ba4177216905494f9a1358b47cbfed18abaee`. This identifies the inspected source; it is not a cryptographic attestation of the running backend binary. Fresh health/readiness return 200. The local contract check passes all 34 required operations across 32 paths/42 operations; Swagger SHA-256 remains `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de`.

Before the configuration change, `POST /api/v1/rooms/3/attachments/uploads` returned 503 with `attachment uploads unavailable` (request ID `78470bdd367fdcfc48990ee4115fe53e`). Readiness was 200, so readiness alone did not prove attachment admission. The reviewed backend service returns this exact admission-closed error before repository reservation. That definite refusal was reconciled separately; arbitrary 503/storage errors must not be treated as proof that nothing was persisted.

After the update: reservation201 → real provider PUT200 → duplicate create-only PUT412 → complete202 → ready/verified with the original SHA-256 and byte count. Unbound cancellation returns204.

## Real binding and privacy results

| Check | Result |
| --- | --- |
| Public and private caption + file + explicit mention | 201, bound processed attachment metadata |
| Same message key and immutable payload | Canonical original message ID, no duplicate |
| Same key with changed caption | 409 |
| Recipient history and Search | Bound attachment metadata present |
| Recipient and private moderator download | Authorized ticket200, provider200; original bytes/SHA-256 match |
| Public member leaves | New ticket403; owner still receives200 |
| Private moderator removed | New ticket404, concealing resource existence |
| Message tombstoned | New ticket404; history tombstone has no attachment metadata |

Provider responses expose `Content-Type: text/plain`, `Content-Disposition: attachment; filename=phase-six-binding.txt`, and `Cache-Control: private, no-store`. `X-Content-Type-Options` was absent; no `nosniff` guarantee is claimed. Denial concerns newly requested tickets; already-issued short-lived signed links are not claimed instantly revocable.

Native Chrome also performs a real provider PUT from `http://localhost:3000` with ordinary browser CORS and downloads the issued file with a matching SHA-256. A private fail-closed proxy admits only the local acceptance origin and the exact provider host learned from a server-issued HTTPS ticket; page requests are restricted to the issued URL. Normal TLS validation stays enabled. No Authorization/Cookie header is sent to the provider. This minimal-page provider test is separate from exercising the product controls.

## Native product UI

A private Vite instance serves the actual Vue application through a frontend-asset-only remap for `http://localhost:3000`, preserving that browser Origin. The local API and WebSocket handshake are forwarded unchanged; provider requests use real HTTPS/TLS and browser CORS. Only server-issued provider URLs/hosts are admitted. Every attachment/message mutation is privately journaled before forwarding, with actual responses recorded before release to the app.

All four product checks pass:

1. Native file-input selection uploads a harmless TXT file to real R2 and reaches Ready after backend processing.
2. The actual composer sends caption + verified attachment + selected mention, returns201 with a message key, and clears its upload row.
3. A real mouse click on the product Download control saves exactly the original bytes.
4. The attachment conversation has no horizontal overflow at390px. A private screenshot is retained; this is a bounded layout smoke, not a full accessibility audit.

The first product run passed selection/send but did not download when the diagnostic harness used a scripted click. The same flow passes with native Chrome mouse input; no product change was needed. The final run reports no handler errors or provider Authorization/Cookie headers, with0 unresolved native mutations. Account creation/auth were fixture setup, not a login UI acceptance claim.

## Execution and cleanup

The first binding run stopped because the temporary harness expected200 for role change; the API correctly returns204. Two message tombstones were confirmed by the retained owner before reconciling that run's journal. A subsequent run stopped on a provider GET transport failure, after ticket200; cleanup succeeded. The final run corrects the status assertion and permits at most one retry of a safe download GET, with no automatic message/upload replay. All seven groups pass on that final run.

Private diagnostics are archived with `.private` filename suffixes so repository-wide ESLint does not treat generated bundles and disposable scripts as source. Journals retain their original JSON filenames. Private journals are retained under the ignored, permission-restricted `.realtime-fixtures.local/phase6-2026-10-22/` directory. Owner9 and rooms3/4 are intentionally retained. At the end of the API/provider run, the fixture journal has81 confirmed/0 unconfirmed entries and the separate binding journal has10 confirmed/0 unconfirmed; these are cumulative counts, not new fixture counts. After both product UI runs, the fixture journal reaches85 confirmed/0 unconfirmed and the final native mutation journal has0 unresolved entries. Messages were explicitly tombstoned, final-run attachments canceled204, and disposable accounts deleted204. Earlier bound uploads have confirmed logical message cleanup; physical object garbage collection and quota release remain unverified. Original local owner3/rooms1/2 and historical uncertain Render registrations remain separate unresolved records.

No backend source change, restart, migration, direct database write, source push or deployment was performed. Render API calls were avoided. Product source is unchanged. Repository verification results are recorded separately below.

## Remaining gates

The core local product picker/send/download/mobile journey is now accepted. Additional live navigation cancellation and expired/failed-processing cases remain separate; earlier synthetic regressions retain their original dates. Delayed physical object cleanup/quota release needs backend/operator evidence. Selected-host functional acceptance is pending by the user's local-only instruction; [release preflight](./RELEASE_PREFLIGHT_2026-10-22.md) records only earlier read-only route/artifact checks. Phase4 remains pending. Cross-node delivery, graceful drain, warm-up and live operational budgets remain Phase7 gates.

## Repository verification

`npm run check` passes: formatting, lint, typecheck,335 tests in55 files, and production build. The initial attempt picked up private diagnostic scripts/generated bundles in repository-wide ESLint; archiving their filenames with `.private` suffixes removed that temporary artifact interference without changing lint configuration. The subsequent full check exits0. No production or committed harness code was introduced.
