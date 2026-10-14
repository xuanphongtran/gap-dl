// @vitest-environment jsdom
import { VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import { createApp, h, ref, nextTick } from 'vue'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
import type { Message, SearchMessagesResponse } from '../../types'
import { useRoomMessageSearch } from './useRoomMessageSearch'

const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
function message(id: number, room = 7): Message {
  return {
    id,
    room_id: room,
    user_id: 1,
    username: 'owner',
    content: 'hello match',
    revision: 1,
    created_at: '2026-10-14T00:00:00Z',
    edited_at: null,
    deleted_at: null,
  }
}
function page(ids: number[], next: number | null = null, room = 7): SearchMessagesResponse {
  return { messages: ids.map((id) => message(id, room)), next_before: next }
}
async function settle() {
  for (let i = 0; i < 8; i++) {
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  onlineManager.setOnline(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  mock
    .onGet(/\/messages\/search$/)
    .reply((config) => [200, page([3, 2], null, Number(config.url!.split('/')[4]))])
})
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  queryClient.clear()
  mock.reset()
  sessionStorage.clear()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function mount() {
  const roomId = ref(7),
    userId = ref<number | undefined>(2),
    open = ref(true),
    enabled = ref(true),
    knownMessages = ref<Message[]>([]),
    lost = vi.fn()
  let search!: ReturnType<typeof useRoomMessageSearch>
  const app = createApp({
    setup() {
      search = useRoomMessageSearch({
        roomId,
        userId,
        open,
        enabled,
        knownMessages,
        onAccessLost: lost,
      })
      return () => h('p', search.results.value.map((m) => m.content).join(','))
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(host)
  await settle()
  return { search, roomId, userId, open, enabled, knownMessages, lost }
}
async function submit(h: Awaited<ReturnType<typeof mount>>, text = 'hello') {
  h.search.input.value = text
  h.search.submit()
  await settle()
}
function requests() {
  return mock.history.get.filter((c) => c.url?.endsWith('/search'))
}
function delay() {
  let resolve!: (response: [number, SearchMessagesResponse | { error: string }]) => void
  const pending = new Promise<[number, SearchMessagesResponse | { error: string }]>(
    (r) => (resolve = r),
  )
  mock.onGet(/\/messages\/search$/).reply(() => pending)
  return resolve
}

it('submits trimmed text explicitly and preserves valid results on invalid input', async () => {
  const h = await mount()
  h.search.input.value = 'typing'
  await settle()
  expect(requests()).toHaveLength(0)
  await submit(h, '  hello  ')
  expect(requests()[0]?.params).toEqual({ q: 'hello', limit: 20 })
  expect(h.search.results.value.map((m) => m.id)).toEqual([3, 2])
  await submit(h, 'á'.repeat(129))
  expect(requests()).toHaveLength(1)
  expect(h.search.validationError.value).not.toBe('')
  expect(h.search.submitted.value).toBe('hello')
  expect(h.search.results.value).toHaveLength(2)
  expect(location.search).toBe('')
  expect(sessionStorage.getItem('search')).toBeNull()
})
it('uses server cursors, deduplicates overlap and resets pages on query change', async () => {
  mock
    .onGet(/\/messages\/search$/)
    .reply((config) => [200, config.params.before === undefined ? page([3, 2], 2) : page([1])])
  const h = await mount()
  await submit(h)
  expect(h.search.hasMore.value).toBe(true)
  await h.search.loadMore()
  await settle()
  expect(requests()[1]?.params.before).toBe(2)
  expect(h.search.results.value.map((m) => m.id)).toEqual([3, 2, 1])
  expect(h.search.hasMore.value).toBe(false)
  await submit(h, 'other')
  expect(requests().at(-1)?.params.before).toBeUndefined()
  expect(h.search.results.value.map((m) => m.id)).toEqual([3, 2])
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('rejects a nonadvancing cursor and exposes safe retry instead of looping', async () => {
  mock
    .onGet(/\/messages\/search$/)
    .reply((config) => [200, config.params.before === undefined ? page([3, 2], 2) : page([1], 2)])
  const h = await mount()
  await submit(h)
  await h.search.loadMore()
  await settle()
  expect(h.search.error.value).not.toBe('')
  expect(h.search.results.value).toEqual([])
  await h.search.loadMore()
  await settle()
  expect(requests()).toHaveLength(2)
})
it('cancels and gates recovery until a fresh successful response', async () => {
  const h = await mount()
  await submit(h)
  h.enabled.value = false
  await settle()
  expect(h.search.results.value).toEqual([])
  const resolve = delay()
  h.enabled.value = true
  await settle()
  expect(h.search.results.value).toEqual([])
  expect(h.search.pending.value).toBe(true)
  resolve([200, page([5])])
  await settle()
  expect(h.search.results.value.map((m) => m.id)).toEqual([5])
})
it('does not redisplay prior snippets when recovery validation fails', async () => {
  const h = await mount()
  await submit(h)
  h.enabled.value = false
  await settle()
  mock.onGet(/\/messages\/search$/).reply(503, { error: 'private backend detail' })
  h.enabled.value = true
  await settle()
  expect(h.search.results.value).toEqual([])
  expect(h.search.error.value).not.toContain('private backend detail')
  expect(h.search.error.value).not.toBe('')
})
it('ignores a delayed denial from another room and aborts its signal', async () => {
  const resolve = delay()
  const h = await mount()
  await submit(h)
  h.roomId.value = 8
  await settle()
  expect(requests()[0]?.signal?.aborted).toBe(true)
  expect(h.search.submitted.value).toBe('')
  resolve([404, { error: 'old room' }])
  await settle()
  expect(h.lost).not.toHaveBeenCalled()
  expect(h.search.error.value).toBe('')
  mock.onGet(/\/messages\/search$/).reply(200, page([9], null, 8))
  await submit(h)
  expect(h.search.results.value.map((m) => m.room_id)).toEqual([8])
})
it('isolates pending responses from account and submitted-query changes', async () => {
  const resolve = delay()
  const h = await mount()
  await submit(h)
  h.userId.value = 3
  await settle()
  expect(h.search.submitted.value).toBe('')
  mock.onGet(/\/messages\/search$/).reply(200, page([8]))
  await submit(h, 'other')
  resolve([200, page([99])])
  await settle()
  expect(h.search.results.value.map((m) => m.id)).toEqual([8])
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('clears and cancels a next page without reopening when it completes', async () => {
  mock.onGet(/\/messages\/search$/).reply(200, page([3, 2], 2))
  const h = await mount()
  await submit(h)
  const resolve = delay()
  const pending = h.search.loadMore()
  await settle()
  h.open.value = false
  await settle()
  expect(requests().at(-1)?.signal?.aborted).toBe(true)
  resolve([200, page([1])])
  await pending
  await settle()
  expect(h.search.results.value).toEqual([])
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('does not apply a response to a replaced cache entry with the same key', async () => {
  const resolve = delay()
  const h = await mount()
  await submit(h)
  const key = queryKeys.searchMessages(7, 2, 'hello')
  queryClient.removeQueries({ queryKey: key, exact: true })
  queryClient.setQueryData(key, { pages: [page([8])], pageParams: [undefined] })
  resolve([200, page([99])])
  await settle()
  expect(h.search.results.value).not.toContainEqual(message(99))
  expect(queryClient.getQueryData(key)).toEqual({ pages: [page([8])], pageParams: [undefined] })
})
it('polls only visible authorized search every five seconds', async () => {
  const h = await mount()
  await submit(h)
  await vi.advanceTimersByTimeAsync(4999)
  expect(requests()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  await settle()
  expect(requests()).toHaveLength(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  await vi.advanceTimersByTimeAsync(10000)
  expect(requests()).toHaveLength(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  expect(requests()).toHaveLength(3)
})
it('reconciles loaded pages when a matching message is edited out or deleted', async () => {
  let changed = false
  mock
    .onGet(/\/messages\/search$/)
    .reply((c) => [
      200,
      c.params.before === undefined
        ? changed
          ? page([4], 4)
          : page([4, 3], 3)
        : changed
          ? page([])
          : page([2, 1]),
    ])
  const h = await mount()
  await submit(h)
  await h.search.loadMore()
  await settle()
  expect(h.search.results.value).toHaveLength(4)
  changed = true
  await queryClient.invalidateQueries({ queryKey: queryKeys.messageSearch(7) })
  await settle()
  expect(h.search.results.value.map((m) => m.id)).toEqual([4])
})
it('suppresses old matching text with newer canonical revisions and tombstones', async () => {
  const h = await mount()
  await submit(h)
  h.knownMessages.value = [
    { ...message(3), revision: 2, content: 'edited out' },
    { ...message(2), revision: 2, deleted_at: '2026-10-14T01:00:00Z', content: '' },
  ]
  await settle()
  expect(h.search.results.value).toEqual([])
})
it('routes only current access denials to room cleanup', async () => {
  mock.onGet(/\/messages\/search$/).reply(403, { error: 'denied' })
  const h = await mount()
  await submit(h)
  expect(h.lost).toHaveBeenCalledExactlyOnceWith(7)
})
it('honors Search-only rate limit before explicit retry', async () => {
  mock.onGet(/\/messages\/search$/).reply(429, { error: 'limited' }, { 'Retry-After': '2' })
  const h = await mount()
  await submit(h)
  expect(h.search.retryAfter.value).toBe(2)
  await h.search.retry()
  expect(requests()).toHaveLength(1)
  mock.onGet(/\/messages\/search$/).reply(200, page([5]))
  await vi.advanceTimersByTimeAsync(2000)
  await h.search.retry()
  await settle()
  expect(h.search.results.value.map((m) => m.id)).toEqual([5])
})

it('rejects a pending response and error after changing the submitted query', async () => {
  const resolve = delay()
  const h = await mount()
  await submit(h, 'first')
  mock.onGet(/\/messages\/search$/).reply(200, page([8]))
  await submit(h, 'second')
  resolve([403, { error: 'old query denied' }])
  await settle()
  expect(h.search.results.value.map((m) => m.id)).toEqual([8])
  expect(h.lost).not.toHaveBeenCalled()
  expect(h.search.error.value).toBe('')
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'first'))).toBeUndefined()
})

it('recovers verification when an external room cancellation interrupts a resumed search', async () => {
  const h = await mount()
  await submit(h)
  h.enabled.value = false
  await settle()
  const resolve = delay()
  h.enabled.value = true
  await settle()
  await queryClient.cancelQueries({ queryKey: queryKeys.room(7) })
  mock.onGet(/\/messages\/search$/).reply(200, page([5]))
  await queryClient.invalidateQueries({ queryKey: queryKeys.messageSearch(7) })
  resolve([200, page([99])])
  await settle()
  expect(h.search.pending.value).toBe(false)
  expect(h.search.results.value.map((m) => m.id)).toEqual([5])
})

it('blocks polling and invalidation during a long Retry-After and resumes after expiry', async () => {
  mock.onGet(/\/messages\/search$/).reply(429, { error: 'limited' }, { 'Retry-After': '60' })
  const h = await mount()
  await submit(h)
  await vi.advanceTimersByTimeAsync(5000)
  await settle()
  expect(requests()).toHaveLength(1)
  expect(h.search.retryAfter.value).toBe(55)
  await queryClient.invalidateQueries({ queryKey: queryKeys.messageSearch(7) })
  await settle()
  expect(requests()).toHaveLength(1)
  mock.onGet(/\/messages\/search$/).reply(200, page([5]))
  await vi.advanceTimersByTimeAsync(55000)
  await settle()
  expect(h.search.retryAfter.value).toBe(0)
  expect(h.search.results.value.map((m) => m.id)).toEqual([5])
})
