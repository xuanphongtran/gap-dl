// @vitest-environment jsdom
import { createApp, h, ref, nextTick } from 'vue'
import { expect, it } from 'vitest'
import RealtimeStatus from './RealtimeStatus.vue'
import type { RealtimeStatus as Status } from './realtime-context'

it('offers an accessible retry and disables it during recovery', async () => {
  const status = ref<Status>('fallback'),
    retried = ref(false)
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(RealtimeStatus, {
        status: status.value,
        onRetry: () => {
          retried.value = true
        },
      }),
  })
  app.mount(host)
  try {
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull()
    const button = host.querySelector('button')!
    expect(button.textContent).toContain('RETRY')
    button.click()
    expect(retried.value).toBe(true)
    status.value = 'recovering'
    await nextTick()
    expect(host.querySelector('button')?.disabled).toBe(true)
    status.value = 'offline'
    await nextTick()
    expect(host.textContent).toContain('Offline')
  } finally {
    app.unmount()
  }
})
