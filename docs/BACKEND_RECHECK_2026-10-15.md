# Backend recheck — 2026-10-15, 07:49–07:54 UTC

The deployed backend was rechecked after the reported update. No frontend source changes were required. Fresh evidence supersedes the earlier CORS and private re-invitation blockers; final-host deployment acceptance remains separate.

| Item | Fresh observation | Status |
| --- | --- | --- |
| CORS Idempotency-Key | OPTIONS 204 for localhost:3000 and chat-sb origins; allowed headers now include Idempotency-Key | Fixed |
| Direct Chrome mention/retry | Two isolated logins on the local branch, direct HTTPS backend requests without a proxy; native Enter mention reaches recipient inbox. An accepted 201 response is dropped at Chrome's response stage; explicit retry returns the one canonical message | Passed |
| Private remove/re-invite | Removal 204, guest room access 404 and feed empty. Re-invite 201 with fresh pending invitation 29; invitation appears in guest inbox, access remains 404 before acceptance; accept 200 restores access 200, old notifications remain absent | Fixed for the sampled lifecycle |
| Attachments | Valid small text-file reservation still returns 503, attachment uploads unavailable | Still blocked |
| Cursor before=0 | Authenticated notification GET still returns 200 | Contract mismatch remains |
| Legacy cleanup | Read-only public room 2 member audit still finds account 36 as member; no membership for 35 in that room | Account 36 cleanup remains; deletion of both accounts unconfirmed |
| Response headers | Authenticated notification GET 200 for sandbox Origin exposes Content-Length, Retry-After, X-Request-Id; response includes a request ID | Exposure fixed; actual 429/Retry-After behavior not retested |
| Realtime | GET /readyz/realtime 200 with ready:true; authenticated WebSocket upgrade with sandbox Origin returns valid 101 | Readiness/handshake passed; multi-tab and distributed delivery not established |
| REST schema | contract:check passes 29 required operations; API 1.0, 31 paths, 41 operations, unchanged SHA-256 a1791d35c2d14d96664e806639a7c89415e716487c1b3142c74cff8df3c8a8de | No schema drift |

## Evidence and cleanup

Native Chrome evidence: `/tmp/gogo-be-recheck-Yb0llq/report.json`, started 2026-10-15T07:50:51Z. The report has seven observations: five successful checks and two unmet expectations (attachment 503 and cursor 200). The harness summary's `passed:7` is the observation count, not a seven-pass result. The table above uses the individual statuses.

The app used `VITE_API_BASE_URL=https://gogo-dl.onrender.com` with a temporary local Vite server at localhost:3000, without a proxy. No current feature deployment to chat-sb was performed. Both origins' preflights were checked, while the native feature journey used localhost. Browser exceptions: zero; the deliberate lost response produced the expected connection error.

Created messages 278 and 279 were deleted with 200. Disposable account 47 was deleted with 204. The owner's temporary public-room membership was removed with 204. Credentials were retained privately before mutations. The owner/private room remain intentional fixtures. Legacy account data was inspected only; no admin deletion was attempted.

Preflight evidence: `/tmp/gogo-be-cors-local-20261015.txt`, `/tmp/gogo-be-cors-sandbox-20261015.txt`. Authenticated WS and header checks completed with exit 0. An initial WS script invocation without a token exited before probing; a later authenticated invocation is the evidence above.

## Remaining work

Backend: attachment scanner/provider lifecycle, authorized legacy account cleanup, cursor contract alignment, and investigation of prior transient 502 responses. No server-log access was available, so their root cause remains unknown. Real 429 headers and cross-node worker/delivery behavior remain verification gates.

Frontend/release: final-host feature deployment and browser multi-tab/reconnect acceptance remain open. This targeted rerun does not repeat every previous mobile, pagination or preference journey, and does not prove fresh-notification delivery after private rejoin beyond the observed empty old-generation feed. See [backend handoff](./BACKEND_HANDOFF.md) for the remaining checklist.
