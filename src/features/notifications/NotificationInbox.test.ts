// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { beforeEach, afterEach, expect, it } from 'vitest'
import NotificationInbox from './NotificationInbox.vue'
import { begin, end, mock, note, settle } from './notification-test-utils'
import { queryClient, queryKeys } from '../../lib/query'
beforeEach(begin)
afterEach(end)
it('renders metadata safely, guards navigation, and preserves same-filter scroll', async () => {
  mock.onGet('/api/v1/users/me/notifications').reply(200, {
    notifications: [
      { ...note(3), kind: '<img onerror=alert(1)>' },
      { ...note(2), availability: 'deleted' },
    ],
    next_before: null,
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/inbox', component: NotificationInbox },
      { path: '/app/rooms/:id', component: { template: '<p>Room</p>' } },
    ],
  })
  await router.push('/app/inbox')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(NotificationInbox) })
  app.use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount(host)
  try {
    await settle()
    expect(host.textContent).toContain('Notification')
    expect(host.textContent).toContain('MESSAGE DELETED')
    expect(host.querySelector('img')).toBeNull()
    expect(
      [...host.querySelectorAll('button')].filter((b) => b.textContent === 'OPEN ROOM'),
    ).toHaveLength(1)
    const list = host.querySelector<HTMLElement>('.notification-list')!
    list.scrollTop = 700
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(1) })
    await settle()
    await nextTick()
    expect(list.scrollTop).toBe(700)
    const unread = [...host.querySelectorAll('button')].find((b) => b.textContent === 'UNREAD')!
    unread.click()
    await settle()
    expect(list.scrollTop).toBe(0)
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'OPEN ROOM')!
    open.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/app/rooms/7')
  } finally {
    app.unmount()
  }
})
