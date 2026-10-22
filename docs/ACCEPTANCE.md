# Acceptance evidence

Local target: `http://127.0.0.1:8080`. Latest frontend implementation baseline: `b787af6`, integrated into develop at `b58254e`. Local, synthetic and hosted results have different scopes; pending gates are listed only in [PENDING.md](PENDING.md).

## Retained results

| Date       | Scope                              | Result                                                                               | Evidence                                                             |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 2026-10-22 | Phase4 real API/wire/native UI     | 10 groups;40 focused tests; cleanup confirmed                                        | [Read state](evidence/read-state-local-2026-10-22.json)              |
| 2026-10-21 | Phase 5 local native UI            | 7 groups, including actual hide/restore                                              | [Native local](evidence/realtime-local-retest-2026-10-21.json)       |
| 2026-10-21 | Phase 5 synthetic native           | 8 scenarios                                                                          | [Synthetic native](evidence/realtime-native-2026-10-21.json)         |
| 2026-10-22 | Phase 5 current runtime            | 17 activity-contract checks                                                          | [Phase 5–7](evidence/phase-five-seven-local-2026-10-22.json)         |
| 2026-10-22 | Attachments real API/R2/product UI | 7 API/provider groups and4 product checks; matching bytes, privacy and mobile        | [Attachments](evidence/attachments-local-acceptance-2026-10-22.json) |
| 2026-10-22 | Attachments edge cases             | Real hash rejection, natural five-minute expiry, navigation cancellation             | [Phase 5–7](evidence/phase-five-seven-local-2026-10-22.json)         |
| 2026-10-22 | Recovery tooling                   | 7 synthetic native scenarios;14 focused regressions independently passed             | [Phase 5–7](evidence/phase-five-seven-local-2026-10-22.json)         |
| 2026-10-22 | History tooling                    | Five initial passes; sixth run timed out at 880 rows; bounded 1,000-row retry passed | [Full attempts](evidence/phase-five-seven-local-2026-10-22.json)     |
| 2026-10-22 | Hosted frontend only               | Route fallback and environment-normalized JS/CSS identity match; no API execution    | [Preflight](evidence/release-preflight-2026-10-22.json)              |

Earlier sandbox Search/Mentions/WebSocket acceptance is historical evidence for its earlier deployed build. The original reports and completed implementation specs/plans remain available in Git at `0a0cb6a`; later local checks do not retrospectively validate a new hosted release.

## Limits and cleanup

- The history matrix is not an uninterrupted 6/6 pass. Heap samples are development-app used heap, not post-GC retained memory or production budgets.
- Controlled 503 and held-provider-request cancellation are explicitly injected scenarios. No real rolling restart, drain or distributed guarantee is inferred.
- Final cumulative local fixture journal: 143 confirmed/0 unresolved; edge journal 7 confirmed/0 unresolved; final native mutation cleanup 0 unresolved. Counts include previous runs. Owner 9/rooms 3/4 remain approved retained fixtures; historical records are separate H01/H02.
- Cancellation 204 and confirmed disposable-account deletion prove logical cleanup scheduling; physical object removal/quota remain B02.
- Initial probe failures are retained in evidence/private diagnostics. One shared-cleanup interference required restarting the expiry observer and serializing subsequent live jobs.
- `docs/evidence/` retains sanitized dated JSON/screenshots. Private credentials, recovery registries and signed tickets remain outside Git.

## Release-preparation check

The documentation-only cleanup passes `npm run check`: formatting, lint, typecheck, 341 tests in 55 files and production build. [Fresh check record](evidence/release-preparation-2026-10-22.json) retains build digests. This is a quality-check build, not a selected/published release artifact; no live/native rerun closes P01–P03.
