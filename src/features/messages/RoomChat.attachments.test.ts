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
import { uploadHttp } from '../../lib/http'
import { attachment, file } from '../attachments/attachment-test-utils'
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const storage = new MockAdapter(uploadHttp)

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
  vi.stubGlobal('crypto', webcrypto)
  storage.onPut().reply(200)
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(201, {
    attachment: attachment(10, 'pending_upload'),
    method: 'PUT',
    headers: {},
    upload_url: 'https://storage.test/file',
  })
  mock.onPost('/api/v1/rooms/7/attachments/10/complete').reply(202, attachment(10, 'processing'))
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment())
  mock.onDelete('/api/v1/rooms/7/attachments/10').reply(204)
  vi.stubGlobal('WebSocket', TestSocket)
  TestSocket.instances = []
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 }, true)
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
  storage.reset()
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

it('preserves attachment selection while searching then sends verified IDs with caption and mention', async () => {
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  mock.onPost('/api/v1/rooms/7/messages').reply(201, { ...message(2), attachments: [attachment()] })
  const { host } = await mount()
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  expect(input).not.toBeNull()
  Object.defineProperty(input, 'files', { value: [file()] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await expect.poll(() => host.textContent).toContain('Ready')
  const field = host.querySelector<HTMLTextAreaElement>('#message-input')!
  field.value = 'caption'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  const picker = host.querySelector('select')!
  picker.value = '1'
  picker.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  button(host, 'SEARCH').click()
  await nextTick()
  button(host, 'CLOSE SEARCH').click()
  await nextTick()
  expect(host.textContent).toContain('a.txt')
  field.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await expect
    .poll(() => mock.history.post.filter((c) => c.url?.endsWith('/messages')).length)
    .toBe(1)
  const reservation = mock.history.post.find((c) => c.url?.endsWith('/uploads'))!,
    sent = mock.history.post.find((c) => c.url?.endsWith('/messages'))!
  expect(JSON.parse(sent.data)).toEqual({
    content: 'caption',
    mention_user_ids: [1],
    attachment_ids: [10],
  })
  expect(sent.headers?.['Idempotency-Key']).not.toBe(reservation.headers?.['Idempotency-Key'])
})
