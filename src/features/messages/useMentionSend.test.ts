// @vitest-environment jsdom
import { createApp, h, ref, nextTick } from 'vue'
import { VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient } from '../../lib/query'
import { saveSession } from '../../lib/session'
import { useMentionSend } from './useMentionSend'
import type { AttachmentSummary } from '../../types'
import { attachment } from '../attachments/attachment-test-utils'
const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
async function settle() {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  onlineManager.setOnline(true)
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 }, true)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-1234-1234-123456789012')
  mock.onPost().reply(201, { id: 9, room_id: 7 })
})
afterEach(() => {
  apps.splice(0).forEach((a) => a.unmount())
  queryClient.clear()
  mock.reset()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function mount() {
  const roomId = ref(7),
    userId = ref<number | undefined>(1),
    enabled = ref(true),
    draft = ref('  hello  '),
    members = ref(
      [2, 3].map((user_id) => ({
        user_id,
        room_id: 7,
        username: 'user' + user_id,
        role: 'member' as const,
        joined_at: '2026-10-14T00:00:00Z',
      })),
    ),
    success = vi.fn(),
    lost = vi.fn()
  const attachments = ref<AttachmentSummary[]>([]),
    attachmentsBlocked = ref(false),
    created = vi.fn(),
    settled = vi.fn()
  let send!: ReturnType<typeof useMentionSend>
  const app = createApp({
    setup() {
      send = useMentionSend({
        roomId,
        userId,
        enabled,
        draft,
        members,
        attachments,
        attachmentsBlocked,
        onIntentCreated: created,
        onIntentSettled: settled,
        onSuccess: success,
        onAccessLost: lost,
      })
      return () => h('p', send.error.value)
    },
  })
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(document.createElement('div'))
  return {
    send,
    roomId,
    userId,
    enabled,
    draft,
    members,
    success,
    lost,
    attachments,
    attachmentsBlocked,
    created,
    settled,
  }
}
it('retries an uncertain mention with the immutable original payload and key only on request', async () => {
  mock.resetHandlers()
  mock.onPost().networkErrorOnce()
  mock.onPost().reply(201, { id: 9, room_id: 7 })
  const h = mount()
  h.send.selectedIds.value = [3, 2, 3]
  await h.send.send()
  await settle()
  expect(mock.history.post).toHaveLength(1)
  expect(h.send.locked.value).toBe(true)
  h.send.selectedIds.value = [2]
  h.draft.value = 'changed'
  await h.send.retry()
  expect(mock.history.post).toHaveLength(2)
  expect(JSON.parse(mock.history.post[1]!.data)).toEqual({
    content: 'hello',
    mention_user_ids: [2, 3],
  })
  expect(mock.history.post[1]!.data).toBe(mock.history.post[0]!.data)
  expect(mock.history.post[1]!.headers?.['Idempotency-Key']).toBe(
    mock.history.post[0]!.headers?.['Idempotency-Key'],
  )
  expect(h.success).toHaveBeenCalledOnce()
  expect(h.draft.value).toBe('')
})
it.each([400, 413, 429])('keeps a definite %i rejection editable', async (status) => {
  mock.onPost().reply(status, { error: 'rejected' })
  const h = mount()
  h.send.selectedIds.value = [2]
  await h.send.send()
  expect(h.send.locked.value).toBe(false)
  expect(h.draft.value).toBe('  hello  ')
})
it('freezes conflicting keys and refuses retry after 24 hours', async () => {
  mock.onPost().reply(409, { error: 'conflict' })
  const h = mount()
  h.send.selectedIds.value = [2]
  await h.send.send()
  expect(h.send.locked.value).toBe(true)
  vi.setSystemTime(Date.now() + 86400000)
  await vi.advanceTimersByTimeAsync(1000)
  await h.send.retry()
  expect(mock.history.post).toHaveLength(1)
  expect(h.send.expired.value).toBe(true)
})
it('suppresses duplicate Enter and stale account completion', async () => {
  let resolve!: (v: [number, object]) => void
  mock.onPost().reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = mount()
  h.send.selectedIds.value = [2]
  const first = h.send.send()
  void h.send.send()
  await settle()
  expect(mock.history.post).toHaveLength(1)
  h.userId.value = 4
  h.draft.value = 'new account'
  resolve([201, { id: 9, room_id: 7 }])
  await first
  expect(h.draft.value).toBe('new account')
  expect(h.success).not.toHaveBeenCalled()
})
it('restores a pending snapshot in its room without carrying recipients to another room', async () => {
  mock.resetHandlers()
  mock.onPost().networkErrorOnce()
  mock.onPost().reply(201, { id: 9, room_id: 7 })
  const h = mount()
  h.send.selectedIds.value = [2]
  await h.send.send()
  h.roomId.value = 8
  await settle()
  expect(h.send.selectedIds.value).toEqual([])
  expect(h.send.locked.value).toBe(false)
  h.roomId.value = 7
  await settle()
  expect(h.send.locked.value).toBe(true)
  await h.send.retry()
  expect(mock.history.post[1]!.data).toBe(mock.history.post[0]!.data)
})
it('preserves pending intent on token refresh but clears it on explicit same-user login', async () => {
  mock.resetHandlers()
  mock.onPost().networkErrorOnce()
  mock.onPost().reply(201, { id: 9, room_id: 7 })
  const h = mount()
  h.send.selectedIds.value = [2]
  await h.send.send()
  saveSession({ access_token: 'new', refresh_token: 'new', expires_at: 0 })
  expect(h.send.locked.value).toBe(true)
  saveSession({ access_token: 'new', refresh_token: 'new', expires_at: 0 }, true)
  expect(h.send.locked.value).toBe(false)
  expect(h.send.selectedIds.value).toEqual([])
})
it('rejects removed recipients and oversized text without making a request', async () => {
  const h = mount()
  h.send.selectedIds.value = [8]
  await h.send.send()
  expect(mock.history.post).toHaveLength(0)
  h.send.selectedIds.value = [2]
  h.draft.value = '😀'.repeat(1001)
  await h.send.send()
  expect(mock.history.post).toHaveLength(0)
})
it('keeps literal at-names as plain text without retry metadata', async () => {
  const h = mount()
  h.draft.value = '@user2'
  await h.send.send()
  expect(JSON.parse(mock.history.post[0]!.data)).toEqual({ content: '@user2' })
  expect(mock.history.post[0]!.headers?.['Idempotency-Key']).toBeUndefined()
})

it('retains retry identity when an accepted response arrives during authorization recovery', async () => {
  let resolve!: (v: [number, object]) => void
  mock.onPost().reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = mount()
  h.send.selectedIds.value = [2]
  const pending = h.send.send()
  await settle()
  h.enabled.value = false
  resolve([201, { id: 9, room_id: 7 }])
  await pending
  expect(h.success).not.toHaveBeenCalled()
  expect(h.send.locked.value).toBe(true)
  h.enabled.value = true
  mock.onPost().reply(201, { id: 9, room_id: 7 })
  await h.send.retry()
  expect(mock.history.post[1]!.headers?.['Idempotency-Key']).toBe(
    mock.history.post[0]!.headers?.['Idempotency-Key'],
  )
  expect(h.success).toHaveBeenCalledOnce()
})

it.each([400, 413, 429])(
  'retains the original uncertain key after a rejected retry (%i)',
  async (status) => {
    mock.resetHandlers()
    mock.onPost().networkErrorOnce()
    mock.onPost().reply(status, { error: 'slow' }, { 'Retry-After': '60' })
    const h = mount()
    h.send.selectedIds.value = [2]
    await h.send.send()
    await h.send.retry()
    expect(h.send.locked.value).toBe(true)
  },
)

it('purges a pending send when its inactive room is revoked', async () => {
  const { clearRoomQueries } = await import('../../lib/query')
  mock.onPost().networkError()
  const h = mount()
  h.send.selectedIds.value = [2]
  await h.send.send()
  h.roomId.value = 8
  clearRoomQueries(7)
  h.roomId.value = 7
  await settle()
  expect(h.send.locked.value).toBe(false)
})

it('caption_file_mentions_retry_keeps_original_payload_and_key', async () => {
  mock.resetHandlers()
  mock.onPost().networkErrorOnce()
  mock.onPost().reply(201, { id: 9, room_id: 7 })
  const f = mount()
  f.draft.value = ' caption '
  f.attachments.value = [attachment(11), attachment(10)]
  f.send.selectedIds.value = [3, 2]
  await f.send.send()
  await settle()
  expect(mock.history.post).toHaveLength(1)
  expect(f.created).toHaveBeenCalledWith(7, [10, 11])
  expect(f.send.pendingAttachments.value.map((x) => x.id)).toEqual([10, 11])
  f.draft.value = 'different'
  f.attachments.value = []
  f.send.selectedIds.value = []
  await f.send.retry()
  expect(JSON.parse(mock.history.post[1]!.data)).toEqual({
    content: 'caption',
    mention_user_ids: [2, 3],
    attachment_ids: [10, 11],
  })
  expect(mock.history.post[1]!.headers?.['Idempotency-Key']).toBe(
    mock.history.post[0]!.headers?.['Idempotency-Key'],
  )
  expect(f.success).toHaveBeenCalledOnce()
  expect(f.settled).toHaveBeenCalledWith(7, [10, 11], 'sent')
})
it('definite_429_returns_ready_files_to_editable_batch', async () => {
  mock.onPost().reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  const f = mount()
  f.attachments.value = [attachment()]
  await f.send.send()
  expect(f.send.locked.value).toBe(false)
  expect(f.settled).toHaveBeenCalledWith(7, [10], 'editable')
  expect(f.draft.value).toBe('  hello  ')
})
it('room_return_restores_uncertain_file_snapshot and discard_uncertain_send_never_deletes_files', async () => {
  mock.onPost().networkError()
  const f = mount()
  f.attachments.value = [attachment()]
  await f.send.send()
  f.roomId.value = 8
  await settle()
  f.draft.value = 'other'
  f.attachments.value = []
  f.roomId.value = 7
  await settle()
  expect(f.send.pendingAttachments.value.map((a) => a.id)).toEqual([10])
  expect(f.draft.value).toBe('hello')
  f.send.discard()
  expect(f.settled).toHaveBeenCalledWith(7, [10], 'discarded')
  expect(mock.history.delete).toHaveLength(0)
})
it('invalid_caption_or_recipient_and_processing_never_claims_files', async () => {
  const f = mount()
  f.attachments.value = [attachment()]
  f.draft.value = ' '
  await f.send.send()
  f.draft.value = 'valid'
  f.send.selectedIds.value = [999]
  await f.send.send()
  f.send.selectedIds.value = []
  f.attachmentsBlocked.value = true
  await f.send.send()
  expect(f.created).not.toHaveBeenCalled()
  expect(mock.history.post).toHaveLength(0)
})
it('attachment404_preserves_caption_when_room_is_still_authorized', async () => {
  mock.onPost().reply(404, { error: 'File missing' })
  mock.onGet('/api/v1/rooms/7').reply(200, { id: 7, role: 'member' })
  const f = mount()
  f.attachments.value = [attachment()]
  await f.send.send()
  expect(f.lost).not.toHaveBeenCalled()
  expect(f.draft.value).toBe('  hello  ')
  expect(f.settled).toHaveBeenCalledWith(7, [10], 'editable')
})
