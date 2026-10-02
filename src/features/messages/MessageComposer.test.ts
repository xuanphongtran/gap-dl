// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import MessageComposer from './MessageComposer.vue'

it('preserves multiline drafts and sends only on unmodified Enter', async () => {
  const draft = ref('Hello')
  const send = vi.fn()
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MessageComposer, {
        modelValue: draft.value,
        disabled: false,
        sending: false,
        error: '',
        'onUpdate:modelValue': (value: string) => {
          draft.value = value
        },
        onSend: send,
      }),
  })
  app.mount(host)
  try {
    const textarea = host.querySelector('textarea')!
    textarea.value = 'Hello\nworld'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(draft.value).toBe('Hello\nworld')
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    )
    expect(send).not.toHaveBeenCalled()
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    expect(send).toHaveBeenCalledOnce()
  } finally {
    app.unmount()
  }
})
