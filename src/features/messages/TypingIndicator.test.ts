// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { expect, it } from 'vitest'
import type { RoomActivityState } from '../rooms/realtime-context'
import TypingIndicator from './TypingIndicator.vue'
const members = [1, 2, 3, 4, 5].map((id) => ({
  room_id: 7,
  user_id: id,
  username: id === 2 ? '<Alice>' : `Member ${id}`,
  role: 'member' as const,
  joined_at: '2026-10-20T00:00:00Z',
}))
const ready: RoomActivityState = {
  roomId: 7,
  phase: 'ready',
  onlineUserIds: [1, 2, 3, 4, 5, 99],
  typingUserIds: [1, 2, 3, 4, 5, 99],
}
it('escapes names and excludes self, unknown and other room members with bounded plural summary', () => {
  const host = document.createElement('div'),
    app = createApp({
      render: () =>
        h(TypingIndicator, {
          activity: ready,
          members: [...members, { ...members[0]!, room_id: 8, user_id: 99 }],
          userId: 1,
        }),
    })
  app.mount(host)
  try {
    expect(host.textContent).toBe('<Alice>, Member 3 and 2 others are typing…')
    expect(host.querySelector('alice')).toBeNull()
    expect(host.querySelector('[role=status]')?.getAttribute('aria-live')).toBe('polite')
    expect(host.querySelector('[role=status]')?.getAttribute('aria-atomic')).toBe('true')
  } finally {
    app.unmount()
  }
})
it('hides unknown state and uses singular for one participant', () => {
  for (const phase of ['unknown', 'unavailable', 'ready'] as const) {
    const host = document.createElement('div'),
      app = createApp({
        render: () =>
          h(TypingIndicator, {
            activity: { ...ready, phase, typingUserIds: [2] },
            members,
            userId: 1,
          }),
      })
    app.mount(host)
    expect(host.textContent).toBe(phase === 'ready' ? '<Alice> is typing…' : '')
    app.unmount()
  }
})
