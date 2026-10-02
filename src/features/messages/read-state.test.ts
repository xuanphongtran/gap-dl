import { describe, expect, it } from 'vitest'
import { retainReadCursor } from './read-state'

describe('read state cursor', () => {
  it('keeps the newer cursor when a stale poll arrives', () => {
    expect(
      retainReadCursor(
        { room_id: 7, last_read_message_id: 12, unread_count: 0 },
        {
          room_id: 7,
          last_read_message_id: 8,
          unread_count: 4,
        },
      ),
    ).toEqual({ room_id: 7, last_read_message_id: 12, unread_count: 0 })
  })

  it('accepts a newer server cursor and unread projection', () => {
    expect(
      retainReadCursor(
        { room_id: 7, last_read_message_id: 8, unread_count: 4 },
        {
          room_id: 7,
          last_read_message_id: 12,
          unread_count: 0,
        },
      ),
    ).toEqual({ room_id: 7, last_read_message_id: 12, unread_count: 0 })
  })
})
