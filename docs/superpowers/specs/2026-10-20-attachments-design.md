# Chat attachments frontend design

Status: approved by the user on 2026-10-20; [implementation plan](../plans/2026-10-20-attachments.md) is written and awaiting review. Branch `feat/attachments`, implementation base `1b1c741`. This is the next independently reviewable feature after Release hardening. [Current contract/runtime evidence](../../ATTACHMENTS_RECHECK_2026-10-20.md) supersedes the missing binding/download contract findings from 2026-10-19. The operational readiness gate and two uncertain registrations remain open.

## Intent and scope

Complete the pending attachment flow in the existing pixel chat: select supported files, show upload/processing progress, send verified files with an ordinary caption and optional mentions, then let authorized members download them from live message rows. Preserve text-only sends, typed mentions, immutable explicit retry, room drafts, pagination, Search and privacy on logout/revocation.

The initial frontend slice keeps a nonblank caption, matching SPEC/PLAN. The backend's new attachment-only capability is not automatically adopted. Existing file-only messages from other clients still render their files, and historical empty rows after uploader deletion receive a neutral unavailable-content label. Caption edits preserve files; clearing a caption remains unavailable in this slice. No inline image preview, file-content search, resumable multipart transfer, drag/paste upload, antivirus claim, SSE, presence/typing or distributed guarantees is added.

## Approaches and decision

Use a focused upload composable, extend the existing send-intent owner, and share one download-capable attachment list between history and Search. This gives the new upload lifecycle a clear owner while reusing the existing idempotent send behavior. No new runtime dependency is required.

An upload-only panel would strand users before sending/downloading and would not satisfy the requested completion. A new parallel message-sending subsystem would duplicate canonical identity, mention retry and account guards. A broad rewrite of RoomChat would enlarge the regression surface; extract only the attachment responsibilities needed here.

## Contract boundaries

