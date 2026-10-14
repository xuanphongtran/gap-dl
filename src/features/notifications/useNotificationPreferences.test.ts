// @vitest-environment jsdom
import { ref } from 'vue'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { begin, end, mock, mountFeature, settle } from './notification-test-utils'
import { useNotificationPreferences } from './useNotificationPreferences'
import { queryClient, queryKeys } from '../../lib/query'
beforeEach(() => {
  begin()
  mock.onGet('/api/v1/users/me/notification-preferences').reply(200, { mentions_enabled: true })
  mock.onGet(/\/rooms\/\d+\/notification-preferences$/).reply(200, { muted: true })
})
afterEach(end)
async function mount(inRoom = false) {
  const userId = ref<number | undefined>(1),
    roomId = ref(7),
    enabled = ref(true),
    lost = vi.fn()
  const { value } = mountFeature(() =>
    useNotificationPreferences({
      userId,
      enabled,
      ...(inRoom ? { roomId } : {}),
      onAccessLost: lost,
    }),
  )
  await settle()
  return { preferences: value, userId, roomId, enabled, lost }
}
it.each([false, true])(
  'saves explicit false with server-confirmed value (room=%s)',
  async (inRoom) => {
    mock.onPut().reply((c) => [200, JSON.parse(c.data)])
    const h = await mount(inRoom)
    expect(h.preferences.value.value).toBe(true)
    await h.preferences.save(false)
    await settle()
    expect(JSON.parse(mock.history.put[0]!.data)).toEqual(
      inRoom ? { muted: false } : { mentions_enabled: false },
    )
    expect(h.preferences.value.value).toBe(false)
  },
)
it('does not optimistically change a failed save or lock unrelated operations', async () => {
  mock.onPut().reply(503, { error: 'try later' })
  const h = await mount()
  await h.preferences.save(false)
  expect(h.preferences.value.value).toBe(true)
  expect(h.preferences.saving.value).toBe(false)
  expect(h.preferences.error.value).toContain('temporarily unavailable')
})
it('ignores an old room save response after switching rooms', async () => {
  let resolve!: (v: [number, object]) => void
  mock.onPut().reply(() => new Promise<[number, object]>((r) => (resolve = r)))
  const h = await mount(true)
  const pending = h.preferences.save(false)
  await settle()
  h.roomId.value = 8
  await settle()
  expect(h.preferences.saving.value).toBe(false)
  resolve([200, { muted: false }])
  await pending
  expect(h.preferences.value.value).toBe(true)
  expect(h.preferences.error.value).toBe('')
})
it('cleans current room access on forbidden preferences but ignores stale denial', async () => {
  mock.onPut().reply(404, { error: 'not found' })
  const h = await mount(true)
  await h.preferences.save(false)
  expect(h.lost).toHaveBeenCalledWith(7)
  h.enabled.value = false
  await settle()
  expect(h.preferences.value.value).toBeUndefined()
})
it('blocks focus, invalidation and manual reads until a real Retry-After deadline', async () => {
  let attempts = 0
  mock
    .onGet('/api/v1/users/me/notification-preferences')
    .reply(() =>
      ++attempts === 1
        ? [429, { error: 'slow' }, { 'Retry-After': '60' }]
        : [200, { mentions_enabled: true }],
    )
  const h = await mount()
  await vi.advanceTimersByTimeAsync(5000)
  window.dispatchEvent(new Event('focus'))
  void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences(1) })
  await h.preferences.retry()
  await settle()
  expect(attempts).toBe(1)
  await vi.advanceTimersByTimeAsync(55000)
  await settle()
  expect(attempts).toBe(2)
})
