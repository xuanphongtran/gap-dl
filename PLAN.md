# Gogo DL Web Chat implementation plan

Reference: [SPEC.md](./SPEC.md). The frontend uses Vue 3, TypeScript, an 8-bit/pixel UI, and room-based chat. WebSocket and SSE are post-MVP TODOs.

**Status on 2026-09-28:** The frontend and CI are in place. The local quality gate passes, and the API health endpoint and localhost CORS preflight have been checked. Authenticated chat flows and a deployed build still need testing with accounts.

## Phase 0 — Contract and project setup

- [ ] Confirm the backend questions in SPEC, especially expires_at, message pagination, and content limits. Local CORS preflight has been verified.
- [x] Set up Vue 3, TypeScript, Vite, Router, Pinia, Axios, Vue Query, ESLint, Prettier, and .env.example with VITE_API_BASE_URL.
- [x] Create pixel UI tokens and base components; inspect the sign-in screen at desktop and mobile sizes.
- [x] Add typed Axios API calls, HTTP error handling, 204 handling, request timeout, and cancellation for room reads.
- [ ] Prepare at least two test accounts in development for invitation and messaging checks.

**Done when:** The app runs locally, the API health and authentication endpoints can be called, environment setup is documented, and no tokens are hardcoded.

## Phase 1 — Authentication and application shell

- [x] Build register/sign-in forms with basic validation, loading, and error states.
- [x] Keep the session in the tab; share concurrent token refresh requests, handle refresh failure, and prevent refresh from restoring a logged-out session.
- [x] Add route guards, profile loading, frontend sign-out, and responsive room navigation.

**Done when:** A user can enter the app and reload the page; an expired session resolves clearly; protected requests carry the correct Bearer token.

## Phase 2 — Core chat

- [x] List and create rooms, open rooms by URL, and show empty/error states.
- [x] Load recent messages with author and time, then fetch older pages through before.
- [x] Send messages without duplicate submissions, keep drafts on failure, and poll the latest page through Vue Query while history loads on demand.
- [x] Apply the pixel UI to room navigation, messages, and composer; support mobile navigation and per-room drafts.

**Done when:** Two accounts in one room can exchange messages and load history without duplication or scroll jumps.

## Phase 3 — Invitations, members, and profile

- [x] Join a public room by ID; view, accept, and decline invitations; invite another user by ID.
- [x] Show members and role-based controls for role changes, removal, ownership transfer, and leaving.
- [x] View/update a profile and confirm account deletion.
- [ ] Verify UI refresh and contextual feedback for 403, 404, 409, and 429 against the live backend.

**Done when:** Two accounts complete create room → invite → accept → chat → leave, and rejected permissions are explained.

## Phase 4 — Stabilization and release

- [ ] Manually test desktop/mobile, expired sessions, unstable network, rapid room changes, background tabs, long histories, and reloads.
- [x] Add focused tests for concurrent refresh, logout during refresh, request cancellation, and message merging; run formatting, lint, typecheck, and build.
- [ ] Verify the production API origin, CORS, HTTPS, generic errors, and absence of tokens in logs or URLs.
- [ ] Smoke-test a deployed build with two accounts and public/private rooms.

**Done when:** SPEC acceptance criteria pass on the deployed build, the pixel UI remains readable on desktop/mobile, and no issue blocks the primary flow. WebSocket/SSE are not MVP release gates.

## TODO after MVP — Realtime and expansion

- [ ] Choose WebSocket or SSE and define authentication and event schemas. Use `@vueuse/core` for the WebSocket connection lifecycle.
- [ ] Add an after cursor for message recovery, reconnection/backoff, and duplicate-event handling.
- [ ] Move refresh tokens to HttpOnly cookies if backend support is added; add server-side logout/revocation.
- [ ] Design canonical direct messages and user/room discovery before unread counts, typing, search, files, or notifications.

## Backend priorities

| Priority | Work | Reason |
| --- | --- | --- |
| P0 | Confirm production CORS, token semantics, and pagination/content limits | Required for reliable browser integration |
| Post-MVP TODO | Add GET messages?after=<id> or equivalent | Recover missed messages during polling/reconnection |
| Post-MVP TODO | Add WebSocket/SSE and minimal events | Faster updates with less polling |
| P1 | Add user/room discovery or shareable invitation links | Avoid manual ID entry |
| P2 | Add refresh cookies and logout/revocation | Better production session management |
| P2 | Add direct messages, unread counts, files, and other enhancements | Build on stable room chat |
