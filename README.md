# Gogo DL Pixel Chat

Vue 3 + TypeScript web client for the [Gogo DL API](https://gogo-dl.onrender.com/swagger/index.html). The first version uses room based text chat over HTTP with a pixel styled interface. WebSocket/SSE integration remains a TODO.

## Start

Requires Node.js 22.18 or newer.

```bash
npm ci
cp .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL` in `.env` to the backend origin. The default is `https://gogo-dl.onrender.com`. The backend must allow the frontend origin through CORS. For production hosting, configure a fallback to `index.html` for client side routes such as `/app/rooms/1`.

## Checks

```bash
npm run check
```

This runs Prettier verification, ESLint, Vue TypeScript checking, tests, and a production build. Use `npm run format` to format source files. `.github/workflows/ci.yml` runs the same check on push and pull request.

## Architecture

- `src/lib/http.ts`: Axios instances, Bearer authentication, error handling, cancellation, timeout, and one shared token refresh request.
- `src/lib/api.ts`: typed REST endpoint functions.
- `src/lib/query.ts`: Vue Query client and cache keys. Queries own profile, rooms, invitations, members, and messages; mutations invalidate affected data. The newest message page polls every five seconds while history pages load on demand.
- `src/lib/session.ts`: session storage for token pair. It persists across reloads in the same tab; production should move refresh tokens to secure HTTP only cookies when supported by the backend.
- `src/stores/auth.ts`: Pinia state for the current session only.
- `src/views/`: authentication, shell, room chat and profile screens.
- `src/style.css`: pixel design tokens and responsive layout.

Read [SPEC.md](./SPEC.md) and [PLAN.md](./PLAN.md) for scope and remaining API questions. Repository guidance for Codex is in [AGENTS.md](./AGENTS.md) and `.agents/skills/gogo-chat-development/SKILL.md`.
