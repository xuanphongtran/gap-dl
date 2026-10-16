// @vitest-environment jsdom
import { createApp, h, ref, nextTick } from 'vue'
import { expect, it } from 'vitest'
import MentionRecipientPicker from './MentionRecipientPicker.vue'
it('selects numeric identities with a labelled control and excludes self', async () => {
  const ids = ref<number[]>([])
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MentionRecipientPicker, {
        members: [1, 2].map((user_id) => ({
          user_id,
          room_id: 7,
          username: 'user' + user_id,
          role: 'member' as const,
          joined_at: '',
        })),
        userId: 1,
        modelValue: ids.value,
        disabled: false,
        'onUpdate:modelValue': (v: number[]) => (ids.value = v),
      }),
  })
  app.mount(host)
  try {
    const select = host.querySelector('select')!
    expect(host.querySelector('label')?.htmlFor).toBe(select.id)
    expect([...select.options].map((o) => o.value)).not.toContain('1')
    select.value = '2'
    select.dispatchEvent(new Event('change'))
    await nextTick()
    expect(ids.value).toEqual([2])
    host.querySelector('button')!.click()
    await nextTick()
    expect(ids.value).toEqual([])
  } finally {
    app.unmount()
  }
})
