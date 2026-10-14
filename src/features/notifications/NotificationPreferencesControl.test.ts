// @vitest-environment jsdom
import { h } from 'vue'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { begin, end, mock, mountFeature, settle } from './notification-test-utils'
import NotificationPreferencesControl from './NotificationPreferencesControl.vue'
beforeEach(begin)
afterEach(end)
it('keeps a failed checkbox intent editable and sends false on explicit Save', async () => {
  mock.onGet('/api/v1/users/me/notification-preferences').reply(200, { mentions_enabled: true })
  mock.onPut().reply(503, { error: 'try later' })
  const { host } = mountFeature(
    () => null,
    () => h(NotificationPreferencesControl, { userId: 1, enabled: true }),
  )
  await settle()
  const field = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
  expect(host.querySelector('label')?.htmlFor).toBe(field.id)
  expect(field.checked).toBe(true)
  field.checked = false
  field.dispatchEvent(new Event('change'))
  await settle()
  host.querySelector('button')!.click()
  await settle()
  expect(JSON.parse(mock.history.put[0]!.data)).toEqual({ mentions_enabled: false })
  expect(field.checked).toBe(false)
  expect(field.disabled).toBe(false)
  expect(host.textContent).toContain('future notifications')
})
