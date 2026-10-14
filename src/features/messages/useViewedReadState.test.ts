// @vitest-environment jsdom
import { onlineManager, VueQueryPlugin } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
import type { Message, ReadState } from '../../types'
import { useViewedReadState } from './useViewedReadState'

const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
function state(room: number, cursor = 0): ReadState {
  return { room_id: room, last_read_message_id: cursor, unread_count: 0 }
}
function message(id: number, room = 7): Message {
  return {
    id,
    room_id: room,
    user_id: 1,
    username: 'owner',
    content: 'Viewed text',
    created_at: '2026-10-14T00:00:00Z',
    revision: 1,
    edited_at: null,
    deleted_at: null,
  }
}
async function settle() {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  onlineManager.setOnline(true)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return {
      x: 0,
      y: 0,
      left: 0,
      right: 300,
      top: 0,
      bottom: this.hasAttribute('data-message-id') ? 20 : 400,
      width: 300,
      height: 400,
      toJSON: () => ({}),
    }
  })
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  for (const id of [7, 8, 9]) {
    queryClient.setQueryData(queryKeys.readState(id, 2), state(id))
    mock.onGet(`/api/v1/rooms/${id}/read-state`).reply(200, state(id))
  }
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
async function mount(cursor = 11) {
  const room = ref(7),
    user = ref<number | undefined>(2),
    enabled = ref(true)
  const messages = ref([message(cursor)])
  const list = ref<HTMLElement | null>(null)
  const lost = vi.fn()
  let reader!: ReturnType<typeof useViewedReadState>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      reader = useViewedReadState(room, user, enabled, list, messages, lost)
      return () =>
        h(
          'section',
          { ref: list },
          messages.value.map((m) => h('p', { 'data-message-id': m.id }, m.content)),
        )
    },
  })
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(host)
  await settle()
  return { room, user, enabled, messages, reader, lost }
}
function writes() {
  return mock.history.put.map((request) => ({
    room: request.url,
    cursor: JSON.parse(request.data).last_read_message_id,
    signal: request.signal,
  }))
}
function pendingWrites() {
  const pending = new Map<number, (response: [number, ReadState | { error: string }]) => void>()
  mock.onPut(/\/read-state$/).reply(
    (config) =>
      new Promise((resolve) => {
        pending.set(JSON.parse(config.data).last_read_message_id, resolve)
      }),
  )
  return pending
}

it('acknowledges only the final room after rapid switches within the debounce', async () => {
  mock
    .onPut(/\/read-state$/)
    .reply((config) => [200, state(9, JSON.parse(config.data).last_read_message_id)])
  const view = await mount()
  view.room.value = 8
  view.messages.value = [message(21, 8)]
  await settle()
  view.room.value = 9
  view.messages.value = [message(31, 9)]
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  await settle()
  expect(writes().map(({ room, cursor }) => ({ room, cursor }))).toEqual([
    { room: '/api/v1/rooms/9/read-state', cursor: 31 },
  ])
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7))
  expect(queryClient.getQueryData(queryKeys.readState(8, 2))).toEqual(state(8))
})

it('aborts an old room write and ignores its delayed denial after switching', async () => {
  const pending = pendingWrites()
  const view = await mount()
  await vi.advanceTimersByTimeAsync(500)
  expect(writes()).toHaveLength(1)
  view.room.value = 8
  view.messages.value = [message(21, 8)]
  await settle()
  expect(writes()[0]!.signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(500)
  pending.get(11)!([403, { error: 'Membership lost' }])
  pending.get(21)!([200, state(8, 21)])
  await settle()
  expect(view.lost).not.toHaveBeenCalled()
  expect(view.reader.error.value).toBe('')
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7))
  expect(queryClient.getQueryData(queryKeys.readState(8, 2))).toEqual(state(8, 21))
})

it('serializes acknowledgements and sends newly viewed messages after the pending write', async () => {
  const pending = pendingWrites()
  const view = await mount()
  await vi.advanceTimersByTimeAsync(500)
  view.messages.value = [message(12)]
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  expect(writes().map((w) => w.cursor)).toEqual([11])
  pending.get(11)!([200, state(7, 11)])
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  expect(writes().map((w) => w.cursor)).toEqual([11, 12])
  pending.get(12)!([200, state(7, 12)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7, 12))
})

it('does not let a stale write overwrite a later visit to the same room', async () => {
  const pending = pendingWrites()
  const view = await mount()
  await vi.advanceTimersByTimeAsync(500)
  view.room.value = 8
  view.messages.value = [message(21, 8)]
  await settle()
  view.room.value = 7
  view.messages.value = [message(12)]
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  pending.get(12)!([200, state(7, 12)])
  await settle()
  pending.get(11)!([200, state(7, 99)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7, 12))
  expect(writes().map((w) => w.cursor)).toEqual([11, 12])
})

it('keeps the greatest cursor when independent viewers finish writes out of order', async () => {
  const pending = pendingWrites()
  await mount(11)
  await mount(12)
  await vi.advanceTimersByTimeAsync(500)
  expect(writes().map((w) => w.cursor)).toEqual([11, 12])
  pending.get(12)!([200, state(7, 12)])
  await settle()
  pending.get(11)!([200, state(7, 11)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7, 12))
})

it('prevents a pending write from recreating private cache after membership loss', async () => {
  const pending = pendingWrites()
  const view = await mount()
  await vi.advanceTimersByTimeAsync(500)
  view.enabled.value = false
  queryClient.removeQueries({ queryKey: queryKeys.room(7) })
  pending.get(11)!([200, state(7, 11)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toBeUndefined()
  expect(writes()[0]!.signal?.aborted).toBe(true)
})

it('isolates an acknowledgement from a replaced account session', async () => {
  const pending = pendingWrites()
  const view = await mount()
  await vi.advanceTimersByTimeAsync(500)
  queryClient.setQueryData(queryKeys.readState(7, 3), state(7))
  view.user.value = 3
  view.messages.value = [message(21)]
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  pending.get(21)!([200, state(7, 21)])
  await settle()
  pending.get(11)!([200, state(7, 99)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7))
  expect(queryClient.getQueryData(queryKeys.readState(7, 3))).toEqual(state(7, 21))
})

it('does not apply a pending response to a replacement query with the same key', async () => {
  const pending = pendingWrites()
  await mount()
  await vi.advanceTimersByTimeAsync(500)
  queryClient.removeQueries({ queryKey: queryKeys.readState(7, 2), exact: true })
  queryClient.setQueryData(queryKeys.readState(7, 2), state(7, 55))
  pending.get(11)!([200, state(7, 99)])
  await settle()
  expect(queryClient.getQueryData(queryKeys.readState(7, 2))).toEqual(state(7, 55))
})
