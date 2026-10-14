// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { VueQueryPlugin } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
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
  mock.onGet('/api/v1/rooms/7/members').reply(200, { members: [] })
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
const msgEvent = JSON.stringify({
  type: 'message',
  room_id: '7',
  payload: {
    id: 2,
    user_id: 1,
    username: 'owner',
    content: 'not authoritative',
    created_at: '2026-10-14T00:00:00Z',
  },
})
it('refreshes the rendered message before the polling interval', async () => {
  const { host, socket } = await mount()
  server = [message(2), message(1)]
  socket.message(msgEvent)
  await expect.poll(() => host.textContent).toContain('Private 2')
  expect(host.textContent).not.toContain('not authoritative')
})
it('clears private rendered content immediately on socket revocation', async () => {
  const { host, socket, router } = await mount()
  socket.message(
    JSON.stringify({
      type: 'membership_changed',
      room_id: '7',
      payload: { action: 'removed', user_id: 2, actor_user_id: 1, role: 'member' },
    }),
  )
  await nextTick()
  expect(host.textContent).not.toContain('Private 1')
  await expect.poll(() => router.currentRoute.value.path).toBe('/app')
  expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
})
it('gates recovery without losing the composer draft or scroll position', async () => {
  const { host, socket } = await mount()
  const textarea = host.querySelector('.composer textarea') as HTMLTextAreaElement
  textarea.value = 'Keep my draft'
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const list = host.querySelector('.message-list') as HTMLElement
  list.scrollTop = 32
  let release!: (value: [number, unknown]) => void
  mock.onGet('/api/v1/rooms/7').reply(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  socket.message('{malformed')
  await expect.poll(() => !!release).toBe(true)
  expect(host.textContent).not.toContain('Private 1')
  expect((host.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe(
    'Keep my draft',
  )
  expect((host.querySelector('.composer textarea') as HTMLTextAreaElement).disabled).toBe(true)
  release([
    200,
    {
      id: 7,
      name: 'Private room',
      visibility: 'private',
      role: 'member',
      created_by: 1,
      created_at: '2026-10-14T00:00:00Z',
    },
  ])
  await expect.poll(() => host.textContent).toContain('Private 1')
  expect((host.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe(
    'Keep my draft',
  )
  expect((host.querySelector('.message-list') as HTMLElement).scrollTop).toBe(32)
})
it('shows an explicit reload when a reconnect gap exceeds the recovery bound', async () => {
  const { host, socket } = await mount()
  const textarea = host.querySelector('.composer textarea') as HTMLTextAreaElement
  textarea.value = 'Draft survives reset'
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  server = Array.from({ length: 500 }, (_, i) => message(1000 - i))
  socket.message('{malformed')
  await expect.poll(() => host.textContent, { timeout: 3000 }).toContain('RELOAD CONVERSATION')
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'RELOAD CONVERSATION',
  )!
  button.click()
  await expect.poll(() => host.textContent).toContain('Private 1000')
  expect(host.textContent).not.toContain('Private 1 ')
  expect((host.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe(
    'Draft survives reset',
  )
})

it('does not reset reading position during an ordinary live update', async () => {
  const { host, socket } = await mount()
  const list = host.querySelector('.message-list') as HTMLElement
  Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true })
  list.scrollTop = 500
  server = [message(2), message(1)]
  socket.message(msgEvent)
  await expect.poll(() => host.textContent).toContain('Private 2')
  expect(list.scrollTop).toBe(500)
})
