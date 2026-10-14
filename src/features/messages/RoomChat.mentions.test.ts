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
    members: [
      {
        user_id: 1,
        room_id: 7,
        username: 'owner',
        role: 'owner',
        joined_at: '2026-10-14T00:00:00Z',
      },
    ],
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

function button(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  expect(found).toBeDefined()
  return found!
}
it('preserves typed recipients with the draft while searching and sends their identity', async () => {
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  mock.onPost('/api/v1/rooms/7/messages').reply(201, message(2))
  const { host } = await mount()
  const field = host.querySelector<HTMLTextAreaElement>('#message-input')!
  field.value = 'hello mention'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  const picker = host.querySelector('select')!
  expect(picker).not.toBeNull()
  picker.value = '1'
  picker.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  button(host, 'SEARCH').click()
  await nextTick()
  expect(host.textContent).toContain('owner ×')
  host
    .querySelector<HTMLInputElement>('.room-search input')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  field.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await expect.poll(() => mock.history.post.length).toBe(1)
  expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
    content: 'hello mention',
    mention_user_ids: [1],
  })
  await expect.poll(() => field.value).toBe('')
})
it('requires confirmation before discarding an uncertain mention', async () => {
  mock.onPost('/api/v1/rooms/7/messages').networkError()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { host } = await mount()
  const field = host.querySelector<HTMLTextAreaElement>('#message-input')!
  field.value = 'pending'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  const picker = host.querySelector('select')!
  expect(picker).not.toBeNull()
  picker.value = '1'
  picker.dispatchEvent(new Event('change'))
  await nextTick()
  field.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await expect.poll(() => host.textContent).toContain('DISCARD PENDING SEND')
  button(host, 'DISCARD PENDING SEND').click()
  await nextTick()
  expect(confirm).toHaveBeenCalled()
  expect(field.disabled).toBe(true)
  confirm.mockReturnValue(true)
  button(host, 'DISCARD PENDING SEND').click()
  await nextTick()
  expect(field.disabled).toBe(false)
  expect(field.value).toBe('pending')
})
