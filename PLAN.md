# Delivery plan

Updated 2026-10-22. Frontend changes through `b787af6` are included in develop PR17 (`b58254e`). Local acceptance is not hosted/production acceptance.

## Completed frontend work

| Phase                                        | Status                                                              | Evidence                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 0–2: foundation, API reliability, membership | Implemented                                                         | Current source and repository checks                                              |
| 3: message lifecycle                         | Implemented; earlier hosted smoke                                   | [Acceptance](docs/ACCEPTANCE.md)                                                  |
| 4: durable read state/unread                 | Locally accepted; 10 live groups                                     | [Read-state evidence](docs/evidence/read-state-local-2026-10-22.json)             |
| 5: WebSocket, lifecycle, presence/typing     | Locally accepted; 17 latest contract checks                          | [Phase 5–7 evidence](docs/evidence/phase-five-seven-local-2026-10-22.json)        |
| 6: Search, Mentions/Inbox, attachments       | Implemented; core product/provider and edge checks accepted locally | [Attachment evidence](docs/evidence/attachments-local-acceptance-2026-10-22.json) |
| 7: recovery and acceptance tooling           | Frontend work implemented/reviewed; operational gates remain open   | [Phase 5–7 evidence](docs/evidence/phase-five-seven-local-2026-10-22.json)        |

## Phase 8: release candidate stability — proposed

1. Enforce exclusive ownership of live fixture runs.
2. Diagnose the recorded history-pagination timeout and add a regression for the established cause.
3. Smoke the exact production build against local :8080 on desktop/mobile, including privacy and attachments.
4. Complete the [release checklist](docs/RELEASE.md), retaining failed attempts and cleanup outcomes.

This is proposed scope; implementation design/plan approval is still pending. See P01–P03 in [PENDING.md](docs/PENDING.md).

## Release status

Release documentation is prepared. The candidate has not been tagged, published or fully accepted on the target host. [PENDING.md](docs/PENDING.md) owns all open items, their evidence and closure criteria. Broker/cross-node remains pending by explicit user instruction.

Completed implementation plans and intermediate reports were removed during documentation consolidation. Their exact history remains in Git through `0a0cb6a`; retained JSON evidence is indexed in [ACCEPTANCE.md](docs/ACCEPTANCE.md).
