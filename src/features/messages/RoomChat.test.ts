// @vitest-environment jsdom
import { VueQueryPlugin } from '@tanstack/vue-query'
import MockAdapter from 'axios-mock-adapter'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, expect, it } from 'vitest'
import { http } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { saveSession } from '../../lib/session'
import RoomChat from './RoomChat.vue'

afterEach(() => {
  queryClient.clear()
  sessionStorage.clear()
})

it('keeps public-room messages private until the visitor joins', async () => {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  let joined = false
  let privateReads = 0
  const mock = new MockAdapter(http)
  mock.onGet('/api/v1/rooms/7').reply(() => [
    200,
    {
      id: 7,
      name: 'Public room',
      visibility: 'public',
      role: joined ? 'member' : null,
      created_by: 1,
      created_at: '2026-10-02T00:00:00Z',
    },
  ])
  mock.onGet('/api/v1/users/me').reply(200, {
    id: 2,
    username: 'visitor',
    email: 'visitor@example.com',
    created_at: '2026-10-02T00:00:00Z',
  })
  mock.onGet('/api/v1/rooms/7/members').reply(() => {
    privateReads++
    return [200, { members: [] }]
  })
  mock.onGet('/api/v1/rooms/7/messages').reply(() => {
    privateReads++
    return [200, { messages: [] }]
  })
  mock.onGet('/api/v1/rooms/7/read-state').reply(200, {
    room_id: 7,
    last_read_message_id: 0,
    unread_count: 0,
  })
  mock.onPut('/api/v1/rooms/7/read-state').reply((config) => [
    200,
    {
      room_id: 7,
      last_read_message_id: JSON.parse(config.data).last_read_message_id,
      unread_count: 0,
    },
  ])
  mock.onPost('/api/v1/rooms/7/join').reply(() => {
    joined = true
    return [200, { message: 'joined' }]
  })
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
  const app = createApp({ render: () => h(RouterView) })
  app.use(VueQueryPlugin, { queryClient }).use(router).mount(host)
  try {
    await expect.poll(() => host.textContent).toContain('Join this room to read and send messages.')
    expect(privateReads).toBe(0)
    const button = [...host.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('JOIN ROOM'),
    )
    expect(button).toBeDefined()
    button!.click()
    await expect.poll(() => privateReads).toBeGreaterThan(0)
    await expect.poll(() => host.textContent).toContain('No messages yet')
  } finally {
    app.unmount()
    mock.restore()
  }
})

it('removes cached private messages and navigates away after membership is revoked', async () => {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  queryClient.setQueryData(queryKeys.rooms, {
    rooms: [{ id: 7, name: 'Private room', visibility: 'private', role: 'member' }],
  })
  let revoked = false
  const mock = new MockAdapter(http)
  mock.onGet('/api/v1/rooms/7').reply(200, {
    id: 7,
    name: 'Private room',
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: '2026-10-02T00:00:00Z',
  })
  mock.onGet('/api/v1/users/me').reply(200, {
    id: 2,
    username: 'member',
    email: 'member@example.com',
    created_at: '2026-10-02T00:00:00Z',
  })
  mock.onGet('/api/v1/rooms/7/members').reply(200, { members: [] })
  mock.onGet('/api/v1/rooms/7/messages').reply(() =>
    revoked
      ? [403, { error: 'forbidden' }]
      : [
          200,
          {
            messages: [
              {
                id: 9,
                room_id: 7,
                user_id: 1,
                username: 'owner',
                content: 'Private message',
                created_at: '2026-10-02T00:00:00Z',
                revision: 1,
                edited_at: null,
                deleted_at: null,
              },
            ],
          },
        ],
  )
  mock.onGet('/api/v1/rooms/7/read-state').reply(200, {
    room_id: 7,
    last_read_message_id: 0,
    unread_count: 0,
  })
  mock.onPut('/api/v1/rooms/7/read-state').reply(200, {
    room_id: 7,
    last_read_message_id: 9,
    unread_count: 0,
  })
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
  const app = createApp({ render: () => h(RouterView) })
  app.use(VueQueryPlugin, { queryClient }).use(router).mount(host)
  try {
    await expect.poll(() => host.textContent).toContain('Private message')
    revoked = true
    await queryClient.invalidateQueries({ queryKey: queryKeys.latestMessages(7), exact: true })
    await expect.poll(() => router.currentRoute.value.path).toBe('/app')
    expect(host.textContent).not.toContain('Private message')
    expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.room(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.rooms)).toEqual({ rooms: [] })
  } finally {
    app.unmount()
    mock.restore()
  }
})
