# Pending work

Single current backlog, updated 2026-10-22. Local frontend implementation is complete through Phase 7; Phase 8 is proposed. A checked local test does not close a deployed/backend gate.

## Release preparation

| ID  | Owner | Item and closure criterion                                                                                                                                                                           |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | FE    | Approve Phase 8 scope/design and enforce exclusive live-fixture ownership. Reject a second runner before writes; interrupted cleanup must retain uncertainty.                                        |
| P02 | FE    | Diagnose one history load timeout at 880/1,000 rows. A bounded retry passed, but cause is unknown. Add a regression for the established cause and pass the final six-run identity-preserving matrix. |
| P03 | FE    | Smoke the exact production build on local :8080, record its source/environment/digest and desktop/mobile/privacy results. Existing native checks use a development app.                                |

## Backend and deployment gates

| ID  | Owner            | Item and closure criterion                                                                                                                                                                                                             |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01 | BE               | Publish observed presence/typing/read-state schemas and typing commands in AsyncAPI. Runtime passes; publication still drifts.                                                                                                         |
| B02 | BE/operator      | Verify physical R2 object deletion, delayed cleanup worker success and released quota for journaled attachment IDs. Cancellation 204/account deletion proves scheduling only. Required before declaring attachment operations accepted. |
| B03 | Operator + FE    | Provide a working selected-host API and rerun affected flows, CORS/WS Origin and direct routes. Current scope is local-only; sandbox points at quota-exhausted Render. Earlier matching asset hashes do not prove runtime.             |
| B04 | BE/operator + FE | Observe real warm-up/readiness loss, rolling restart and graceful drain. Existing injected 503/reconnect tests are simulated evidence.                                                                                                  |
| B05 | Operator         | Measure production traffic/error/latency and long-session memory, then agree budgets. Development-app heap samples are not a production SLA.                                                                                           |
| B06 | BE + FE          | Verify real 429 header exposure/cooldown without a forced shared-service flood. Ordinary response headers and synthetic cooldown already pass.                                                                                          |

## Deferred and historical follow-up

| ID  | Status/owner                                   | Closure criterion                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Pending by user instruction; BE/infrastructure | Broker/two-instance/cross-node delivery, presence/typing, revocation and recovery. Requires shared infrastructure and separate evidence.                                                                    |
| D02 | Deferred product scope                         | SSE, external email/push and attachment-only creation need their own released contracts and scope decision.                                                                                                 |
| H01 | Admin                                          | Reconcile historical Render disposable accounts 35/36 and two uncertain registration 500 outcomes. Verify identity before deletion; login 401 does not prove absence.                                        |
| H02 | Admin                                          | Reconcile original local owner 3/rooms 1/2 after registry loss. Approved retained owner 9/rooms 3/4 must remain intact.                                                                                     |
| H03 | BE follow-up                                   | Historical cleanup 502s later succeeded; root cause unknown. `before=0` returned 200 despite a positive contract minimum. Recheck/document when relevant; neither is a freshly reproduced production defect. |

Private recovery material stays outside Git. Historical registration journals were recorded at `/tmp/gogo-attachments-contract-qfPI80/` and `/tmp/gogo-attachments-contract-tcF6Sy/`; their continued availability has not been reverified. Current reusable journals are under ignored `.realtime-fixtures.local/`. Do not recreate fixtures to compensate for missing cleanup evidence.

P01–P03 gate the proposed local release candidate. A hosted/production release also needs applicable B gates closed or a documented owner-approved scope decision. D01/D02 remain excluded; they cannot be claimed in release notes. H items remain visible admin follow-up, not proof of failed current functionality.
