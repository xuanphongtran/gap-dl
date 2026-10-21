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
const snapshot = JSON.stringify({
  type: 'presence_snapshot',
  room_id: '7',
  payload: { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [] },
})
const starts = (socket: TestSocket) =>
  socket.sent.map((s) => JSON.parse(s)).filter((c) => c.type === 'typing_started')
it('requires own snapshot and reacknowledges after foreground without replay', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  h.context.typingInput(true)
  socket.message(
    JSON.stringify({ type: 'join', room_id: '7', payload: { user_id: 2, client_id: 'other' } }),
  )
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(0)
  socket.message(snapshot)
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(1)
  const joins = socket.sent.filter((s) => JSON.parse(s).type === 'join').length
  document.dispatchEvent(new Event('visibilitychange'))
  expect(h.context.activity.value.phase).toBe('unknown')
  await expect
    .poll(() => socket.sent.filter((s) => JSON.parse(s).type === 'join').length)
    .toBe(joins + 1)
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(1)
  socket.message(snapshot)
  expect(h.context.activity.value.phase).toBe('ready')
  expect(starts(socket)).toHaveLength(1)
})
it('presence_and_typing_burst_does_not_refetch_history_or_pause_composer', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  mock.resetHistory()
  for (let i = 0; i < 20; i++)
    socket.message(
      JSON.stringify({
        type: 'typing_started',
        room_id: '7',
        payload: { user_id: 1, expires_at: new Date(Date.now() + 5000).toISOString() },
      }),
    )
  await new Promise((r) => setTimeout(r, 160))
  expect(mock.history.get).toHaveLength(0)
  expect(h.paused.value).toBe(false)
  expect(h.context.activity.value.typingUserIds).toEqual([1])
})
it('invalid activity repairs only bounded presence reads while light recovery leaves read alive', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  mock.resetHistory()
  let resolve!: (v: [number, unknown]) => void
  let signal: AbortSignal | undefined
  mock.onGet('/api/v1/rooms/7/presence').reply((c) => {
    signal = c.signal as AbortSignal
    return new Promise((r) => {
      resolve = r
    })
  })
  socket.message(
    Array.from({ length: 5 }, () =>
      JSON.stringify({
        type: 'typing_started',
        room_id: '7',
        payload: { user_id: 1, expires_at: 'bad' },
      }),
    ).join('\n'),
  )
  await expect.poll(() => mock.history.get.length).toBe(1)
  socket.message(
    JSON.stringify({
      type: 'message',
      room_id: '7',
      payload: { ...message(2), mention_user_ids: [], attachments: [] },
    }),
  )
  await new Promise((r) => setTimeout(r, 160))
  expect(signal?.aborted).toBe(false)
  resolve([200, { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [] }])
  await expect.poll(() => h.context.activity.value.phase).toBe('ready')
  expect(mock.history.get.filter((c) => c.url?.endsWith('/presence'))).toHaveLength(1)
})
it('clears revoked activity before any snapshot in the same batch', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  socket.message(
    snapshot +
      '\n' +
      JSON.stringify({
        type: 'membership_changed',
        room_id: '7',
        payload: { action: 'removed', user_id: 2, actor_user_id: 1, role: 'member' },
      }),
  )
  expect(h.context.activity.value.onlineUserIds).toEqual([])
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(0)
})
it('same-token reconnect rejects old frames and requires the new connection snapshot', async () => {
  const h = setup(),
    old = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  old.message(snapshot)
  old.close(1006)
  h.context.retry()
  await expect.poll(() => TestSocket.instances.length).toBe(2)
  const next = TestSocket.instances[1]!
  next.open()
  await expect.poll(() => h.context.status.value).toBe('connected')
  old.message(snapshot)
  h.context.typingInput(true)
  expect(starts(next)).toHaveLength(0)
  next.message(snapshot)
  h.context.typingInput(true)
  expect(starts(next)).toHaveLength(1)
})
it('replacement account immediately before an action cannot borrow the open socket', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  saveSession({ access_token: 'replacement', refresh_token: 'other', expires_at: 0 })
  h.context.typingInput(true)
  h.context.stopTyping()
  expect(starts(socket)).toHaveLength(0)
})
it('not_joined reauthorizes activity once and rate feedback never refetches history', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  mock.resetHistory()
  const error = (code: string) =>
    JSON.stringify({ type: 'error', room_id: '7', payload: { code, message: 'untrusted' } })
  for (let i = 0; i < 5; i++) socket.message(error('not_joined'))
  await expect.poll(() => socket.sent.filter((s) => JSON.parse(s).type === 'join').length).toBe(2)
  expect(h.context.activity.value.phase).toBe('unknown')
  socket.message(snapshot)
  for (const code of ['authorization_pending', 'rate_limited']) socket.message(error(code))
  await new Promise((r) => setTimeout(r, 160))
  expect(mock.history.get).toHaveLength(0)
})
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
          room_id: 7,
          revision: 1,
          edited_at: null,
          deleted_at: null,
          mention_user_ids: [],
          attachments: [],
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
        room_id: 7,
        revision: 1,
        edited_at: null,
        deleted_at: null,
        mention_user_ids: [],
        attachments: [],
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

