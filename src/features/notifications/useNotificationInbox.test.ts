// @vitest-environment jsdom
import { ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotificationInbox } from './useNotificationInbox'
import { begin, end, mock, mountFeature, note, room, settle } from './notification-test-utils'
import { clearRoomQueries, queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
beforeEach(begin)
afterEach(end)
async function mount() {
  const userId = ref<number | undefined>(1),
    enabled = ref(true)
  const { value } = mountFeature(() => useNotificationInbox({ userId, enabled }))
  await settle()
  return { inbox: value, userId, enabled }
}
const gets = () => mock.history.get.filter((c) => c.url?.endsWith('/notifications'))
it('uses exclusive pages and refreshes asynchronously delivered notifications', async () => {
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply((c) => [
      200,
      c.params.before
        ? { notifications: [note(1)], next_before: null }
        : { notifications: [note(3), note(2)], next_before: 2 },
    ])
  const h = await mount()
  expect(h.inbox.rows.value.map((n) => n.id)).toEqual([3, 2])
  expect(gets()[0]!.params.limit).toBe(20)
  await h.inbox.loadMore()
  await settle()
  expect(h.inbox.rows.value.map((n) => n.id)).toEqual([3, 2, 1])
  expect(h.inbox.hasMore.value).toBe(false)
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(200, { notifications: [note(4)], next_before: null })
  await vi.advanceTimersByTimeAsync(5000)
  await settle()
  expect(h.inbox.rows.value.map((n) => n.id)).toEqual([4])
})
it('marks read explicitly without advancing room state and preserves it over stale GET', async () => {
  const h = await mount()
  await h.inbox.markRead(3)
  await settle()
  expect(h.inbox.rows.value.find((n) => n.id === 3)?.read_at).toBe('2026-10-14T01:00:00Z')
  expect(mock.history.put.map((c) => c.url)).toEqual(['/api/v1/users/me/notifications/3/read'])
  h.inbox.unreadOnly.value = true
  await settle()
  expect(gets().at(-1)!.params.unread_only).toBe(true)
  expect(h.inbox.rows.value.some((n) => n.id === 3)).toBe(false)
})
it('does not reveal discoverable public rooms without fresh membership', async () => {
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [{ ...room, visibility: 'public', role: null }] })
  const h = await mount()
  expect(h.inbox.rows.value).toEqual([])
  mock.onGet('/api/v1/rooms/7').reply(200, { ...room, visibility: 'public', role: null })
  expect(await h.inbox.authorizeRoom(7)).toBe(false)
})
it('gates poll, focus, invalidation and manual retry on the same 429 deadline', async () => {
  let attempts = 0
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(() =>
      ++attempts === 1
        ? [429, { error: 'slow' }, { 'Retry-After': '60' }]
        : [200, { notifications: [note(3)], next_before: null }],
    )
  const h = await mount()
  expect(gets()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(5000)
  window.dispatchEvent(new Event('focus'))
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(1) })
  await h.inbox.retry()
  await settle()
  expect(gets()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(55000)
  await settle()
  expect(gets()).toHaveLength(2)
})
it('cancels old pages and acknowledgements after account or filter changes', async () => {
  let resolve!: (v: [number, object]) => void
  mock
    .onPut(/\/notifications\/\d+\/read$/)
    .reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = await mount()
  const pending = h.inbox.markRead(3)
  await settle()
  h.userId.value = 2
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(200, { notifications: [note(9)], next_before: null })
  await settle()
  resolve([200, { ...note(3), read_at: '2026-10-14T01:00:00Z' }])
  await pending
  await settle()
  expect(h.inbox.rows.value.map((n) => n.id)).toEqual([9])
  expect(h.inbox.readingIds.value).toEqual([])
})
it('purges old membership pages and cannot reuse them after rejoin', async () => {
  const h = await mount()
  mock.onGet('/api/v1/users/me/notifications').reply(200, { notifications: [], next_before: null })
  clearRoomQueries(7)
  await settle()
  expect(h.inbox.rows.value).toEqual([])
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [room] })
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(200, { notifications: [note(9)], next_before: null })
  await h.inbox.retry()
  await settle()
  expect(h.inbox.rows.value.map((n) => n.id)).toEqual([9])
})
it('hides private rows while hidden and requires fresh verification after foreground', async () => {
  const h = await mount()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  const count = gets().length
  expect(h.inbox.rows.value).toEqual([])
  await vi.advanceTimersByTimeAsync(10000)
  expect(gets()).toHaveLength(count)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(h.inbox.rows.value).toEqual([])
  await settle()
  expect(h.inbox.rows.value).toHaveLength(2)
})
it('drops deferred feed results after explicit same-user login', async () => {
  let resolve!: (v: [number, object]) => void
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = await mount()
  const oldResolve = resolve
  saveSession({ access_token: 'new', refresh_token: 'new', expires_at: 0 }, true)
  oldResolve([200, { notifications: [note(3)], next_before: null }])
  await settle()
  expect(h.inbox.rows.value).toEqual([])
})

it('does not leave a row pending when its read completes after a filter change', async () => {
  let resolve!: (v: [number, object]) => void
  mock
    .onPut(/\/notifications\/\d+\/read$/)
    .reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = await mount()
  const pending = h.inbox.markRead(3)
  await settle()
  h.inbox.unreadOnly.value = true
  await settle()
  resolve([200, { ...note(3), read_at: '2026-10-14T01:00:00Z' }])
  await pending
  expect(h.inbox.readingIds.value).toEqual([])
})

it('cancels room authorization when account identity changes', async () => {
  let resolve!: (v: [number, object]) => void
  mock.onGet('/api/v1/rooms/7').reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = await mount()
  const pending = h.inbox.authorizeRoom(7)
  await settle()
  const signal = mock.history.get.find((c) => c.url === '/api/v1/rooms/7')?.signal
  h.userId.value = 2
  await settle()
  expect(signal?.aborted).toBe(true)
  resolve([200, room])
  expect(await pending).toBe(false)
})
