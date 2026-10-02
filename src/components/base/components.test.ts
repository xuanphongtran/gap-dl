// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PixelButton from './PixelButton.vue'
import PixelField from './PixelField.vue'
import PixelPanel from './PixelPanel.vue'

const apps: ReturnType<typeof createApp>[] = []

function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render })
  app.mount(host)
  apps.push(app)
  return host
}

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.replaceChildren()
})

describe('pixel form primitives', () => {
  it('associates a label and error with an input and updates its model', async () => {
    const value = ref('')
    const host = mount(() =>
      h(PixelField, {
        label: 'Email',
        modelValue: value.value,
        error: 'Enter a valid email.',
        type: 'email',
        'aria-describedby': 'existing-help',
        'onUpdate:modelValue': (next: string) => {
          value.value = next
        },
      }),
    )
    const input = host.querySelector('input')!
    const label = host.querySelector('label')!
    const help = host.querySelector('small')!
    expect(label.htmlFor).toBe(input.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(`existing-help ${help.id}`)
    expect(input.type).toBe('email')
    input.value = 'hello@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(value.value).toBe('hello@example.com')
  })

  it('updates a select and prevents clicks while loading', async () => {
    const value = ref('private')
    const click = vi.fn()
    const host = mount(() =>
      h('div', [
        h(
          PixelField,
          {
            as: 'select',
            label: 'Visibility',
            modelValue: value.value,
            'onUpdate:modelValue': (next: string) => {
              value.value = next
            },
          },
          () => [
            h('option', { value: 'private' }, 'Private'),
            h('option', { value: 'public' }, 'Public'),
          ],
        ),
        h(PixelButton, { loading: true, onClick: click }, () => 'Save'),
      ]),
    )
    const select = host.querySelector('select')!
    select.value = 'public'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(value.value).toBe('public')
    const button = host.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    button.click()
    expect(click).not.toHaveBeenCalled()
  })

  it('renders a semantic form panel and forwards submit', () => {
    const submit = vi.fn((event: Event) => event.preventDefault())
    const host = mount(() =>
      h(PixelPanel, { as: 'form', onSubmit: submit }, () =>
        h('button', { type: 'submit' }, 'Create'),
      ),
    )
    host.querySelector('button')!.click()
    expect(host.querySelector('form.pixel-panel')).not.toBeNull()
    expect(submit).toHaveBeenCalledOnce()
  })
})
