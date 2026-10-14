// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { onlineManager, VueQueryPlugin } from '@tanstack/vue-query'
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

function button(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().includes(text),
  )
  expect(found, `Missing button ${text}`).toBeDefined()
  return found!
}
async function search(host: HTMLElement) {
  button(host, 'SEARCH').click()
  await nextTick()
  const input = host.querySelector('.room-search input') as HTMLInputElement
  expect(input).not.toBeNull()
  input.value = 'hello'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('Found old text')
}
function stubSearch() {
  mock
    .onGet('/api/v1/rooms/7/messages/search')
    .reply(200, { messages: [{ ...message(99), content: 'Found old text' }], next_before: null })
}
it('preserves the composer and reading position and restores focus after closing Search', async () => {
  stubSearch()
  const { host } = await mount()
  const list = host.querySelector('.message-list') as HTMLElement
  list.scrollTop = 123
  const composer = host.querySelector('.composer textarea') as HTMLTextAreaElement
  composer.value = 'Keep my draft'
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  await search(host)
  expect(document.activeElement).toBe(host.querySelector('.room-search input'))
  expect(list.style.display).toBe('none')
  button(host, 'CLOSE SEARCH').click()
  await nextTick()
  await nextTick()
  expect(host.querySelector('.room-search')).toBeNull()
  expect(composer.value).toBe('Keep my draft')
  expect(list.scrollTop).toBe(123)
  expect(document.activeElement?.textContent).toContain('SEARCH')
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('does not mark found messages as read or scroll the hidden conversation on live updates', async () => {
  stubSearch()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const { host, socket } = await mount()
  await new Promise((r) => setTimeout(r, 550))
  mock.resetHistory()
  const list = host.querySelector('.message-list') as HTMLElement
  list.scrollTop = 123
  Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true })
  await search(host)
  server = [message(2), message(1)]
  socket.message(msgEvent)
  await expect
    .poll(() => queryClient.getQueryData<Message[]>(queryKeys.latestMessages(7))?.at(-1)?.id)
    .toBe(2)
  await new Promise((r) => setTimeout(r, 550))
  expect(mock.history.put).toHaveLength(0)
  expect(list.scrollTop).toBe(123)
  button(host, 'CLOSE SEARCH').click()
  await nextTick()
  await nextTick()
  expect(list.scrollTop).toBe(123)
})
it('gates cached search during reconnect and preserves its submitted query on token refresh', async () => {
  stubSearch()
  const { host } = await mount()
  await search(host)
  saveSession({ access_token: 'fresh', refresh_token: 'rotated', expires_at: 0 })
  await nextTick()
  expect(host.querySelector('.room-search')?.textContent).not.toContain('Found old text')
  await expect.poll(() => TestSocket.instances.length).toBe(2)
  TestSocket.instances[1]!.open()
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('Found old text')
  expect((host.querySelector('.room-search input') as HTMLInputElement).value).toBe('hello')
})
it('clears Search on explicit same-account login and membership revocation', async () => {
  stubSearch()
  const { host } = await mount()
  await search(host)
  saveSession({ access_token: 'login', refresh_token: 'new', expires_at: 0 }, true)
  await expect.poll(() => host.querySelector('.room-search')).toBeNull()
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('refreshes open Search on local lifecycle results and realtime reconciliation', async () => {
  stubSearch()
  const { host, socket } = await mount()
  await search(host)
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  socket.message(msgEvent)
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('No matching messages')
  expect(host.querySelector('.room-search')?.textContent).not.toContain('Found old text')
})
it('closes and clears search immediately on socket membership revocation', async () => {
  stubSearch()
  const { host, socket, router } = await mount()
  await search(host)
  socket.message(
    JSON.stringify({
      type: 'error',
      room_id: '7',
      payload: { code: 'membership_revoked', message: 'removed' },
    }),
  )
  await expect.poll(() => router.currentRoute.value.path).toBe('/app')
  expect(host.querySelector('.room-search')).toBeNull()
  expect(host.textContent).not.toContain('Found old text')
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})
it('closes search on a room switch without moving focus back to the old room', async () => {
  stubSearch()
  const { host, router } = await mount()
  await search(host)
  await router.push('/app/settings')
  await nextTick()
  expect(host.querySelector('.room-search')).toBeNull()
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})

it('invalidates Search when a pending local edit completes while the panel is open', async () => {
  server = [{ ...message(1), user_id: 2, username: 'reader' }]
  stubSearch()
  let resolve!: (response: [number, Message]) => void
  mock.onPatch('/api/v1/rooms/7/messages/1').reply(
    () =>
      new Promise<[number, Message]>((r) => {
        resolve = r
      }),
  )
  const { host } = await mount()
  button(host, 'Edit').click()
  await nextTick()
  const editor = host.querySelector('.message-editor textarea') as HTMLTextAreaElement
  editor.value = 'Edited away'
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  button(host, 'SAVE').click()
  await expect.poll(() => resolve).toBeTypeOf('function')
  await search(host)
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  server = [{ ...server[0]!, content: 'Edited away', revision: 2 }]
  resolve([200, server[0]!])
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('No matching messages')
})

it('cancels a pending visible-message debounce when Search opens', async () => {
  stubSearch()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    right: 300,
    top: 0,
    bottom: 200,
    width: 300,
    height: 200,
    toJSON: () => ({}),
  })
  const { host } = await mount()
  expect(mock.history.put).toHaveLength(0)
  await search(host)
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(mock.history.put).toHaveLength(0)
})

it('closes and clears Search when the same chat component switches rooms', async () => {
  stubSearch()
  mock.onGet('/api/v1/rooms/8').reply(200, {
    id: 8,
    name: 'Second',
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: '2026-10-14T00:00:00Z',
  })
  mock.onGet('/api/v1/rooms/8/members').reply(200, { members: [] })
  mock.onGet('/api/v1/rooms/8/messages').reply(200, { messages: [] })
  mock
    .onGet('/api/v1/rooms/8/read-state')
    .reply(200, { room_id: 8, last_read_message_id: 0, unread_count: 0 })
  const { host, router } = await mount()
  await search(host)
  await router.push('/app/rooms/8')
  await nextTick()
  expect(host.querySelector('.room-search')).toBeNull()
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})

it('refreshes Search from an undocumented reconciliation hint and ignores other-room invalidations', async () => {
  stubSearch()
  const { host, socket } = await mount()
  await search(host)
  const count = mock.history.get.filter((c) => c.url?.endsWith('/search')).length
  await queryClient.invalidateQueries({ queryKey: queryKeys.messageSearch(8) })
  await nextTick()
  expect(mock.history.get.filter((c) => c.url?.endsWith('/search'))).toHaveLength(count)
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  socket.message(JSON.stringify({ type: 'presence_snapshot', room_id: '7', payload: {} }))
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('No matching messages')
})

it('invalidates Search when a pending local delete completes', async () => {
  server = [{ ...message(1), user_id: 2, username: 'reader' }]
  stubSearch()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  let resolve!: (response: [number, Message]) => void
  mock.onDelete('/api/v1/rooms/7/messages/1').reply(
    () =>
      new Promise<[number, Message]>((r) => {
        resolve = r
      }),
  )
  const { host } = await mount()
  button(host, 'Delete').click()
  await expect.poll(() => resolve).toBeTypeOf('function')
  await search(host)
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  resolve([200, { ...server[0]!, content: '', revision: 2, deleted_at: '2026-10-14T01:00:00Z' }])
  await expect
    .poll(() => host.querySelector('.room-search')?.textContent)
    .toContain('No matching messages')
})