Use the current Swagger and the backend [frontend handoff](https://github.com/xuanphongtran/gogo-dl/blob/2899b566e8bfdb0807858f37bbcc337bba4f94b8/docs/attachments.md). Before coding, the implementation plan must pin these contracts in the existing checker and API boundary tests.

- Files: PNG, JPEG or plain-text .txt, 1–10,485,760 bytes each; compatible extension and MIME; maximum five selected files/message. Validate filename UTF-8 length at most255 bytes, without control characters or path separators. A .txt file with empty browser MIME may be declared text/plain; unsupported or contradictory types require a different file. Server verification remains authoritative.
- Hash original bytes with Web Crypto SHA-256; reservation sends original filename/type/size/hash and a distinct upload key.
- Reservation returns owned metadata plus ephemeral method/headers/upload_url. PUT exact bytes with required ticket headers; do not set browser-forbidden Content-Length/Host manually. Repeat412 does not mean the stored bytes match the selection.
- Completion202 queues processing. Poll authorized metadata until ready with verified true, rejection, cancellation or expiry. Unknown states stay non-sendable with neutral status and explicit retry; never infer readiness from 202 or upload100%.
- Message POST contains trimmed caption, sorted distinct attachment IDs and mention IDs. Up to five own ready/unexpired files in the same room; use a separate message-specific key. Same key and immutable body reconcile a lost response. Incompatible claims/body409 never silently generate another key.
- Safe message summaries contain processed output metadata; image re-encoding may change input size/hash. Do not compare processed output to the original input as if they must match.
- Download authorization returns a 60-second URL only for a current member and live message binding. API and object responses are no-store; Content-Disposition forces attachment. Previously issued URLs cannot be instantly revoked by the application.
- Cancellation/complete on an already bound file may return409. Deletion/expired reservations rely on delayed server cleanup; a successful API cancellation does not prove bytes were physically deleted or quota released.

Published quotas are 100 MiB/10 pending unattached files per user,1 GiB total per user and10 GiB per room. Show concise server errors; do not calculate remaining global quota from this tab's five selected files.

## User interaction

Add an ATTACH FILES button and labelled native multiple file input next to the composer. Show one compact row per selection with filename, size, progress/status, remove/cancel and explicit retry when appropriate. Selection errors identify the affected file. Status changes use polite live feedback; controls have file-specific accessible labels and visible focus. Rows wrap on mobile without horizontal overflow and retain the pixel tokens in src/style.css.

Retain the caption and mention selection while files upload/process or an upload fails. Disable sending while any selected file is not ready or a message intent is locked, and explain why. Upload progress reaching 100% changes to processing, not ready. Removing a failed file permits sending remaining ready files with the existing caption. User may send text alone after removing all selected files.

Do not auto-send when processing completes. Enter and the send button use the same validation. Once a keyed send starts, freeze caption, recipients and file IDs; show the existing RETRY/DISCARD PENDING SEND affordance with updated copy covering files. Discard warns the original may already have been accepted. Discarding an uncertain message must not independently delete its file IDs; the backend may have bound them already.

Display verified filename/type/size and a DOWNLOAD action in live message rows, including Search. Treat filename/content as text; never inject markup or show bucket/object keys. Tombstones display no attachment metadata or download controls. Empty content after uploader deletion gets a neutral Message content unavailable label. File-only messages from other clients show attachments even though this composer requires a caption.

## Upload ownership and state machine

Create src/features/attachments/useAttachmentUploads.ts with a small typed interface for select/remove/retry, readonly rows, ready IDs/summaries and whether sending is blocked. Each selection records current account, room, local generation, immutable File metadata, upload key, owned attachment ID when known, and its stage. Tickets and File buffers stay outside Vue Query, Pinia and persistent storage.

Stages: validating/hash → reserving → uploading → completing → processing → ready; failures retain the last confirmed stage for explicit retry. Cancellation marks the local generation obsolete before aborting I/O. Serialize file hashing/transfers within the batch to bound active buffers and make cancellation predictable. At most five File objects are retained; release raw bytes/File references after ready or removal.

Reservation retry preserves its original key and metadata. Keep successful tickets only in the active call. An uncertain PUT or412 is not automatic success: explicit retry first reconciles metadata/completion/processing using the same reservation; only ready+verified makes it sendable. If the original bytes cannot be verified or the reservation expired, explain the failure and let the user explicitly discard/cancel before choosing a new upload attempt. Never silently reserve another file under a replacement key after an ambiguous result.

Completion failures retain the known owned ID and allow explicit reconciliation/retry. Use a Vue Query mutation whose successful result is safe metadata or void; consume the ticket inside the mutation function and return no signed URL. Mutation variables/context contain only safe local IDs; do not retain File objects, byte buffers or tickets in the mutation cache. Drop closure-held File/buffer references and reset completed mutation state when its selection is released. Disable automatic mutation replay and retries. Each async callback checks account, room, selection and generation before changing visible state or cache.

Use account+room+attachment keys nested under the existing room prefix for safe metadata reads. Cancel signals on scope changes. Poll processing metadata every 2s while its batch is active and the document is visible; pause offline/hidden, reauthorize/reconcile on foreground. Stop after 60s of active observation and offer CHECK STATUS; pending backend processing is not represented as success. Honor valid Retry-After as an absolute maximum deadline across poll, focus and explicit retry; absent/malformed headers permit explicit retry without an invented countdown. Do not auto-retry writes.

## Room, session and uncertain-send lifecycle

Unsent upload selections belong to the currently active room. Room navigation stops transfers/polls, clears selection/File/ticket references and schedules best-effort cancellation of known unbound IDs only while the same authenticated account remains active. Keep the ordinary text draft behavior. Opening Search in the same room preserves selection and processing state. Explain that switching rooms discards unsent files without silently sending them.

Logout, explicit account change and membership loss immediately abort/hide upload work and invalidate the generation. Never send cleanup using a new account's credentials or reinsert old metadata from a late response. A reservation accepted after cancellation or after auth loss may be left to server expiry if it cannot be safely cancelled. Record this as delayed cleanup behavior, not a client-side physical deletion guarantee.

At send start, transfer ownership of ready attachment IDs into the existing per-room pending send snapshot and release raw upload references. A pending or uncertain keyed send outlives ordinary room navigation just as existing mention sends do; it retains immutable IDs/safe summaries and key only in memory. No upload cancellation path deletes these IDs. Returning to the room restores the pending send affordance. Logout/access loss clears private snapshots; no stale callback can merge into another account/room. Retry uses the original caption, recipients, attachment IDs and key even if the current UI has changed.

After a successful canonical response, merge by message ID/revision through existing code, clear the matching intent and selection exactly once, then scroll using the current room's existing policy. Error 400/413/429 before uncertainty leaves the draft editable;403/404 follows confirmed room-access cleanup; attachment-specific404 requires room reauthorization before clearing the room or draft. A409 or network/503 after a potentially accepted send remains explicit pending intent; never auto-generate a key. Preserve the existing 24h retry bound and require conversation reconciliation after expiry.

## Download lifecycle

Create a feature download composable and a reusable MessageAttachmentList.vue. Request a fresh ticket only after a user action; no prefetch. The mutation obtains/validates the HTTPS URL, verifies that the account/room/message/binding and component generation are still current, triggers a temporary noreferrer/noopener download navigation and returns void. Remove the transient anchor immediately. Do not put tickets into Vue Query mutation results, query cache, rendered persistent links, telemetry or local/session storage. The raw R2 navigation never uses the API Axios bearer interceptors.

Navigation avoids retaining file blobs and does not require R2 GET CORS merely to start a download. Browser acceptance must still verify the real download behavior and safe response headers. If a future implementation chooses JavaScript byte fetching instead, its R2 CORS and memory changes require an explicit design amendment.

Errors stay scoped to the clicked file;429 honors its deadline,503 permits explicit retry and401 uses existing session handling. A missing/deleted binding404 marks only that file unavailable and invalidates the relevant message reads; it does not by itself prove room revocation. Confirm room access before applying room-wide cleanup. Abort/ignore late tickets after logout, navigation, deletion or membership loss. Already-started browser transfers and issued60s URLs are governed by the backend bearer window.

## Data and file boundaries

- src/lib/api.ts: reserve/get/complete/cancel/download endpoints and message options; use existing Axios API transport/signals.
- src/lib/http.ts: isolated upload transport without session/auth-refresh interceptors, progress and AbortSignal; never expose provider error bodies or signed URLs in generic errors. It returns safe status only and owns PUT credentials isolation.
- src/types.ts: typed upload metadata, safe attachment summary, message send options and ephemeral ticket types. Message reads tolerate absent attachment arrays from old fixtures/deployments as empty; validate rendered metadata and require verified true.
- src/lib/query.ts: account-scoped owned upload metadata keys under room, inheriting room/session cleanup. No ticket keys.
- src/features/attachments/: upload state, download action and presentation. Base controls remain API/router/session-free.
- src/features/messages/useMentionSend.ts: extend the existing immutable send owner with attachment IDs; no second sender. Rename types only where needed for their expanded meaning, preserving existing callers/tests.
- MessageComposer.vue and RoomChat.vue: attachment controls and sendability integration; MessageRow.vue and shared Search rows render file actions.
- src/lib/messages.ts and Search reconciliation: clear attachments whenever a tombstone wins; preserve newer revision, deleted-author rules and full server metadata replacement. Never resurrect files from older cached/WS payloads or infer attachment deletion solely from a partial frame. Account deletion updates must remove obsolete file metadata with the newer revision.

No new runtime dependency, upload service, preview renderer, global state library, route or dedicated attachment page is required.

## Verification and release gates

Use TDD for product changes with real Vue Query/Axios boundaries and meaningful deferred-response regressions. Cover exact reservation/message retry identity, same-key payload conflicts, duplicate selects, MIME/size/hash limits, create-only 412 reconciliation, upload/cancel/scan races, late reservation after room/account change, ready expiry,429 deadline across automatic/manual requests, processing timeout/unknown states and safe error output.

Composer tests cover caption+file+mention, blocked send while processing, text-only behavior, Enter, removal, uncertainty freezing all payload fields, room-return pending identity and one canonical success. History/Search tests cover processed metadata, thumbnail-free downloads, tombstones, uploader-deletion revisions, missing old attachment arrays, file-only inbound rows and stale-event non-resurrection.

Download tests prove no API token on storage, no URL in cache/mutation data, no prefetch, per-file errors,404 binding vs room revocation, late-ticket isolation and no signed URL persistence. Accessibility/mobile checks include keyboard file picker, cancel/retry focus, status feedback, filename wrapping and390px layout.

Run npm run check and git diff --check. Extend opt-in native local fixtures to cover upload progress, delayed processing, dropped accepted send response, cancel/room/account switches, denied downloads and exact retry. Keep simulation labelled. Reuse the private live journal protocol and disposable accounts for actual staging/browser verification only after readiness recovers and the failed registrations are reconciled. Never flood quota/rate limits or generate malicious samples to imitate unverified scanner guarantees.

A single independent final branch review may be used after implementation per the approved execution plan; no per-task review/delegation is assumed. Record Critical/Important regression fixes and any deferred Minor evidence limits. The implementation plan is written after user review of this spec; prefer the existing native/inline execution workflow. No push, merge, deployment, database migration, service restart or old-binary rollback is authorized by this frontend design.

Release requires live binding/download and privacy evidence, plus local/native frontend checks. Operational readiness, private-role matrix, physical delayed cleanup/quota release and selected-host acceptance remain explicitly open until observed. Backend lightweight processing is the supported policy; ClamAV is not a prerequisite. Keep a schema-compatible backend deployed; frontend rollback does not imply downgrading backend schema13.

Native acceptance uses an ephemeral loopback HTTPS provider mapped to the exact synthetic host and trusted only by its test certificate SPKI pin. Chrome sends actual File bytes for hash verification; CDP blocks other external requests, including download targets. This avoids relying on inaccessible CDP File blob postData without changing production HTTPS validation.
