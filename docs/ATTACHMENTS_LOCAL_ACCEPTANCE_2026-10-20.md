# Local backend verification — 2026-10-20

The user reports that their Render account has exhausted its quota and directs further testing to the backend on port 8080. Local configuration now sets `VITE_API_BASE_URL=http://127.0.0.1:8080` in the ignored `.env.local`. Committed production defaults remain unchanged. The [sanitized evidence](./evidence/attachments-local-acceptance-2026-10-20.json) records this target separately from Render.

## Observed results

| Check | Result |
| --- | --- |
| Local `GET /health` | 200, status ok |
| Local `GET /readyz` | 200, ready true |
| Local Swagger | 200; same published attachment contract, SHA-256 `176cf2df1f586bc16c2336241f9b4bd15731ce5a92527effcd6c9351420ad9de` |
| `SWAGGER_URL=http://127.0.0.1:8080/swagger/doc.json npm run contract:check` | PASS: 34 required operations, 32 paths/42 operations |
| Two disposable registrations and profiles | Registration 201/profile 200 for each account |
| Native login/profile/logout | PASS for both accounts with the real local API; four checks including 390px workspace overflow |
| Room discovery | 200, no public rooms available to either new test account |
| Account cleanup | Both disposable accounts deleted with 204; journal confirms 2 cleaned/0 unresolved |

This run changed no product source. The earlier 270-test/full build and seven synthetic attachment scenarios remain dated local frontend evidence; they were not rerun during this target-only configuration change.

## Browser origin and harness boundaries

Backend CORS accepts `http://localhost:3000` and `http://localhost:5173`; tested `127.0.0.1` frontend origins and other localhost ports returned 403. Ports 3000 and 5173 were already used by unrelated applications, which were left running.

The temporary browser harness therefore remapped only frontend asset requests for `http://localhost:5173` to a private Vite instance. API requests went directly to port 8080 with normal browser CORS. The initial arbitrary-origin run failed CORS; the remapped run initially failed Chrome's local-network permission check. The final passing run granted `localNetwork` and `loopbackNetwork` only to that frontend origin in its temporary browser context, without disabling browser security globally. See the [Chrome protocol permission types](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#type-PermissionType). This proves the stated native auth journeys, not ordinary hosted-origin or attachment/provider acceptance. A regular frontend session still needs an allowed origin and available port.

## Attachment test prerequisite

The local database offered no existing public room to these test accounts. No owned room was created: the API provides no room-deletion route, and the approved [plan](./superpowers/plans/2026-10-20-attachments.md) requires "no new owned room without an executable cleanup plan." The user has been asked for a room/account fixture or room cleanup information. The two auth-only accounts have already been deleted; there is no new retained owner or room.

Real upload, processing, caption/files/mention binding, recipient history/Search, R2 browser CORS/downloads and membership/deletion denial remain untested on this target. Continue using local port 8080 after a room fixture or an explicit cleanup/retention strategy is available. Do not infer an attachment 503 from prior Render readiness failures.

The private local journal/harness is retained at `/tmp/gogo-attachments-live-fxIUed/` for audit, with credentials excluded from Git and reports. The two historical Render registration journals and their unresolved cleanup status are unchanged; local cleanup cannot resolve records from that different backend. No backend restart, migration, shared room mutation, source push or deployment was performed.
