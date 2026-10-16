// @vitest-environment jsdom
import { ref, h } from 'vue'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { begin, end, mock, mountFeature, settle } from './notification-test-utils'
import { useNotificationPreferences } from './useNotificationPreferences'
import NotificationPreferencesControl from './NotificationPreferencesControl.vue'

beforeEach(begin)
afterEach(end)
it('preference remount verifies fresh cached state', async () => {
  const { queryClient, queryKeys } = await import('../../lib/query')
  queryClient.setQueryData(queryKeys.notificationPreferences(1), { mentions_enabled: true })
  mock.onGet('/api/v1/users/me/notification-preferences').reply(200, { mentions_enabled: true })
  const second = mountFeature(() =>
    useNotificationPreferences({ userId: ref(1), enabled: ref(true) }),
  )
  await settle()
  expect(second.value.value.value).toBe(true)
})
it('old room save completion preserves a new room unsaved edit', async () => {
  mock.onGet(/\/rooms\/\d+\/notification-preferences$/).reply(200, { muted: false })
  let resolve!: (v: [number, object]) => void
  mock.onPut().reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const roomId = ref(7)
  const { host } = mountFeature(
    () => null,
    () => h(NotificationPreferencesControl, { userId: 1, enabled: true, roomId: roomId.value }),
  )
  await settle()
  const checkbox = () => host.querySelector<HTMLInputElement>('input')!
  const edit = async () => {
    checkbox().checked = true
    checkbox().dispatchEvent(new Event('change'))
    await settle()
  }
  await edit()
  host.querySelector('button')!.click()
  await settle()
  roomId.value = 8
  await settle()
  await edit()
  expect(checkbox().checked).toBe(true)
  resolve([200, { muted: true }])
  await settle()
  expect(checkbox().checked).toBe(true)
  expect(host.querySelector('button')!.disabled).toBe(false)
})
it('room save cooldown does not leak to another room', async () => {
  mock.onGet(/\/rooms\/\d+\/notification-preferences$/).reply(200, { muted: false })
  mock.onPut().reply(429, { error: 'slow' }, { 'Retry-After': '60' })
  const options = { userId: ref(1), enabled: ref(true), roomId: ref(7) }
  const f = mountFeature(() => useNotificationPreferences(options)).value
  await settle()
  await f.save(true)
  options.roomId.value = 8
  await settle()
  expect(f.cooldownSeconds.value).toBe(0)
})

it('starts room preference reads after identity and authorization become ready', async () => {
  mock.onGet(/\/rooms\/\d+\/notification-preferences$/).reply(200, { muted: false })
  const userId = ref<number | undefined>(undefined),
    enabled = ref(false)
  const preferences = mountFeature(() =>
    useNotificationPreferences({ userId, enabled, roomId: ref(7) }),
  ).value
  await settle()
  userId.value = 1
  enabled.value = true
  await settle()
  expect(preferences.value.value).toBe(false)
})
