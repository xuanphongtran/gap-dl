// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
import { hashAttachmentFile, validateAttachmentFile } from './attachment-file'
import { file } from './attachment-test-utils'
afterEach(() => vi.unstubAllGlobals())
it('checks byte sizes, compatible types and UTF-8 filename bounds without trusting extension alone', () => {
  for (const [size, valid] of [
    [0, false],
    [1, true],
    [10485760, true],
    [10485761, false],
  ] as const) {
    const f = file()
    Object.defineProperty(f, 'size', { value: size })
    expect(!validateAttachmentFile(f).error).toBe(valid)
  }
  expect(validateAttachmentFile(file('a', 'a.txt', '')).contentType).toBe('text/plain')
  expect(validateAttachmentFile(file('a', 'a.png', 'text/plain')).error).not.toBe('')
  expect(validateAttachmentFile(file('a', 'a.pdf', 'application/pdf')).error).not.toBe('')
  expect(validateAttachmentFile(file('a', 'é'.repeat(125) + 'a.txt')).error).toBe('')
  expect(validateAttachmentFile(file('a', 'é'.repeat(126) + 'a.txt')).error).not.toBe('')
  for (const name of ['a/b.txt', 'a\\b.txt', 'a\u0000.txt'])
    expect(validateAttachmentFile(file('a', name)).error).not.toBe('')
})
it('hashes original bytes using SHA-256', async () => {
  vi.stubGlobal('crypto', webcrypto)
  expect(await hashAttachmentFile(file())).toBe(
    'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  )
})
