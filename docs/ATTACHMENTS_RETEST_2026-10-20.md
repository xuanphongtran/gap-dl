# Attachment test rerun — 2026-10-20

The user requested a fresh rerun after clarification of the readiness 503. Tests ran against source `bc4f59b` on branch `feat/attachments` (checkout head `4edb701`; intervening changes are documentation). [Sanitized evidence](./evidence/attachments-retest-2026-10-20.json) records the results.

## Local and native results

| Command | Fresh result |
| --- | --- |
| `npm run check` | PASS: formatting, lint, types, 270 tests in 49 files, production build |
| `npm run acceptance:attachments` | PASS: all seven native Chrome synthetic scenarios, complete cleanup, zero provider privacy violations and zero escaped navigations |
| `npm run contract:check` | PASS: 34 required operations; Swagger has 32 paths/42 operations, hash unchanged |

Native cases: accepted-send response loss and explicit retry across room navigation; processing blocks Enter; create-only PUT 412 reconciliation without replay; late reservation after room change; account change; download completion/bytes and binding denial with room/draft retained; 390px mobile keyboard/focus and Search. This exercises the current frontend against synthetic REST/storage, not the deployed attachment endpoints.

## Deployed requests actually attempted

API origin: `https://gogo-dl.onrender.com`. Times below are UTC; add seven hours for local time.

| Request | Time | Result | Request ID |
| --- | --- | --- | --- |
| `GET /health` | 08:43:07Z | 200, status ok | `4ccf81507a2e5570845e63dd7f669cc2` |
| `GET /readyz` | 08:43:08Z | 503, `ready:false` | `a1e6313dee27438282cf16d30d6872c1` |
| `GET /swagger/doc.json` | 08:43:08Z | 200, unchanged contract | `b27971f2b5dfac5d372e8ba813a33b06` |
| `POST /api/v1/auth/login`, first retained registration credentials | 08:43:58Z | 401, unauthorized | `565455967b73ac11e7b0e1ce17c302ee` |
| `POST /api/v1/auth/login`, second retained registration credentials | 08:43:59Z | 401, unauthorized | `f32767309e2d4f6561a61029dbd7b1e4` |

`/readyz` is an operational HTTP probe, not an application page. Its failure alone does not demonstrate that upload, binding or download returns 503. Login was tested directly through HTTP with the two journaled credentials; this was not a browser `/login` acceptance. No authenticated session was obtained. A 401 does not prove that either uncertain registration is absent or cleaned up, particularly while readiness fails.

No new registration, upload, membership, message or account deletion was attempted. The two original private recovery directories remain intact. The earlier registration 500 is historical and was not repeated in this rerun. There is no fresh observed 503 from an attachment endpoint.

## Remaining acceptance

Restore service readiness and resolve the two journaled registration outcomes using working credentials or BE/admin evidence. Then run the authorized upload → processing → caption/files/mentions → recipient history/Search → download flow with real storage, including browser CORS, same-key identity, denied bindings and fixture cleanup. Actual attachment/runtime and selected-host release gates in the [acceptance record](./ATTACHMENTS_ACCEPTANCE_2026-10-20.md#live-service-and-release-gates) remain open. No source fix, push or deployment was performed in this rerun.
