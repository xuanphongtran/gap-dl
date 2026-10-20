# Long-history resource baseline — 2026-10-16

Six native Chrome runs passed against a deterministic loopback API and the real Vue app: three runs each at 40 and 1,000 synthetic messages. Evidence: `/tmp/gogo-history-V19yxV/report.json`. No deployed backend was used or mutated. Node 22.23.1; Vite development build; heap samples are Chrome JavaScript used heap, not process RSS or a post-GC retained-memory measurement. No service-level objective or memory-leak conclusion is inferred.

Each run loads all rows through the real LOAD OLDER control, samples 15 seconds visible and 15 seconds with simulated document visibility, then makes ten room switches and returns. Every run retained exactly the expected unique positive message IDs and row count, with no unexpected browser exception or fixture request. Request counts are REST calls by route template, excluding initial load from the idle deltas; WebSocket bytes/handshake costs are not measured. Fixture WebSockets deliberately reject upgrades, so background REST fallback/reconnect work is included.

| Rows | Load all (ms) | JS heap after load (MiB) | JS heap after ten switches (MiB) | Visible-window REST requests | Hidden-window REST requests | Rows after switches |
| --- | --- | --- | --- | --- | --- | --- |
| 40 | 183–215 | 10.1–10.2 | 9.9–11.9 | 25–25 | 6–6 | 40 |
| 1000 | 4343–4747 | 53.5–59.4 | 20.3–59.0 | 65–65 | 0–30 | 1000 |

## Interpretation and follow-up

The current UI retains and renders loaded rows; 1,000 messages are not virtualized. Loading all 1,000 rows includes 25 exclusive 40-message pages and real DOM work. Heap ranges depend on Chrome's collection timing; the harness does not force GC. A missing heap sample is null with an explicit reason, never zero.

Hidden visibility stops the ordinary polling schedule, but it does not mean zero HTTP traffic: the deliberately failing WebSocket can still trigger profile/authorization/recovery requests. Investigate route-specific costs before changing fallback cadence or claiming a hidden-tab network budget. These measurements justify keeping a follow-up for history DOM retention and REST recovery traffic, not introducing virtualization or reducing authorization checks in this phase. Real network latency, server load, production build costs and multi-hour sessions need separate measurements.

## Found regression and verification

The initial 1,000-row probe exposed a real fallback handoff bug: switching rooms while the previous REST recovery was pending left the new room paused with no active recovery. A mounted regression failed with paused=true; recovery registration now also starts the new room when the workspace still describes the old recovery. The WebSocket suite passes 21/21, the targeted native 1,000-row probe passes, and all six final runs above pass. Polling/history bounds were not changed.

Earlier incomplete evidence is not combined with the final baseline: `/tmp/gogo-history-2IjufD/report.json` and `/tmp/gogo-history-PNVDb4/report.json` stopped at the defect; `/tmp/gogo-history-7twvj4/report.json` was a single targeted rerun. Canonical row validation also has a RED→GREEN regression for an invalid zero ID despite a correct row count.

Full `npm run check` after the handoff fix passes 207 tests in 37 files, formatting, lint, TypeScript and build. The local build contains the new recovery fixes; deployment of this branch remains separate from this synthetic baseline.
