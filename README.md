# Gogo DL Web Chat

Vue 3 + TypeScript chat client with a pixel UI. Includes rooms/invitations, message editing/deletion, unread counts, WebSocket recovery, presence/typing, Search, Mentions/Inbox and attachments. REST remains authoritative and the newest message page keeps five-second polling.

## Run locally

Requires Node.js 22.18+ and a backend. Current acceptance target is local port8080.

```bash
npm ci
```

Create or update `.env.local`:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8080
```

```bash
npm run dev -- --host localhost --port 5173 --strictPort
```

Use a free port allowed by backend REST CORS and WebSocket Origin settings. Vite compiles the API origin into the build; changing it requires rebuilding. The fallback API default is Render, whose quota was exhausted during acceptance.

## Check and build

```bash
npm run check
```

Runs format, lint, typecheck, tests and production build; CI runs the same command. Live/native checks are described in [release preparation](docs/RELEASE.md).

## Documentation

- [SPEC.md](SPEC.md): product behavior and code boundaries.
- [PLAN.md](PLAN.md): phase status and next work.
- [Pending](docs/PENDING.md): the single list of unresolved work and release gates.
- [Release](docs/RELEASE.md): draft notes, verification and rollout checklist.
- [Acceptance](docs/ACCEPTANCE.md): dated results and retained evidence.
- [Contracts](docs/CONTRACTS.md): REST/WebSocket integration boundaries.
- [Fixture cleanup](docs/LIVE_FIXTURE_CLEANUP.md): safe live-test execution.
