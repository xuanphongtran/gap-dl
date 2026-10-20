# Live acceptance fixture cleanup

Use `scripts/lib/live-fixture-journal.mjs` for future authorized live acceptance harnesses. The original 2026-10-16 private Search harness is no longer available; its successful cleanup evidence does not prove safety under response loss or interruption. The tracked journal has local failure-injection coverage, not a new live acceptance claim.

Create a private directory outside the repository with mode 0700, persist recovery credentials there before any request, and open one journal file per sequential harness. Files are atomically replaced with mode 0600. Never commit the journal or include its contents in reports.

Wrap every resource-creating request, including registration, in `journal.write({ kind, recovery }, send)`. `recovery` must contain enough private information to identify the outcome without its response: a unique run marker and exact room for messages; persisted credentials/email for a disposable account. The journal records an uncertain intent before invoking `send`; return a resource identity only after validating a successful response. A timeout or malformed response leaves the operation unconfirmed.

Before cleanup, call `journal.cleanup({ reconcile, remove })`. `reconcile(entry)` must locate an ambiguous resource using its recovery information and return `{ resource }`, or return null to retain uncertainty. For lost registration responses, sign in using the persisted disposable credentials to obtain the account identity/session. For messages, search/page only the authorized fixture room for the unique marker and verify ownership before deletion. Never assume a missing response means nothing was created, or delete unrelated matches. Unresolved ambiguity must remain an open cleanup gate.

`remove(entry)` must confirm deletion or an already-absent state and must tolerate repetition. The journal saves `cleaning` before each deletion and `cleaned` immediately after confirmation. If the process is interrupted, reopen the same file and resume; a deletion whose acknowledgement was lost is retried safely. Save and report `journal.summary()` even if cleanup throws. A report can pass cleanup only when `unconfirmed === 0`; do not print raw exceptions or private state.

Run `npm test -- scripts/live-fixture-journal.test.mjs` to verify lost message/registration responses, restart after interrupted cleanup, and unresolved writes. These adapters and live integration must be checked in the next hosted harness before it creates fixtures. No new sandbox writes are needed for the local tests.
