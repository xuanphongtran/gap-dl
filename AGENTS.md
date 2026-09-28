# Gogo DL Web Chat

Read `SPEC.md` for product behavior and `PLAN.md` for priorities before changing a user flow. This repository is a Vue 3 + TypeScript client for the Gogo DL REST API.

- Keep API calls in `src/lib/api.ts`; components should use typed API functions.
- Keep source comments, UI copy, tests, and documentation in English.
- Keep the pixel visual language and accessible interaction patterns in `src/style.css`.
- WebSocket and SSE work is deferred. The current chat refreshes its latest HTTP page every five seconds while the room is open.
- Run `npm run check` before completing code changes. CI runs the same command.
- Use the repository skill `.agents/skills/gogo-chat-development/SKILL.md` for feature work that spans API, state and UI.
