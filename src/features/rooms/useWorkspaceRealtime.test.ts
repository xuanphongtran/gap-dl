// @vitest-environment jsdom
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { clearSession, saveSession } from '../../lib/session'
import type { Message } from '../../types'
import { TestSocket } from './realtime-test-utils'
import { useWorkspaceRealtime } from './useWorkspaceRealtime'

const mock = new MockAdapter(http)
const scopes: ReturnType<typeof effectScope>[] = []
const room = {
  id: 7,
  name: 'Private',
  visibility: 'private',
  role: 'member',
  created_by: 1,
  created_at: '2026-10-14T00:00:00Z',
}
const profile = {
  id: 2,
  username: 'reader',
  email: 'reader@example.com',
  created_at: '2026-10-14T00:00:00Z',
}
function message(id: number): Message {
  return {
    id,
    room_id: 7,
    user_id: 1,
    username: 'owner',
    content: `Text ${id}`,
    created_at: '2026-10-14T00:00:00Z',
    revision: 1,
    edited_at: null,
    deleted_at: null,
  }
}
let server: Message[] = []
beforeEach(() => {
  vi.stubGlobal('WebSocket', TestSocket)
  TestSocket.instances = []
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  server = [message(1)]
  mock.onGet('/api/v1/users/me').reply(200, profile)
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [room] })
  mock.onGet('/api/v1/users/me/invitations').reply(200, { invitations: [] })
  mock.onGet('/api/v1/rooms/7').reply(200, room)
  mock.onGet('/api/v1/rooms/8').reply(200, { ...room, id: 8 })
  mock.onGet(/\/members$/).reply(200, { members: [] })
  mock.onGet('/api/v1/rooms/7/messages').reply(() => [200, { messages: server }])
  mock.onGet('/api/v1/rooms/8/messages').reply(200, { messages: [] })
  mock.onGet(/\/read-state$/).reply(200, { room_id: 7, last_read_message_id: 0, unread_count: 0 })
})
afterEach(() => {
  scopes.splice(0).forEach((s) => s.stop())
  mock.reset()
  queryClient.clear()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const context = scope.run(() => useWorkspaceRealtime())!
  const paused = ref(false),
    revoked = ref(false),
    known = ref([message(1)])
  queryClient.setQueryData(queryKeys.latestMessages(7), known.value)
  const unregister = context.registerRoom({
    id: 7,
    userId: 2,
    messages: () => known.value,
    setPaused: (value) => {
      paused.value = value
    },
    applyRecovered: (value) => {
      known.value = value
    },
    reset: () => {
      known.value = []
    },
    onAccessLost: () => {
      revoked.value = true
    },
  })
  return { context, paused, revoked, known, unregister, scope }
}
async function connected() {
  await expect.poll(() => TestSocket.instances.length).toBe(1)
  const socket = TestSocket.instances[0]!
  socket.open()
  return socket
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
it('uses events to refresh authoritative messages and coalesces bursts', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'join', room_id: '7' })
  server = [message(2), message(1)]
  mock.resetHistory()
  for (let i = 0; i < 8; i++)
    socket.message(
      JSON.stringify({
        type: 'message',
        room_id: '7',
        payload: {
          id: 2,
          user_id: 1,
          username: 'owner',
          content: 'not authoritative',
          created_at: '2026-10-14T00:00:00Z',
        },
      }),
    )
  await expect.poll(() => h.known.value.map((m) => m.id)).toEqual([1, 2])
  expect(h.known.value.at(-1)?.content).toBe('Text 2')
  expect(mock.history.get.filter((c) => c.url?.endsWith('/messages')).length).toBeLessThanOrEqual(2)
})
it('revokes before a preceding message in the same batch and clears all private cache', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  queryClient.setQueryData(queryKeys.messageHistory(7), {
    pages: [[message(1)]],
    pageParams: [null],
  })
  socket.message(
    JSON.stringify({
      type: 'message',
      room_id: '7',
      payload: {
        id: 2,
        user_id: 1,
        username: 'owner',
        content: 'untrusted',
        created_at: '2026-10-14T00:00:00Z',
      },
    }) +
      '\n' +
      JSON.stringify({
        type: 'membership_changed',
        room_id: '7',
        payload: { action: 'removed', user_id: 2, actor_user_id: 1, role: 'member' },
      }),
  )
  expect(h.revoked.value).toBe(true)
  expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
  expect(queryClient.getQueryData(queryKeys.messageHistory(7))).toBeUndefined()
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
})
it('handles malformed and undocumented events with bounded reconciliation', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  mock.resetHistory()
  for (let i = 0; i < 8; i++)
    socket.message(
      JSON.stringify({ type: 'presence_snapshot', room_id: '7', payload: { unknown: 'state' } }),
    )
  await new Promise((resolve) => setTimeout(resolve, 180))
  expect(TestSocket.instances).toHaveLength(1)
  expect(mock.history.get.filter((c) => c.url === '/api/v1/rooms/7').length).toBeLessThanOrEqual(1)
  socket.message('{bad json')
  expect(h.paused.value).toBe(true)
  await expect.poll(() => h.paused.value).toBe(false)
})
it('invalidates invitations without fetching unauthorized room details', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  queryClient.setQueryData(queryKeys.invitations, { invitations: [] })
  mock.resetHistory()
  socket.message(
    JSON.stringify({
      type: 'invitation',
      room_id: '999',
      payload: { invitation_id: 4, action: 'created', status: 'pending' },
    }),
  )
  await expect
    .poll(() => queryClient.getQueryState(queryKeys.invitations)?.isInvalidated)
    .toBe(true)
  expect(mock.history.get.some((c) => c.url === '/api/v1/rooms/999')).toBe(false)
})
it('denies subscriptions when REST no longer grants membership', async () => {
  mock.onGet('/api/v1/rooms/7').reply(200, { ...room, role: null })
  const h = setup()
  const socket = await connected()
  await expect.poll(() => h.revoked.value).toBe(true)
  expect(socket.sent.map((s) => JSON.parse(s))).not.toContainEqual({ type: 'join', room_id: '7' })
})
it('ignores late results and socket callbacks after an account change', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  let release!: (value: [number, unknown]) => void
  mock.onGet('/api/v1/rooms/7/messages').reply(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  socket.message('{malformed')
  await expect.poll(() => !!release).toBe(true)
  clearSession()
  queryClient.clear()
  saveSession({ access_token: 'new-account', refresh_token: 'new-refresh', expires_at: 0 })
  release([200, { messages: [message(99)] }])
  socket.message(
    JSON.stringify({
      type: 'error',
      room_id: '7',
      payload: { code: 'membership_revoked', message: 'stale' },
    }),
  )
  await tick()
  await tick()
  expect(h.known.value.some((m) => m.id === 99)).toBe(false)
  expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
  expect(socket.readyState).toBe(3)
})
it('does not replay a stale join after a rapid room switch', async () => {
  const h = setup()
  h.unregister()
  h.context.registerRoom({
    id: 8,
    userId: 2,
    messages: () => [],
    setPaused: () => {},
    applyRecovered: () => {},
    reset: () => {},
    onAccessLost: () => {},
  })
  const socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'join', room_id: '8' })
  expect(socket.sent.map((s) => JSON.parse(s))).not.toContainEqual({ type: 'join', room_id: '7' })
})
it('recovers after drain 1001 and intentionally stops after logout', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.close(1001)
  expect(h.paused.value).toBe(true)
  await expect.poll(() => TestSocket.instances.length, { timeout: 3500 }).toBe(2)
  TestSocket.instances[1]!.open()
  await expect.poll(() => h.paused.value).toBe(false)
  clearSession()
  await new Promise((resolve) => setTimeout(resolve, 1300))
  expect(TestSocket.instances).toHaveLength(2)
  expect(TestSocket.instances[1]!.readyState).toBe(3)
})
it('stops retrying after five failures and retries only when explicitly requested', async () => {
  const h = setup()
  await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  for (let i = 0; i < 6; i++) {
    TestSocket.instances.at(-1)!.close(1006)
    await vi.advanceTimersByTimeAsync(30000)
    await Promise.resolve()
  }
  expect(TestSocket.instances).toHaveLength(6)
  expect(h.context.status.value).toBe('fallback')
  await vi.advanceTimersByTimeAsync(90000)
  expect(TestSocket.instances).toHaveLength(6)
  h.context.retry()
  await vi.advanceTimersByTimeAsync(0)
  expect(TestSocket.instances).toHaveLength(7)
})
it('pauses reconnect offline and cleans up on unmount', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  socket.close(1006)
  expect(h.context.status.value).toBe('offline')
  await new Promise((resolve) => setTimeout(resolve, 1300))
  expect(TestSocket.instances).toHaveLength(1)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await expect.poll(() => TestSocket.instances.length).toBe(2)
  h.scope.stop()
  await new Promise((resolve) => setTimeout(resolve, 1300))
  expect(TestSocket.instances).toHaveLength(2)
  expect(TestSocket.instances[1]!.readyState).toBe(3)
})

