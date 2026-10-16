// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { queryClient, queryKeys } from '../../lib/query'
import { begin, end, mock, settle } from '../notifications/notification-test-utils'
import { TestSocket } from './realtime-test-utils'
import RoomWorkspace from './RoomWorkspace.vue'
let app: ReturnType<typeof createApp>
beforeEach(() => {
  begin()
  vi.stubGlobal('WebSocket', TestSocket)
  TestSocket.instances = []
  mock
    .onGet('/api/v1/rooms/7/read-state')
    .reply(200, { room_id: 7, last_read_message_id: 0, unread_count: 0 })
  mock.onGet('/api/v1/users/me/invitations').reply(200, { invitations: [] })
})
afterEach(() => {
  app?.unmount()
  end()
  vi.unstubAllGlobals()
})
it('read_recovery_preserves_action_error', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app', component: RoomWorkspace },
      { path: '/login', component: { render: () => h('p') } },
    ],
  })
  await router.push('/app')
  app = createApp(RouterView)
  const host = document.createElement('div')
  document.body.append(host)
  app.use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount(host)
  await settle()
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
  button('↳ Join with a room ID').click()
  await settle()
  const input = host.querySelector<HTMLInputElement>('input[type=number]')!
  input.value = '9'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  mock.onPost('/api/v1/rooms/9/join').reply(403, { error: 'forbidden' })
  button('JOIN ROOM').click()
  await settle()
  expect(host.textContent).toContain('You do not have permission')
  mock.onGet('/api/v1/rooms').reply(503, { error: 'unavailable' })
  void queryClient.refetchQueries({ queryKey: queryKeys.rooms, exact: true })
  await settle()
  await vi.advanceTimersByTimeAsync(1500)
  await settle()
  expect(host.textContent).toContain('temporarily unavailable')
  expect(button('RETRY WORKSPACE')).toBeDefined()
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [] })
  button('RETRY WORKSPACE').click()
  await settle()
  expect(host.textContent).not.toContain('temporarily unavailable')
  expect(host.textContent).toContain('You do not have permission')
  expect(mock.history.post).toHaveLength(1)
})
