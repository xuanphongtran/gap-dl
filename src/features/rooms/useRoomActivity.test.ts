// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { begin, end, mock, mountFeature, settle } from '../notifications/notification-test-utils'
import { useRoomActivity } from './useRoomActivity'
import type { RoomTypingCommand } from '../../lib/realtime'
import type { RoomActivityScope } from './realtime-context'

const first = { roomId: 7, userId: 1, connectionEpoch: 1, roomEpoch: 1 }
let current: RoomActivityScope
beforeEach(() => {
  begin()
  current = first
  mock
    .onGet(/\/presence$/)
    .reply(200, { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [2] })
})
afterEach(end)
function setup() {
  const send = vi.fn<(scope: RoomActivityScope, command: RoomTypingCommand) => boolean>(() => true)
  const h = mountFeature(() => useRoomActivity({ isCurrent: (s) => s === current, send }))
  h.value.activate(current)
  const snapshot = (ids = [1, 2], typing: number[] = []) =>
    h.value.receive(current, {
      type: 'presence_snapshot',
      roomId: current.roomId,
      payload: { room_id: String(current.roomId), online_user_ids: ids, typing_user_ids: typing },
    })
  return { ...h, send, snapshot, a: h.value }
}
it('only this connection snapshot confirms readiness, HTTP and another tab do not', async () => {
  const { a, send, snapshot } = setup()
  a.input(true)
  a.receive(current, { type: 'presence', roomId: 7, payload: { user_id: 1, online: true } })
  await a.refresh()
  a.input(true)
  expect(send).not.toHaveBeenCalled()
  expect(a.state.value.phase).toBe('unknown')
  snapshot()
  expect(send).not.toHaveBeenCalled()
  a.input(true)
  expect(send).toHaveBeenCalledExactlyOnceWith(first, { type: 'typing_started', room_id: '7' })
})
it('deduplicates online users and expires each typing deadline without durable queries', async () => {
  const { a, snapshot } = setup()
  snapshot([1, 2, 3], [2])
  a.receive(current, { type: 'presence', roomId: 7, payload: { user_id: 2, online: true } })
  a.receive(current, {
    type: 'typing_started',
    roomId: 7,
    payload: { user_id: 3, expires_at: new Date(Date.now() + 9000).toISOString() },
  })
  expect(a.state.value.onlineUserIds).toEqual([1, 2, 3])
  expect(a.state.value.typingUserIds).toEqual([2, 3])
  await vi.advanceTimersByTimeAsync(5000)
  expect(a.state.value.typingUserIds).toEqual([])
  a.receive(current, {
    type: 'typing_started',
    roomId: 7,
    payload: { user_id: 3, expires_at: new Date(Date.now() - 1).toISOString() },
  })
  expect(a.state.value.typingUserIds).toEqual([])
  expect(mock.history.get).toHaveLength(0)
})
it('late_http_snapshot_cannot_restore_stopped_typing_or_revoked_scope', async () => {
  const { a, snapshot } = setup()
  snapshot([1, 2], [2])
  let resolve!: (v: [number, unknown]) => void
  mock.onGet(/\/presence$/).reply(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const pending = a.refresh()
  await settle()
  a.receive(current, {
    type: 'typing_stopped',
    roomId: 7,
    payload: { user_id: 2, expires_at: null },
  })
  resolve([200, { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [2] }])
  await pending
  expect(a.state.value.typingUserIds).toEqual([])
  await vi.advanceTimersByTimeAsync(2000)
  const late = a.refresh()
  await settle()
  a.pause()
  resolve([200, { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [2] }])
  await late
  expect(a.state.value.phase).toBe('unknown')
  expect(a.state.value.onlineUserIds).toEqual([])
})
it('schedules starts at 2000ms and one stop after 1500ms idle, never from restored draft', async () => {
  const { a, snapshot, send } = setup()
  snapshot()
  expect(send).not.toHaveBeenCalled()
  a.input(true)
  await vi.advanceTimersByTimeAsync(1000)
  a.input(true)
  await vi.advanceTimersByTimeAsync(1000)
  expect(send.mock.calls.map((c) => c[1].type)).toEqual(['typing_started', 'typing_started'])
  await vi.advanceTimersByTimeAsync(500)
  expect(send.mock.calls.map((c) => c[1].type)).toEqual([
    'typing_started',
    'typing_started',
    'typing_stopped',
  ])
  a.stop()
  a.input(false)
  expect(send).toHaveBeenCalledTimes(3)
})
it('preserves start floor across stop/start and room switches on the same connection', async () => {
  const { a, snapshot, send } = setup()
  snapshot()
  a.input(true)
  await vi.advanceTimersByTimeAsync(500)
  a.stop()
  current = { ...first, roomId: 8, roomEpoch: 2 }
  a.activate(current)
  snapshot()
  a.input(true)
  expect(send.mock.calls.filter((c) => c[1].type === 'typing_started')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1000)
  a.input(true)
  await vi.advanceTimersByTimeAsync(500)
  expect(send.mock.calls.filter((c) => c[1].type === 'typing_started')).toHaveLength(2)
  a.pause()
  current = { ...current, connectionEpoch: 2 }
  a.activate(current)
  snapshot()
  a.input(true)
  expect(send.mock.calls.filter((c) => c[1].type === 'typing_started')).toHaveLength(3)
})
it('queued_read_and_stop_never_borrow_replacement_account', async () => {
  const { a, snapshot, send } = setup()
  snapshot()
  a.input(true)
  await a.refresh()
  current = { ...first, userId: 9, connectionEpoch: 2 }
  a.stop()
  await vi.advanceTimersByTimeAsync(5000)
  await a.refresh()
  expect(send).toHaveBeenCalledTimes(1)
  expect(mock.history.get).toHaveLength(1)
})
it('hidden_or_disposed_timers_never_send and failed starts are not replayed', async () => {
  const { a, snapshot, send, app } = setup()
  snapshot()
  send.mockReturnValue(false)
  a.input(true)
  await vi.advanceTimersByTimeAsync(5000)
  expect(send).toHaveBeenCalledTimes(1)
  send.mockReturnValue(true)
  a.input(true)
  a.pause()
  const n = send.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(send).toHaveBeenCalledTimes(n)
  a.activate(current)
  snapshot()
  a.input(true)
  app.unmount()
  const after = send.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(send).toHaveBeenCalledTimes(after)
})
it('activity429_blocks_focus_and_repair_until_absolute_deadline', async () => {
  const { a, snapshot } = setup()
  snapshot()
  mock.onGet(/\/presence$/).reply(429, { error: 'Limited' }, { 'Retry-After': '8' })
  await Promise.all([a.refresh(), a.refresh()])
  expect(a.state.value.phase).toBe('unavailable')
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(2000)
    await a.refresh()
  }
  expect(mock.history.get).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2000)
  mock.onGet(/\/presence$/).reply(200, { room_id: '7', online_user_ids: [1], typing_user_ids: [] })
  await a.refresh()
  expect(mock.history.get).toHaveLength(2)
  expect(a.state.value.phase).toBe('ready')
})
