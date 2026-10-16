// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { begin, end, mock, settle } from '../notifications/notification-test-utils'
import { queryClient } from '../../lib/query'
import ProfileScreen from './ProfileScreen.vue'
beforeEach(begin)
afterEach(end)
it('isolates a failed mention-preference save from successful profile save', async () => {
  mock.onGet('/api/v1/users/me/notification-preferences').reply(200, { mentions_enabled: true })
  mock.onPut('/api/v1/users/me/notification-preferences').reply(503, { error: 'preference failed' })
  mock.onPatch('/api/v1/users/me').reply(200, {
    id: 1,
    username: 'updated',
    email: 'owner@example.com',
    created_at: '2026-10-14T00:00:00Z',
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/settings', component: ProfileScreen },
      { path: '/app', component: { template: '<p>Rooms</p>' } },
    ],
  })
  await router.push('/app/settings')
  const host = document.createElement('div')
  const app = createApp({ render: () => h(ProfileScreen) })
  app.use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount(host)
  try {
    await settle()
    expect(host.textContent).toContain('MENTION NOTIFICATIONS')
    const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    await settle()
    const button = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('SAVE PREFERENCES'),
    )!
    button.click()
    await settle()
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(host.textContent).toContain('Profile saved.')
    expect(host.textContent).toContain('temporarily unavailable')
    expect(checkbox.disabled).toBe(false)
  } finally {
    app.unmount()
  }
})
