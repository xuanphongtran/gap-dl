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

it('freezes an uncertain send draft without treating it as an active request', () => {
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MessageComposer, {
        modelValue: 'pending',
        disabled: false,
        sending: false,
        locked: true,
        error: '',
      }),
  })
  app.mount(host)
  try {
    expect(host.querySelector('textarea')?.disabled).toBe(true)
    expect(host.querySelector('button')?.disabled).toBe(true)
  } finally {
    app.unmount()
  }
})

it('processing_blocks_enter_without_locking_caption', async () => {
  const send = vi.fn(),
    host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MessageComposer, {
        modelValue: 'caption',
        disabled: false,
        sending: false,
        error: '',
        blockedReason: 'Files are processing.',
        onSend: send,
      }),
  })
  app.mount(host)
  try {
    const field = host.querySelector('textarea')!
    expect(field.disabled).toBe(false)
    expect(host.querySelector('button')!.disabled).toBe(true)
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(send).not.toHaveBeenCalled()
  } finally {
    app.unmount()
  }
})

it('emits activity only from enabled native input and stops on blur, send and IME end', async () => {
  const draft = ref('restored'),
    locked = ref(false),
    activity = vi.fn(),
    stop = vi.fn(),
    send = vi.fn(),
    host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MessageComposer, {
        modelValue: draft.value,
        disabled: false,
        sending: false,
        locked: locked.value,
        error: '',
        'onUpdate:modelValue': (v) => {
          draft.value = v
        },
        onActivity: activity,
        onActivityStop: stop,
        onSend: send,
      }),
  })
  app.mount(host)
  try {
    const t = host.querySelector('textarea')!
    t.dispatchEvent(new Event('focus'))
    draft.value = 'programmatic'
    await nextTick()
    expect(activity).not.toHaveBeenCalled()
    t.value = 'actual'
    t.dispatchEvent(new Event('input'))
    await nextTick()
    expect(activity).toHaveBeenCalledWith(true)
    t.dispatchEvent(new CompositionEvent('compositionstart'))
    t.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(send).not.toHaveBeenCalled()
    t.dispatchEvent(new CompositionEvent('compositionend'))
    expect(stop).toHaveBeenCalledOnce()
    t.dispatchEvent(new Event('blur'))
    expect(stop).toHaveBeenCalledTimes(2)
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(send).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledTimes(3)
    locked.value = true
    await nextTick()
    activity.mockClear()
    t.dispatchEvent(new Event('input'))
    expect(activity).not.toHaveBeenCalled()
  } finally {
    app.unmount()
  }
})
