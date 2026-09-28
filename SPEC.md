# Product specification: Gogo DL Web Chat

Status: MVP implementation draft. Source: [Gogo DL API 1.0 Swagger](https://gogo-dl.onrender.com/swagger/index.html), reviewed on 2026-09-28. The Swagger document describes 22 operations across 17 paths. Authenticated behavior has not yet been verified with test accounts. Visual direction: 8-bit/pixel. WebSocket and SSE remain post-MVP TODOs.

## 1. Goal and scope

Build a room-based web chat application with Vue 3 and TypeScript. Users can register, sign in, view rooms they can access, read and send messages, handle invitations, and manage their profile. The interface must work on desktop and mobile.

The MVP supports text messages in rooms. A private room can serve a small group, but the API does not define a unique direct-message conversation, user directory, or user search. Attachments, reactions, read receipts, typing indicators, message search, and push notifications are later work.

## 2. Main user flows

| Flow | Expected behavior | Existing API |
| --- | --- | --- |
| Register | Enter email, username, and password; receive a token pair | POST /api/v1/auth/register |
| Sign in | Enter email and password; load profile | POST /api/v1/auth/login; GET /api/v1/users/me |
| Open app | View accessible rooms and pending invitations | GET /api/v1/rooms; GET /api/v1/users/me/invitations?status=pending |
| Open room | Load room details, recent messages, and members | GET /api/v1/rooms/{id}; /messages; /members |
| Send message | Send plain text and show sending, error, or success state | POST /api/v1/rooms/{id}/messages |
| Read history | Load older messages with before=<id> and limit | GET /api/v1/rooms/{id}/messages |
| Manage rooms | Create public/private rooms, join a public room by ID, leave a room | POST /api/v1/rooms; POST /api/v1/rooms/{id}/join; DELETE /api/v1/rooms/{id}/membership |
| Invitations | Invite by user_id; accept or decline | POST /api/v1/rooms/{id}/invitations; POST /api/v1/invitations/{id}/accept or /decline |
| Members | View members; change role, remove member, or transfer ownership when allowed | GET/PATCH/DELETE member endpoints; POST /api/v1/rooms/{id}/ownership |
| Profile | View/update username and avatar URL; confirm account deletion | GET/PATCH/DELETE /api/v1/users/me |

### MVP acceptance criteria

1. Users can register and sign in. Reloading preserves the tab session or clearly returns them to sign-in when the session expires.
2. Rooms, messages, and invitations show only data returned for the current account, with useful loading, empty, and error states.
3. Sending and syncing do not duplicate messages. Failed sends preserve the draft for retry. Messages display in ascending ID order.
4. Loading older messages preserves reading position. Overlapping pages merge by message ID.
5. Accepting an invitation, joining/leaving a room, and changing membership refresh affected views.
6. The UI works with keyboard navigation and labelled inputs, with readable contrast and mobile room/chat navigation.
7. A 401 triggers one token refresh attempt. Failed refresh clears the session. 403, 404, 409, 413, and 429 receive contextual feedback.

## 3. Screens and visual direction

| Route | Content |
| --- | --- |
| /login and /register | Authentication form, errors, cross-link |
| /app | Room list, pending invitations, create/join actions, empty state |
| /app/rooms/:id | Room header, messages, composer, member panel |
| /app/settings | Profile settings and account deletion |

Dialogs or inline forms cover room creation, joining by ID, inviting by user ID, member management, and destructive action confirmation. Show actions according to the returned owner/moderator/member role; the backend remains authoritative for permissions.

### 8-bit/pixel language

- Use rectangular panels, pixel-like borders, offset shadows, square corners, and spacing based on 4 or 8 px.
- Initial colors: background #101820, panel #1D2B34, border #5A6B75, text #F4F4E8, accent #4DE0A8, warning #FFCA5C, error #FF6B6B. Check contrast, especially for small labels.
- Use a pixel font for short labels and buttons, and a readable sans-serif font for messages, forms, and help text.
- Use a consistent pixel icon style. Default avatars use the first username character; valid avatar URLs can be added to displayed avatars.
- Convey state through both color and text/shape. Keep focus visible, touch targets around 44 px, and respect reduced-motion settings.
- Desktop uses room, conversation, and optional member columns. Mobile shows the room list or one chat at a time.
- Preserve line breaks in messages and wrap long URLs. Do not pixelate body text.

## 4. API contract notes

- Configure the backend origin with VITE_API_BASE_URL. Swagger currently lists localhost:8080 as its host; production uses https://gogo-dl.onrender.com.
- Protected requests use Authorization: Bearer <access_token>. Login/register return access_token, refresh_token, and expires_at. Refresh accepts a JSON refresh_token and returns a new pair. Confirm the unit and meaning of expires_at before proactive refresh scheduling.
- Core models: Room {id,name,visibility,role,created_by,created_at}; Message {id,room_id,user_id,username,content,created_at}; Invitation {id,room_id,room_name,invitee_id,invited_by,status,...}; RoomMember {room_id,user_id,username,role,joined_at}.
- Enums: visibility = public/private; role = owner/moderator/member; invitation status = pending/accepted/declined.
- List responses wrap their arrays in rooms, messages, members, or invitations. Some successful mutations return 204 with no body. API errors use an error string.
- The messages endpoint uses before=<message ID> for older history. It does not expose an after cursor for new messages. Merge by ID and sort before rendering.

## 5. Message updates

Swagger currently exposes REST only. The MVP reloads the most recent page of the open room about every five seconds while the tab is visible. After sending, insert the 201 response and deduplicate by ID. Refresh immediately when the tab becomes visible again. This is temporary: it adds latency and repeated traffic, and can miss messages if more than one page arrives between polls. Confirm the valid limit with the backend.

TODO after MVP: choose WebSocket or SSE, then define authentication, message.created, room.updated, membership.updated, and invitation.updated events, reconnection, and recovery of missed messages through an after cursor or equivalent. Online and typing states require separate contracts.

## 6. Frontend rules

- Use Vue 3, TypeScript, Vite, Vue Router, and Pinia. Centralize typed HTTP calls, base URL, Bearer tokens, error parsing, and token refresh in the API client. Components must not call fetch directly.
- Separate server data from UI state. Abort room reads and stop polling when navigation changes; prevent stale responses from updating a different room.
- The current backend accepts refresh tokens in JSON. Session storage supports reloads in one tab but is readable by injected scripts. Never log tokens, put them in URLs, or render message HTML. Before production, coordinate an HttpOnly, Secure, SameSite cookie design and matching CSRF policy with the backend.
- Render messages as plain text. Confirm backend content-length limits and handle 413.
- Display API timestamps in the browser's locale; use message IDs, not timestamps, for identity and merging.

## 7. Backend questions

1. Which production/local frontend origins are allowed by CORS?
2. What does expires_at represent, and how does refresh-token rotation work?
3. What are the message order, default/max limit, exact before semantics, and future after-cursor contract?
4. What can each role do with invitations, role changes, removals, ownership transfer, and leaving? Must an owner transfer ownership before leaving or deleting their account?
5. How can users discover another user's ID or a public room, besides manually entering IDs?
6. What are the limits for message content, usernames, and room names? What avatar URLs are accepted?
7. Is a server-side logout or refresh-token revocation endpoint planned?

## 8. Outside MVP

Canonical direct messages, user/room search, attachments, notifications, exact unread counts, read receipts, message editing/deletion, full-text search, advanced moderation, and audio/video calls need separate API contracts.
