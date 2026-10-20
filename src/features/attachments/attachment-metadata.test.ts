import { expect, it } from 'vitest'
import { safeMessageAttachments } from './attachment-metadata'
import { attachmentMessage } from './attachment-test-utils'
it('returns only safe verified processed summaries and hides tombstones/malformed data', () => {
  const m = attachmentMessage()
  expect(safeMessageAttachments(m)).toEqual([
    {
      id: 10,
      filename: 'a.txt',
      content_type: 'text/plain',
      size_bytes: 1,
      sha256: 'a'.repeat(64),
      verified: true,
    },
  ])
  expect(safeMessageAttachments({ ...m, deleted_at: '2026-10-20T00:00:00Z' })).toEqual([])
  expect(safeMessageAttachments({ ...m, attachments: undefined })).toEqual([])
  for (const invalid of [
    { id: 0 },
    { verified: false },
    { sha256: 'bad' },
    { size_bytes: 0 },
    { filename: '../private.txt' },
    { content_type: 'text/html' },
  ])
    expect(
      safeMessageAttachments({ ...m, attachments: [{ ...m.attachments[0]!, ...invalid }] }),
    ).toEqual([])
})
