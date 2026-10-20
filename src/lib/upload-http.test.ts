// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { afterEach, expect, it } from 'vitest'
import { ApiError, uploadAttachmentBytes, uploadHttp } from './http'
import { saveSession } from './session'
import type { AttachmentUploadTicket } from '../types'
let mock: MockAdapter
const ticket: AttachmentUploadTicket = {
  attachment: {
    id: 10,
    filename: 'a.txt',
    content_type: 'text/plain',
    size_bytes: 1,
    sha256: 'a'.repeat(64),
    verified: false,
    state: 'pending_upload',
    created_at: '',
    upload_expires_at: '',
    expires_at: null,
  },
  upload_url: 'https://storage.test/private?signature=private-secret',
  method: 'PUT',
  headers: {
    'Content-Type': 'text/plain',
    'If-None-Match': '*',
    'Content-Length': '1',
    Host: 'storage.test',
  },
}
afterEach(() => {
  mock?.restore()
  sessionStorage.clear()
})
it('uploads with progress/signal and required headers without API credentials', async () => {
  mock = new MockAdapter(uploadHttp)
  saveSession({ access_token: 'api-secret', refresh_token: 'refresh', expires_at: 0 })
  const signal = new AbortController().signal,
    progress: number[] = []
  mock.onPut().reply((c) => {
    expect(c.signal).toBe(signal)
    expect(c.withCredentials).toBe(false)
    expect(c.headers?.Authorization).toBeUndefined()
    expect(c.headers?.Host).toBeUndefined()
    expect(c.headers?.['Content-Length']).toBeUndefined()
    expect(c.headers?.['If-None-Match']).toBe('*')
    c.onUploadProgress?.({ loaded: 1, total: 1, bytes: 1, lengthComputable: true })
    return [200]
  })
  await uploadAttachmentBytes(ticket, new Blob(['a']), signal, (p) => progress.push(p))
  expect(progress.at(-1)).toBe(100)
})
it('sanitizes provider412/network errors and honors abort without retaining credentials', async () => {
  mock = new MockAdapter(uploadHttp)
  mock.onPut().replyOnce(412, 'private-secret')
  mock.onPut().networkError()
  for (let i = 0; i < 2; i++) {
    const error = await uploadAttachmentBytes(
      ticket,
      new Blob(['a']),
      new AbortController().signal,
      () => {},
    ).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(JSON.stringify(error)).not.toMatch(/signature|private-secret|api-secret/)
  }
  const controller = new AbortController()
  controller.abort()
  await expect(
    uploadAttachmentBytes(ticket, new Blob(['a']), controller.signal, () => {}),
  ).rejects.toBeInstanceOf(ApiError)
})
it.each([
  { ...ticket, method: 'POST' },
  { ...ticket, upload_url: 'http://storage.test/file' },
  { ...ticket, upload_url: 'https://user:pass@storage.test/file' },
])('rejects invalid tickets before transport', async (invalid) => {
  mock = new MockAdapter(uploadHttp)
  await expect(
    uploadAttachmentBytes(invalid, new Blob(['a']), new AbortController().signal, () => {}),
  ).rejects.toThrow()
  expect(mock.history.put).toHaveLength(0)
})
