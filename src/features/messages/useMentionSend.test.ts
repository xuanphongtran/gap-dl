// @vitest-environment jsdom
import { createApp, h, ref, nextTick } from 'vue'
import { VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient } from '../../lib/query'
import { saveSession } from '../../lib/session'
import { useMentionSend } from './useMentionSend'
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
  let send!: ReturnType<typeof useMentionSend>
  const app = createApp({
    setup() {
      send = useMentionSend({
        roomId,
        userId,
        enabled,
        draft,
        members,
        onSuccess: success,
        onAccessLost: lost,
      })
      return () => h('p', send.error.value)
    },
  })
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(document.createElement('div'))
  return { send, roomId, userId, enabled, draft, members, success, lost }
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
