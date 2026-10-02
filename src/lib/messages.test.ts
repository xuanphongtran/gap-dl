import { describe, expect, it } from 'vitest'
import { mergeMessages } from './messages'
import type { Message } from '../types'

function message(id: number): Message {
  return {
    id,
    room_id: 1,
    user_id: 1,
    username: 'tester',
    content: `Message ${id}`,
    created_at: '2026-09-28T00:00:00Z',
    revision: 1,
    edited_at: null,
    deleted_at: null,
  }
}

describe('mergeMessages', () => {
  it('merges overlapping pages by ID in ascending order', () => {
    expect(
      mergeMessages([message(4), message(5)], [message(2), message(4), message(3)]).map(
        (item) => item.id,
      ),
    ).toEqual([2, 3, 4, 5])
  })

  it('keeps a newer tombstone when an older page arrives later', () => {
    const deleted = {
      ...message(4),
      revision: 3,
      content: '',
      deleted_at: '2026-10-02T00:00:00Z',
    }
    expect(mergeMessages([deleted], [message(4)])[0]).toEqual(deleted)
  })
})
