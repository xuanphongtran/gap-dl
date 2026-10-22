# Release preflight — 2026-10-22

Read-only checks on `https://chat-sb.xuanphong.io.vn` confirm SPA route fallback and a frontend artifact matching the current `5cbc6ff` source when built with the same API environment. They do not establish functional acceptance against a working hosted backend. The user subsequently confirmed that testing should continue locally only.

[Sanitized evidence](./evidence/release-preflight-2026-10-22.json) records three200 HTML responses (`/`, `/login`, `/app/rooms/3`) with the same digest and no deployment protection redirect. JavaScript and CSS were fetched without executing page scripts or calling Render APIs.

The private comparison build used `VITE_API_BASE_URL=https://gogo-dl.onrender.com` to match the hosted bundle's environment. Both generated assets match the hosted bytes:

| Asset | SHA-256 |
| --- | --- |
| `/assets/index-CueJzhB9.js` | `2bf1bfb2e1b05d731bc67a0fe543ee9611303563555dd1b7b19e8206db554cc5` |
| `/assets/index-BO9PhTyv.css` | `ffeb3306fe4623faadb16fe26fa45f5c5be547c27a3960ca3d04690908771224` |

The initial local build had a different JavaScript hash because its API origin was local8080. Comparing that build directly would incorrectly suggest stale hosted source. The environment-normalized comparison closes only artifact identity; it does not identify a deployment commit or prove backend compatibility.

The sandbox still points at the quota-exhausted Render backend. Local8080 cannot serve as a public HTTPS API for remote browsers. No deployment or hosted API retry was performed. A working selected-host API environment and native browser rerun are needed before closing the recovery/attachment/presence rollout gate. Real warm-up/readiness failure, rolling deployment, graceful drain, distributed delivery, traffic/latency and long-session memory gates remain open. AsyncAPI publication drift remains tracked in the backend handoff. Existing local synthetic recovery and history measurements retain their original dates.
