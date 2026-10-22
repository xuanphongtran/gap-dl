# Live fixture execution and cleanup

Reuse the approved private registry in ignored `.realtime-fixtures.local/` (directory0700, files0600). Owner 9/public room 3/private room 4 are retained. Create no new owned room without an approved retention/deletion strategy. Never commit credentials, tokens, signed URLs or journal contents.

## One live runner at a time

The current helper can clean every outstanding guest in its registry. Running two probes concurrently already caused one to delete the other's guest. Serialize all live fixture mutations/cleanup until P01 implements enforced ownership. Synthetic suites with separate local fixtures do not use this registry.

## Journal protocol

1. Use `scripts/lib/live-fixture-journal.mjs`. Before each write, persist a private recovery intent with enough information to identify an uncertain outcome.
2. Return/store a resource identity only after validating success. Timeout,500 or missing response stays uncertain;401 is not proof of deletion.
3. Reconcile ambiguous outcomes only inside authorized fixture scope. Do not blindly replay writes, sign up replacements or delete unrelated matching records.
4. Cleanup known messages/uploads before deleting disposable accounts. Confirm actual deletion/tombstone acknowledgements. Save progress before and after each operation so interruption is recoverable.
5. Report cleanup success only when every relevant journal has 0 unresolved entries. Retain unresolved recovery material and list it in PENDING.md; never publish raw errors or secrets.

Use one owner per journal file and serialize its writes. Each independent native mutation needs its own journal or explicit serialization. Account deletion can establish logical membership/read-state cleanup, but does not prove physical R2 deletion/quota release. Old owner3/rooms1/2 and historical Render records must not be confused with current retained fixtures.

```bash
npm test -- scripts/live-fixture-journal.test.mjs scripts/realtime-live-fixtures.test.mjs
```

These tests verify journal behavior, not live infrastructure cleanup. [Release](RELEASE.md) owns execution order; [pending](PENDING.md) owns unresolved outcomes.
