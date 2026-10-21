// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { onlineManager, VueQueryPlugin } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient } from '../../lib/query'
import { saveSession } from '../../lib/session'
import type { Message } from '../../types'
import { TestSocket } from '../rooms/realtime-test-utils'
import RoomWorkspace from '../rooms/RoomWorkspace.vue'
import RoomChat from './RoomChat.vue'

const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
let server: Message[] = []
function message(id: number): Message {
  return {
    id,
    room_id: 7,
    user_id: 1,
    username: 'owner',
    content: `Private ${id}`,
    created_at: '2026-10-14T00:00:00Z',
    revision: 1,
    edited_at: null,
    deleted_at: null,
  }
}
beforeEach(() => {
  onlineManager.setOnline(true)
  vi.stubGlobal('WebSocket', TestSocket)
  TestSocket.instances = []
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  server = [message(1)]
  mock.onGet('/api/v1/users/me').reply(200, {
    id: 2,
    username: 'reader',
    email: 'reader@example.com',
    created_at: '2026-10-14T00:00:00Z',
  })
  const room = {
    id: 7,
    name: 'Private room',
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: '2026-10-14T00:00:00Z',
  }
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [room] })
  mock.onGet('/api/v1/rooms/7').reply(200, room)
  mock.onGet('/api/v1/users/me/invitations').reply(200, { invitations: [] })
  mock.onGet('/api/v1/rooms/7/members').reply(200, {
    members: [1, 2].map((id) => ({
      room_id: 7,
      user_id: id,
      username: id === 1 ? 'owner' : 'reader',
      role: 'member',
      joined_at: '2026-10-20T00:00:00Z',
    })),
  })
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => [
    200,
    {
      messages: server
        .filter((m) => config.params?.before === undefined || m.id < config.params.before)
        .slice(0, 40),
    },
  ])
  mock
    .onGet('/api/v1/rooms/7/read-state')
    .reply(200, { room_id: 7, last_read_message_id: 0, unread_count: 0 })
  mock
    .onPut('/api/v1/rooms/7/read-state')
    .reply(200, { room_id: 7, last_read_message_id: 1, unread_count: 0 })
})
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  mock.reset()
  queryClient.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function mount() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/app',
        component: RoomWorkspace,
        children: [
          { path: 'rooms/:id', component: RoomChat },
          { path: '', component: { template: '<p>Choose a room</p>' } },
          { path: 'settings', component: { template: '<p>Settings</p>' } },
        ],
      },
    ],
  })
  await router.push('/app/rooms/7')
  await router.isReady()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(RouterView) })
  apps.push(app)
  app.use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount(host)
  await expect.poll(() => TestSocket.instances.length).toBe(1)
  const socket = TestSocket.instances[0]!
  socket.open()
  await expect.poll(() => host.textContent).toContain('Private 1')
  return { host, socket, router }
}
const snapshot = JSON.stringify({
  type: 'presence_snapshot',
  room_id: '7',
  payload: { room_id: '7', online_user_ids: [1, 2], typing_user_ids: [1] },
})
const commands = (s: TestSocket, type: string) => s.sent.filter((c) => JSON.parse(c).type === type)
it('shows authorized typing and actual input, stops for Search, never starts restored drafts', async () => {
  const { host, socket } = await mount()
  socket.message(snapshot)
  await nextTick()
  expect(host.textContent).toContain('owner is typing')
  const t = host.querySelector('.composer textarea') as HTMLTextAreaElement
  t.focus()
  expect(commands(socket, 'typing_started')).toHaveLength(0)
  t.value = 'keep draft'
  t.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(commands(socket, 'typing_started')).toHaveLength(1)
  ;(host.querySelector('[aria-label="Search room messages"]') as HTMLButtonElement).click()
  await nextTick()
  expect(commands(socket, 'typing_stopped')).toHaveLength(1)
  expect(host.textContent).not.toContain('owner is typing')
  ;(host.querySelector('[aria-label="Search room messages"]') as HTMLButtonElement).click()
  await nextTick()
  expect(t.value).toBe('keep draft')
  expect(commands(socket, 'typing_started')).toHaveLength(1)
})
it('room navigation and revocation erase activity without leaking names', async () => {
  const { host, socket, router } = await mount()
  socket.message(snapshot)
  await nextTick()
  expect(host.textContent).toContain('owner is typing')
  await router.push('/app/settings')
  await nextTick()
  expect(host.textContent).not.toContain('owner is typing')
  await router.push('/app/rooms/7')
  await expect.poll(() => host.textContent).toContain('Private 1')
  socket.message(snapshot)
  socket.message(
    JSON.stringify({
      type: 'membership_changed',
      room_id: '7',
      payload: { action: 'removed', user_id: 2, actor_user_id: 1, role: 'member' },
    }),
  )
  await nextTick()
  expect(host.textContent).not.toContain('owner is typing')
})
