// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { expect, it } from 'vitest'
import type { RoomActivityState } from './realtime-context'
import RoomActivityStatus from './RoomActivityStatus.vue'
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
it('counts only authorized room members and distinguishes unknown from offline', () => {
  for (const phase of ['unknown', 'unavailable', 'ready'] as const) {
    const host = document.createElement('div'),
      app = createApp({
        render: () => h(RoomActivityStatus, { activity: { ...ready, phase }, members }),
      })
    app.mount(host)
    expect(host.textContent).toBe(
      phase === 'ready'
        ? '5 online'
        : phase === 'unknown'
          ? 'Checking activity'
          : 'Activity unavailable',
    )
    app.unmount()
  }
  const host = document.createElement('div'),
    app = createApp({
      render: () => h(RoomActivityStatus, { activity: ready, members, memberId: 2 }),
    })
  app.mount(host)
  expect(host.textContent).toBe('Online')
  app.unmount()
})
