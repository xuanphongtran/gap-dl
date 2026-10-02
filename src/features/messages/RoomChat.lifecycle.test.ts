// @vitest-environment jsdom
import { VueQueryPlugin } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
import type { Message, RoomRole } from '../../types'
import RoomChat from './RoomChat.vue'

function message(id: number, userId: number, content: string, revision = 1): Message {
  return {
    id,
    room_id: 7,
    user_id: userId,
    username: userId === 2 ? 'me' : 'other',
    content,
    created_at: '2026-10-02T00:00:00Z',
    revision,
    edited_at: null,
    deleted_at: null,
  }
}

async function mountChat(role: RoomRole, getMessages: () => Message[]) {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  const mock = new MockAdapter(http)
  mock.onGet('/api/v1/rooms/7').reply(200, {
    id: 7,
    name: 'Test room',
    visibility: 'private',
    role,
    created_by: 2,
    created_at: '2026-10-02T00:00:00Z',
  })
  mock.onGet('/api/v1/users/me').reply(200, {
    id: 2,
    username: 'me',
    email: 'me@example.com',
    created_at: '2026-10-02T00:00:00Z',
  })
  mock.onGet('/api/v1/rooms/7/members').reply(200, { members: [] })
  mock.onGet('/api/v1/rooms/7/messages').reply(() => [200, { messages: getMessages() }])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app', component: { template: '<div>Rooms</div>' } },
      { path: '/app/rooms/:id', component: RoomChat },
    ],
  })
  await router.push('/app/rooms/7')
  await router.isReady()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(RouterView) })
  app.use(VueQueryPlugin, { queryClient }).use(router).mount(host)
  return { mock, host, app }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

afterEach(() => {
  queryClient.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

it('preserves an edit draft on conflict and retries with the fresh revision', async () => {
  let server = message(11, 2, 'Original')
  const { mock, host, app } = await mountChat('member', () => [server])
  const requests: Array<{ content: string; revision: number }> = []
  mock.onPatch('/api/v1/rooms/7/messages/11').reply((config) => {
    const body = JSON.parse(config.data) as { content: string; revision: number }
    requests.push(body)
    if (body.revision === 1) {
      server = { ...server, content: 'Other tab changed this', revision: 2 }
      return [409, { error: 'revision conflict' }]
    }
    server = {
      ...server,
      content: body.content,
      revision: 3,
      edited_at: '2026-10-02T00:03:00Z',
    }
    return [200, server]
  })
  try {
    await expect.poll(() => host.textContent).toContain('Original')
    button(host, 'Edit').click()
    await nextTick()
    const textarea = host.querySelector('.message-editor textarea')!
    ;(textarea as HTMLTextAreaElement).value = 'My draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    button(host, 'SAVE').click()
    await expect.poll(() => host.textContent).toContain('Other tab changed this')
    await expect.poll(() => host.textContent).toContain('RETRY SAVE')
    expect((host.querySelector('.message-editor textarea') as HTMLTextAreaElement).value).toBe(
      'My draft',
    )
    button(host, 'RETRY SAVE').click()
    await expect.poll(() => host.textContent).toContain('Edited')
    expect(requests).toEqual([
      { content: 'My draft', revision: 1 },
      { content: 'My draft', revision: 2 },
    ])
    expect(host.textContent).toContain('My draft')
  } finally {
    app.unmount()
    host.remove()
    mock.restore()
  }
})

it('allows owner deletion of another author but never offers text editing', async () => {
  const original = message(12, 3, 'Other author text')
  const { mock, host, app } = await mountChat('owner', () => [original])
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)
  mock.onDelete('/api/v1/rooms/7/messages/12').reply(200, {
    ...original,
    content: '',
    revision: 2,
    deleted_at: '2026-10-02T00:02:00Z',
  })
  try {
    await expect.poll(() => host.textContent).toContain('Other author text')
    expect(
      [...host.querySelectorAll('.message-row button')].map((item) => item.textContent),
    ).toEqual(['Delete'])
    button(host, 'Delete').click()
    await expect.poll(() => host.textContent).toContain('Message deleted.')
    expect(host.textContent).not.toContain('Other author text')
    expect(confirm).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData<Message[]>(queryKeys.latestMessages(7))?.[0]?.content).toBe('')
  } finally {
    app.unmount()
    host.remove()
    mock.restore()
  }
})

it('does not offer edit or delete on another member’s message', async () => {
  const { mock, host, app } = await mountChat('member', () => [message(12, 3, 'Other text')])
  try {
    await expect.poll(() => host.textContent).toContain('Other text')
    expect(host.querySelectorAll('.message-row button')).toHaveLength(0)
  } finally {
    app.unmount()
    host.remove()
    mock.restore()
  }
})

it('keeps the draft visible when a poll returns a tombstone for the edited message', async () => {
  let server = message(13, 2, 'Before deletion')
  const { mock, host, app } = await mountChat('member', () => [server])
  try {
    await expect.poll(() => host.textContent).toContain('Before deletion')
    button(host, 'Edit').click()
    await nextTick()
    const textarea = host.querySelector('.message-editor textarea') as HTMLTextAreaElement
    textarea.value = 'Unsaved draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    server = {
      ...server,
      content: '',
      revision: 2,
      deleted_at: '2026-10-02T00:02:00Z',
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.latestMessages(7), exact: true })
    await expect.poll(() => host.textContent).toContain('The server version was deleted.')
    expect((host.querySelector('.message-editor textarea') as HTMLTextAreaElement).value).toBe(
      'Unsaved draft',
    )
    expect(button(host, 'RETRY SAVE').disabled).toBe(true)
    button(host, 'DISCARD DRAFT').click()
    await expect.poll(() => host.querySelector('.message-editor')).toBeNull()
    expect(host.textContent).not.toContain('Before deletion')
  } finally {
    app.unmount()
    host.remove()
    mock.restore()
  }
})