it('bridges from the last synchronized anchor even if polling already exposed a newer page', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  h.known.value = [message(1), message(46)]
  queryClient.setQueryData(queryKeys.latestMessages(7), [message(46)])
  server = Array.from({ length: 46 }, (_, i) => message(46 - i))
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => [
    200,
    {
      messages: server
        .filter((m) => config.params.before === undefined || m.id < config.params.before)
        .slice(0, 40),
    },
  ])
  socket.message(
    JSON.stringify({
      type: 'message',
      room_id: '7',
      payload: {
        id: 46,
        user_id: 1,
        username: 'owner',
        content: 'hint',
        created_at: '2026-10-14T00:00:00Z',
        room_id: 7,
        revision: 1,
        edited_at: null,
        deleted_at: null,
        mention_user_ids: [],
        attachments: [],
      },
    }),
  )
  await expect
    .poll(() => h.known.value.map((m) => m.id))
    .toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
})

it('keeps the active subscription when a late revocation concerns another room', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
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
  await expect
    .poll(() => socket.sent.map((s) => JSON.parse(s)))
    .toContainEqual({ type: 'join', room_id: '8' })
  socket.message(
    JSON.stringify({
      type: 'error',
      room_id: '7',
      payload: { code: 'membership_revoked', message: 'old room' },
    }),
  )
  h.context.registerRoom({
    id: 9,
    userId: 2,
    messages: () => [],
    setPaused: () => {},
    applyRecovered: () => {},
    reset: () => {},
    onAccessLost: () => {},
  })
  expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'leave', room_id: '8' })
})

it('retains the synchronized anchor when returning to a previously viewed room', async () => {
  const h = setup()
  await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  h.unregister()
  h.known.value = [message(1), message(46)]
  server = Array.from({ length: 46 }, (_, i) => message(46 - i))
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => [
    200,
    {
      messages: server
        .filter((m) => config.params.before === undefined || m.id < config.params.before)
        .slice(0, 40),
    },
  ])
  h.context.registerRoom({
    id: 7,
    userId: 2,
    messages: () => h.known.value,
    setPaused: (p) => {
      h.paused.value = p
    },
    applyRecovered: (m) => {
      h.known.value = m
    },
    reset: () => {},
    onAccessLost: () => {},
  })
  await expect
    .poll(() => h.known.value.map((m) => m.id))
    .toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
})

it('refreshes retained history and bridged ranges on subsequent recovery', async () => {
  server = Array.from({ length: 40 }, (_, i) => message(40 - i))
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => [
    200,
    {
      messages: server
        .filter((m) => config.params.before === undefined || m.id < config.params.before)
        .slice(0, 40),
    },
  ])
  const h = setup()
  h.known.value = [...server].reverse()
  queryClient.setQueryData(queryKeys.messageHistory(7), { pages: [server], pageParams: [null] })
  await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  server = Array.from({ length: 125 }, (_, i) => message(125 - i))
  h.context.retry()
  await expect.poll(() => h.known.value.length).toBe(125)
  server = server.map((m) =>
    m.id === 20
      ? { ...m, content: '', revision: 2, deleted_at: '2026-10-14T01:00:00Z' }
      : m.id === 65
        ? { ...m, content: 'Edited bridge', revision: 2 }
        : m,
  )
  h.context.retry()
  await expect.poll(() => h.context.status.value).toBe('connected')
  expect(h.known.value.find((m) => m.id === 20)?.deleted_at).toBe('2026-10-14T01:00:00Z')
  expect(h.known.value.find((m) => m.id === 65)?.content).toBe('Edited bridge')
})

it('does not cancel an unrelated room preference read during message reconciliation', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  let resolve!: (value: { muted: boolean }) => void
  let signal!: AbortSignal
  const pending = queryClient
    .fetchQuery({
      queryKey: queryKeys.roomNotificationPreferences(7, 2),
      queryFn: ({ signal: currentSignal }) => {
        signal = currentSignal
        return new Promise<{ muted: boolean }>((r) => (resolve = r))
      },
    })
    .then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    )
  await tick()
  expect(signal.aborted).toBe(false)
  server = [message(2), message(1)]
  socket.message(JSON.stringify({ type: 'message', room_id: '7', payload: { id: 2 } }))
  await expect.poll(() => h.known.value.some((row) => row.id === 2)).toBe(true)
  expect(signal.aborted).toBe(false)
  resolve({ muted: false })
  expect((await pending).value).toEqual({ muted: false })
})

