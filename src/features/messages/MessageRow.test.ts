// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { expect, it } from 'vitest'
import MessageRow from './MessageRow.vue'

it('hides erased content and identifies a deleted author', () => {
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MessageRow, {
        message: {
          id: 1,
          room_id: 2,
          user_id: null,
          username: 'Former name',
          content: 'Erased content',
          created_at: '2026-10-02T00:00:00Z',
          revision: 2,
          edited_at: null,
          deleted_at: '2026-10-02T00:01:00Z',
        },
        mine: false,
        time: '12:00',
      }),
  })
  app.mount(host)
  try {
    expect(host.textContent).toContain('Deleted user')
    expect(host.textContent).toContain('Message deleted.')
    expect(host.textContent).not.toContain('Former name')
    expect(host.textContent).not.toContain('Erased content')
  } finally {
    app.unmount()
  }
})
