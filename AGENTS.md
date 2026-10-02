# Gogo DL Web Chat

Read `SPEC.md` for product behavior and `PLAN.md` for priorities before changing a user flow. This repository is a Vue 3 + TypeScript client for the Gogo DL REST API.

- Keep endpoint functions in `src/lib/api.ts` and Axios transport in `src/lib/http.ts`. Use Vue Query for server data and mutations, with cache keys in `src/lib/query.ts`; Pinia holds session state.
- Put reusable presentation controls in `src/components/base/`, feature UI in `src/features/`, and route composition in `src/views/`. Base controls must not import API, router, or session modules.
- Keep source comments, UI copy, tests, and documentation in English.
- Keep the pixel visual language and accessible interaction patterns in `src/style.css`.
- WebSocket and SSE work is deferred. The current chat refreshes its latest HTTP page every five seconds while the room is open. When WebSocket work begins, use `@vueuse/core` for the Vue connection lifecycle after confirming the backend contract.
- Run `npm run check` before completing code changes. CI runs the same command.
- Use the repository skill `.agents/skills/gogo-chat-development/SKILL.md` for feature work that spans API, state and UI.