it('initializes cancelled first history from the authorized recovered page', async () => {
  const h = setup()
  await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  expect(
    queryClient
      .getQueryData<{ pages: Message[][] }>(queryKeys.messageHistory(7))
      ?.pages.flat()
      .map((row) => row.id),
  ).toEqual([1])
})

it('hands fallback recovery to a new room when the previous recovery is still pending', async () => {
  const h = setup()
  await expect.poll(() => TestSocket.instances.length).toBe(1)
  let release!: (value: [number, object]) => void
  mock.onGet('/api/v1/rooms/7').reply(
    () =>
      new Promise<[number, object]>((r) => {
        release = r
      }),
  )
  TestSocket.instances[0]!.close(1006)
  await expect.poll(() => h.context.status.value).toBe('recovering')
  await expect.poll(() => mock.history.get.some((c) => c.url === '/api/v1/rooms/7')).toBe(true)
  h.unregister()
  const paused = ref(true)
  h.context.registerRoom({
    id: 8,
    userId: 2,
    messages: () => [],
    setPaused: (value) => {
      paused.value = value
    },
    applyRecovered: () => {},
    reset: () => {},
    onAccessLost: () => {},
  })
  try {
    await expect.poll(() => paused.value, { timeout: 500 }).toBe(false)
    expect(queryClient.getQueryData(queryKeys.latestMessages(8))).toEqual([])
    expect(h.context.status.value).toBe('fallback')
  } finally {
    release([200, room])
    await tick()
  }
})

it('lifecycle_update_refreshes_retained_older_page_and_search without reconnect', async () => {
  server = Array.from({ length: 85 }, (_, i) => message(85 - i))
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => [
    200,
    {
      messages: server
        .filter((m) => config.params?.before === undefined || m.id < config.params.before)
        .slice(0, 40),
    },
  ])
  const h = setup()
  h.known.value = [...server].reverse()
  queryClient.setQueryData(queryKeys.messageHistory(7), {
    pages: [server.slice(0, 40), server.slice(40, 80), server.slice(80)],
    pageParams: [null, 46, 6],
  })
  const socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  server = server.map((m) =>
    m.id === 2
      ? {
          ...m,
          user_id: null,
          content: '',
          revision: 2,
          deleted_at: '2026-10-20T01:00:00Z',
          attachments: [],
        }
      : m,
  )
  const changed = { ...server.find((m) => m.id === 2)!, mention_user_ids: [], attachments: [] }
  queryClient.setQueryData(queryKeys.searchMessages(7, 2, 'old'), { pages: [], pageParams: [] })
  mock.resetHistory()
  for (let i = 0; i < 4; i++)
    socket.message(JSON.stringify({ type: 'message_deleted', room_id: '7', payload: changed }))
  await expect.poll(() => h.known.value.find((m) => m.id === 2)?.revision).toBe(2)
  expect(h.known.value.find((m) => m.id === 2)?.content).toBe('')
  expect(queryClient.getQueryState(queryKeys.searchMessages(7, 2, 'old'))?.isInvalidated).toBe(true)
  expect(TestSocket.instances).toHaveLength(1)
  expect(mock.history.get.filter((c) => c.url?.endsWith('/members'))).toHaveLength(1)
})

it('repeated not_joined clears readiness during cooldown and repairs only the current room', async () => {
  const h = setup(),
    socket = await connected()
  await expect.poll(() => h.context.status.value).toBe('connected')
  socket.message(snapshot)
  const error = JSON.stringify({
    type: 'error',
    room_id: '7',
    payload: { code: 'not_joined', message: 'No subscription' },
  })
  socket.message(error)
  expect(socket.sent.filter((c) => JSON.parse(c).type === 'join')).toHaveLength(2)
  socket.message(snapshot)
  socket.message(error)
  expect(h.context.activity.value.phase).toBe('unknown')
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(0)
  await expect
    .poll(() => socket.sent.filter((c) => JSON.parse(c).type === 'join').length, { timeout: 3000 })
    .toBe(3)
  expect(h.context.activity.value.phase).toBe('unknown')
  socket.message(snapshot)
  h.context.typingInput(true)
  expect(starts(socket)).toHaveLength(1)
  socket.message(error)
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
  await expect
    .poll(
      () =>
        socket.sent.filter((c) => {
          const v = JSON.parse(c)
          return v.type === 'join' && v.room_id === '8'
        }).length,
    )
    .toBe(1)
  const previous = socket.sent.filter((c) => {
    const v = JSON.parse(c)
    return v.type === 'join' && v.room_id === '7'
  }).length
  await new Promise((r) => setTimeout(r, 2100))
  expect(
    socket.sent.filter((c) => {
      const v = JSON.parse(c)
      return v.type === 'join' && v.room_id === '7'
    }),
  ).toHaveLength(previous)
})
