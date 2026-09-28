---
name: gogo-chat-development
description: Develop or change Gogo DL Vue chat features across the REST API client, state, routes, and pixel UI. Use for feature work in this repository; skip for unrelated documentation edits.
---

# Gogo DL chat development

Read `SPEC.md` for the feature's expected behavior and `PLAN.md` for its priority. Check the relevant endpoint in the current [Swagger](https://gogo-dl.onrender.com/swagger/index.html) when a payload or permission is uncertain; the deployed API may evolve beyond the spec snapshot.

Implement typed endpoints in `src/lib/api.ts` through the Axios instances in `src/lib/http.ts`. Put server data in Vue Query with shared keys in `src/lib/query.ts`; use `useQuery` or `useInfiniteQuery` for reads and `useMutation` with targeted invalidation for writes. Pinia owns authentication/session state, while local view refs own drafts and panel state. Preserve the 8-bit/pixel tokens and readable chat text in `src/style.css`. Keep WebSocket and SSE as TODO until the user explicitly brings them into scope. When WebSocket work is requested, use `@vueuse/core` for the Vue-side connection lifecycle after confirming the backend URL, authentication, event schema, and reconnection behavior. Do not add the dependency or connection code before that work begins.

Write UI copy, source comments, tests, and documentation in English.

For chat changes, keep message IDs as the merge key, use `before` for older pages, poll only the latest page, and avoid duplicate sends. Pass each query's AbortSignal to Axios so room changes cancel reads. Invalidate affected cache keys after mutations. For auth changes, preserve the single refresh request for concurrent `401` responses, clear cached server data when the session ends, and never log or render tokens.

Run `npm run check` after code changes. Add focused tests for behavior that can regress, especially auth refresh, message pagination, and state transitions. If the API behavior cannot be checked locally, state the unverified contract clearly in the handoff.
