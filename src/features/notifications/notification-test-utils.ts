import { createApp, h, nextTick, type VNode } from 'vue'
import { VueQueryPlugin, onlineManager } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient } from '../../lib/query'
import { saveSession } from '../../lib/session'
import type { Notification, Room } from '../../types'
export const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
export const room: Room = {
  id: 7,
  name: 'Private <room>',
  visibility: 'private',
  role: 'member',
  created_by: 1,
  created_at: '2026-10-14T00:00:00Z',
}
export function note(id: number): Notification {
  return {
    id,
    kind: 'mention',
    room_id: 7,
    message_id: id,
    created_at: '2026-10-14T00:00:00Z',
    read_at: null,
    availability: 'available',
  }
}
export async function settle() {
  for (let i = 0; i < 10; i++) {
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }
}
export function begin() {
  vi.useFakeTimers()
  onlineManager.setOnline(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [room] })
  mock.onGet('/api/v1/rooms/7').reply(200, room)
  mock.onGet('/api/v1/users/me').reply(200, {
    id: 1,
    username: 'owner',
    email: 'owner@example.com',
    created_at: room.created_at,
  })
  mock
    .onGet('/api/v1/users/me/notifications')
    .reply(200, { notifications: [note(3), note(2)], next_before: null })
  mock
    .onPut(/\/notifications\/\d+\/read$/)
    .reply((c) => [200, { ...note(Number(c.url!.split('/')[6])), read_at: '2026-10-14T01:00:00Z' }])
}
export function end() {
  apps.splice(0).forEach((a) => a.unmount())
  mock.reset()
  queryClient.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
}
export function mountFeature<T>(setup: () => T, render: (value: T) => VNode = () => h('p')) {
  let value!: T
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      value = setup()
      return () => render(value)
    },
  })
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(host)
  return { value, host, app }
}
