// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import AttachmentUploadPicker from './AttachmentUploadPicker.vue'
import { file } from './attachment-test-utils'
it('labels file input, resets selection and exposes safe cancel/retry/status controls', async () => {
  const selected = vi.fn(),
    remove = vi.fn(),
    retry = vi.fn(),
    host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(AttachmentUploadPicker, {
        rows: [
          {
            localId: 'a',
            filename: '<b>name</b>.txt',
            sizeBytes: 1,
            phase: 'failed',
            progress: 0,
            error: 'Try again',
            cooldownSeconds: 0,
            inSend: false,
          },
        ],
        selectionError: '',
        disabled: false,
        onSelect: selected,
        onRemove: remove,
        onRetry: retry,
      }),
  })
  app.mount(host)
  try {
    const input = host.querySelector('input')!
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('.png,.jpg,.jpeg,.txt')
    Object.defineProperty(input, 'files', { value: [file()] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(selected).toHaveBeenCalledOnce()
    expect(input.value).toBe('')
    expect(host.querySelector('b')).toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="Remove <b>name</b>.txt"]')!.click()
    expect(remove).toHaveBeenCalledWith('a')
    host.querySelector<HTMLButtonElement>('[aria-label="Retry <b>name</b>.txt"]')!.click()
    expect(retry).toHaveBeenCalledWith('a')
  } finally {
    app.unmount()
  }
})
