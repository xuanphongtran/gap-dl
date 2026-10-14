// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
import RoomMessageSearch from './RoomMessageSearch.vue'
const mock = new MockAdapter(http)
const apps: ReturnType<typeof createApp>[] = []
const result = {
  id: 3,
  room_id: 7,
  user_id: null,
  username: '',
  content: '<img src=x onerror=alert(1)>',
  revision: 2,
  created_at: '2026-10-14T00:00:00Z',
  edited_at: '2026-10-14T01:00:00Z',
  deleted_at: null,
}
beforeEach(() => {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  mock
    .onGet('/api/v1/rooms/7/messages/search')
    .reply(200, { messages: [result], next_before: null })
})
afterEach(() => {
  apps.splice(0).forEach((a) => a.unmount())
  mock.reset()
  queryClient.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
async function mount() {
  const enabled = ref(true),
    close = vi.fn(),
    lost = vi.fn(),
    host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(RoomMessageSearch, {
        roomId: 7,
        userId: 2,
        enabled: enabled.value,
        knownMessages: [],
        onClose: close,
        onAccessLost: lost,
      }),
  })
  apps.push(app)
  app.use(VueQueryPlugin, { queryClient }).mount(host)
  await nextTick()
  return { host, enabled, close, lost }
}
async function submit(host: HTMLElement, text = 'hello') {
  const input = host.querySelector('input')!
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}
it('labels and focuses input, renders escaped read-only results and closes on Escape', async () => {
  const { host, close } = await mount()
  const input = host.querySelector('input')!
  expect(document.activeElement).toBe(input)
  expect(host.querySelector('label')?.htmlFor).toBe(input.id)
  await submit(host)
  await expect.poll(() => host.textContent).toContain('Deleted user')
  expect(host.textContent).toContain('Edited')
  expect(host.textContent).toContain(result.content)
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('[data-message-id]')).toBeNull()
  expect(host.textContent).not.toContain('DELETE')
  expect(host.textContent).toContain('End of results')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(close).toHaveBeenCalledOnce()
})
it('shows validation without making a request and empty search feedback', async () => {
  const { host } = await mount()
  await submit(host, 'á'.repeat(129))
  expect(mock.history.get).toHaveLength(0)
  expect(host.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [], next_before: null })
  await submit(host)
  await expect.poll(() => host.textContent).toContain('No matching messages')
})
it('hides snippets during authorization recovery', async () => {
  const { host, enabled } = await mount()
  await submit(host)
  await expect.poll(() => host.textContent).toContain('Deleted user')
  enabled.value = false
  await nextTick()
  expect(host.textContent).not.toContain(result.content)
  expect(host.textContent).toContain('Checking conversation access')
})
it('shows a safe error and supports explicit retry', async () => {
  mock.onGet('/api/v1/rooms/7/messages/search').reply(503, { error: 'private SQL details' })
  const { host } = await mount()
  await submit(host)
  await expect.poll(() => host.textContent).toContain('RETRY')
  expect(host.textContent).not.toContain('private SQL details')
  mock
    .onGet('/api/v1/rooms/7/messages/search')
    .reply(200, { messages: [result], next_before: null })
  ;[...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'RETRY')!.click()
  await expect.poll(() => host.textContent).toContain('Deleted user')
})
it('clears cached results when unmounted', async () => {
  const { host } = await mount()
  await submit(host)
  await expect.poll(() => host.textContent).toContain('Deleted user')
  apps[0]!.unmount()
  apps.splice(0)
  expect(queryClient.getQueryData(queryKeys.searchMessages(7, 2, 'hello'))).toBeUndefined()
})

it('shows pagination progress separately and preserves already loaded results', async () => {
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: [result], next_before: 3 })
  const { host } = await mount()
  await submit(host)
  await expect.poll(() => host.textContent).toContain('LOAD MORE')
  let resolve!: (response: [number, object]) => void
  mock.onGet('/api/v1/rooms/7/messages/search').reply(
    () =>
      new Promise<[number, object]>((r) => {
        resolve = r
      }),
  )
  ;[...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'LOAD MORE')!.click()
  await expect.poll(() => host.textContent).toContain('LOADING...')
  expect(host.textContent).toContain(result.content)
  resolve([200, { messages: [{ ...result, id: 2, content: 'Second result' }], next_before: null }])
  await expect.poll(() => host.textContent).toContain('Second result')
  expect(host.textContent).toContain('End of results')
})

it('restores Search scroll after a refetch hides rows and resets it for a new query', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ...result,
    id: 100 - i,
    content: `Result ${i}`,
  }))
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: rows, next_before: null })
  const { host } = await mount()
  await submit(host)
  await expect.poll(() => host.querySelectorAll('.search-results .message-row').length).toBe(20)
  const panel = host.querySelector('.room-search') as HTMLElement
  let top = 1000
  Object.defineProperty(panel, 'scrollTop', {
    get: () => {
      if (!host.querySelectorAll('.search-results .message-row').length) top = 0
      return top
    },
    set: (value) => {
      top = value
    },
  })
  let resolve!: (response: [number, object]) => void
  mock.onGet('/api/v1/rooms/7/messages/search').reply(
    () =>
      new Promise<[number, object]>((r) => {
        resolve = r
      }),
  )
  const refetch = queryClient.invalidateQueries({ queryKey: queryKeys.messageSearch(7) })
  await expect.poll(() => host.textContent).toContain('Searching...')
  expect(panel.scrollTop).toBe(0)
  resolve([200, { messages: rows, next_before: null }])
  await refetch
  await nextTick()
  expect(panel.scrollTop).toBe(1000)
  mock.onGet('/api/v1/rooms/7/messages/search').reply(200, { messages: rows, next_before: null })
  await submit(host, 'other')
  await expect.poll(() => host.querySelectorAll('.search-results .message-row').length).toBe(20)
  await nextTick()
  expect(panel.scrollTop).toBe(0)
})
