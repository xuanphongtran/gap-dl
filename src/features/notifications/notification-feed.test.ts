import { describe, expect, it } from 'vitest'
import { mergeNotifications, validateNotificationPage } from './notification-feed'
import type { Notification } from '../../types'
const note = (id: number): Notification => ({
  id,
  kind: 'future-kind',
  room_id: 7,
  message_id: 8,
  created_at: '2026-10-14T10:00:00Z',
  read_at: null,
  availability: 'available',
})
describe('private feed projection', () => {
  it('retains acknowledgements and deletion when an older duplicate arrives', () => {
    const acknowledged = {
      ...note(2),
      read_at: '2026-10-14T11:00:00Z',
      availability: 'deleted' as const,
    }
    expect(
      mergeNotifications(
        [{ notifications: [note(1), note(2), note(2)], next_before: null }],
        [acknowledged],
      ),
    ).toEqual([acknowledged, note(1)])
  })
  it('accepts open string kinds but refuses unsafe and nonadvancing cursor pages', () => {
    expect(() =>
      validateNotificationPage({ notifications: [note(2)], next_before: 2 }, 3),
    ).not.toThrow()
    for (const page of [
      { notifications: [note(0)], next_before: null },
      { notifications: [], next_before: 1 },
      { notifications: [note(2)], next_before: 3 },
      { notifications: [note(3)], next_before: null },
    ]) {
      expect(() => validateNotificationPage(page, 3)).toThrow()
    }
    expect(() =>
      validateNotificationPage({
        notifications: [{ ...note(2), read_at: 'invalid' }],
        next_before: null,
      }),
    ).toThrow()
  })
})
