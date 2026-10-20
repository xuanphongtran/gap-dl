// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { afterEach, expect, it } from 'vitest'
import { api } from './api'
import { http } from './http'
import { saveSession } from './session'
const mock = new MockAdapter(http)
afterEach(() => {
  mock.reset()
  sessionStorage.clear()
})
it('uses exact owned attachment paths, immutable reservation metadata/key and abort signals', async () => {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  const signal = new AbortController().signal
  const body = {
    filename: 'a.txt',
    content_type: 'text/plain',
    size_bytes: 1,
    sha256: 'a'.repeat(64),
  }
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply((c) => {
    expect(c.signal).toBe(signal)
    expect(JSON.parse(c.data)).toEqual(body)
    expect(c.headers?.['Idempotency-Key']).toBe('original-upload-key')
    return [201, { attachment: { id: 10 } }]
  })
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, { id: 10 })
  mock.onPost('/api/v1/rooms/7/attachments/10/complete').reply(202, { id: 10, state: 'processing' })
  mock.onDelete('/api/v1/rooms/7/attachments/10').reply(204)
  mock
    .onGet('/api/v1/rooms/7/messages/9/attachments/10/download')
    .reply(200, { download_url: 'https://storage.test/file', expires_at: '2026-10-20T00:00:00Z' })
  await api.reserveAttachment(7, body, 'original-upload-key', signal)
  expect(await api.attachment(7, 10, signal)).toEqual({ id: 10 })
  expect(await api.completeAttachment(7, 10, signal)).toMatchObject({ state: 'processing' })
  expect(await api.cancelAttachment(7, 10, signal)).toBeUndefined()
  expect(await api.attachmentDownload(7, 9, 10, signal)).toHaveProperty('download_url')
  for (const c of [...mock.history.get, ...mock.history.post, ...mock.history.delete])
    expect(c.signal).toBe(signal)
})
it('preserves combined file/mention payload and omits file fields for legacy sends', async () => {
  mock.onPost().reply(201, { id: 9 })
  await api.sendMessage(7, 'caption', {
    mentionUserIds: [2, 3],
    attachmentIds: [10, 11],
    idempotencyKey: 'message-key',
  })
  expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
    content: 'caption',
    mention_user_ids: [2, 3],
    attachment_ids: [10, 11],
  })
  expect(mock.history.post[0]!.headers?.['Idempotency-Key']).toBe('message-key')
  await api.sendMessage(7, 'text')
  expect(JSON.parse(mock.history.post[1]!.data)).toEqual({ content: 'text' })
  await api.sendMessage(7, 'mention', {
    mentionUserIds: [2],
    attachmentIds: [],
    idempotencyKey: 'key',
  })
  expect(JSON.parse(mock.history.post[2]!.data)).toEqual({
    content: 'mention',
    mention_user_ids: [2],
  })
})
