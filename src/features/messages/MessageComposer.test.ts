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

it('blocks a draft that exceeds 4000 UTF-8 bytes and keeps it editable', async () => {
  const draft = ref('😀'.repeat(1001))
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
      }),
  })
  app.mount(host)
  try {
    expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('button')?.disabled).toBe(true)
    expect(host.textContent).toContain('4000-byte UTF-8 limit')
    draft.value = '😀'.repeat(1000)
    await nextTick()
    expect(host.querySelector('button')?.disabled).toBe(false)
  } finally {
    app.unmount()
  }
})