it('reopens with a refreshed token while keeping the same room registration', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  saveSession({ access_token: 'fresh-token', refresh_token: 'refresh', expires_at: 0 })
  expect(socket.readyState).toBe(3)
  expect(h.paused.value).toBe(true)
  await expect.poll(() => TestSocket.instances.length).toBe(2)
  const next = TestSocket.instances[1]!
  expect(new URL(next.url).searchParams.get('token')).toBe('fresh-token')
  next.open()
  await expect.poll(() => h.paused.value).toBe(false)
  expect(next.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'join', room_id: '7' })
  socket.message(
    JSON.stringify({
      type: 'error',
      room_id: '7',
      payload: { code: 'membership_revoked', message: 'old token' },
    }),
  )
  expect(h.revoked.value).toBe(false)
})

it('discards a delayed room authorization result after switching rooms', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  let release!: (value: [number, unknown]) => void
  mock.onGet('/api/v1/rooms/7').reply(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  socket.message('{malformed')
  await expect.poll(() => !!release).toBe(true)
  h.unregister()
  const newMessages = ref<Message[]>([])
  h.context.registerRoom({
    id: 8,
    userId: 2,
    messages: () => newMessages.value,
    setPaused: () => {},
    applyRecovered: (m) => {
      newMessages.value = m
    },
    reset: () => {},
    onAccessLost: () => {},
  })
  release([200, room])
  await expect
    .poll(() => socket.sent.map((s) => JSON.parse(s)))
    .toContainEqual({ type: 'join', room_id: '8' })
  expect(
    socket.sent.map((s) => JSON.parse(s)).filter((s) => s.type === 'join' && s.room_id === '7'),
  ).toHaveLength(1)
  expect(queryClient.getQueryData(queryKeys.room(7))).toEqual(room)
  expect(newMessages.value).toEqual([])
})

it('preserves same-account registration when the refresh token rotates', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  saveSession({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_at: 0 })
  expect(socket.readyState).toBe(3)
  await expect.poll(() => TestSocket.instances.length).toBe(2)
  const next = TestSocket.instances[1]!
  next.open()
  await expect.poll(() => h.paused.value).toBe(false)
  expect(next.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'join', room_id: '7' })
})

it('clears the active private room immediately for an explicit account switch', async () => {
  const h = setup()
  await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  saveSession(
    { access_token: 'other-account', refresh_token: 'other-refresh', expires_at: 0 },
    true,
  )
  expect(h.revoked.value).toBe(true)
  expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
})
