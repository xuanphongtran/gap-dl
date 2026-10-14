import { afterEach, expect, it } from 'vitest'
import { queryClient, queryKeys, clearRoomQueries } from '../../lib/query'
import type { Message } from '../../types'
import { normalizeSearchQuery, validateSearchPage, mergeSearchResults } from './message-search'

function message(id: number, revision = 1): Message {
  return {
    id,
    room_id: 7,
    user_id: 1,
    username: 'owner',
    content: 'matching text',
    created_at: '2026-10-14T00:00:00Z',
    revision,
    edited_at: null,
    deleted_at: null,
  }
}
afterEach(() => queryClient.clear())
it('trims and validates the 256-byte UTF-8 search bound', () => {
  expect(normalizeSearchQuery('  hello  ')).toEqual({ query: 'hello', error: '' })
  for (const input of ['', '   ', 'a'.repeat(257), 'á'.repeat(129)])
    expect(normalizeSearchQuery(input).error).not.toBe('')
  for (const input of ['a'.repeat(256), 'á'.repeat(128)])
    expect(normalizeSearchQuery(input).error).toBe('')
})
it('validates exclusive safe result IDs and the server cursor', () => {
  expect(() =>
    validateSearchPage({ messages: [message(3), message(2)], next_before: 2 }, 7, 4),
  ).not.toThrow()
  expect(() => validateSearchPage({ messages: [], next_before: null }, 7)).not.toThrow()
  for (const page of [
    { messages: [], next_before: 2 },
    { messages: [message(3)], next_before: 4 },
    { messages: [message(4)], next_before: null },
    { messages: [message(0)], next_before: null },
    { messages: [message(Number.MAX_SAFE_INTEGER + 1)], next_before: null },
    { messages: [{ ...message(3), room_id: 8 }], next_before: null },
  ])
    expect(() => validateSearchPage(page, 7, 4)).toThrow()
})
it('deduplicates descending results without reviving deleted or edited-out matches', () => {
  const pages = [
    { messages: [message(3), message(2)], next_before: 2 },
    { messages: [message(2, 2), message(1)], next_before: null },
  ]
  expect(mergeSearchResults(pages, []).map((m) => [m.id, m.revision])).toEqual([
    [3, 1],
    [2, 2],
    [1, 1],
  ])
  expect(
    mergeSearchResults(pages, [
      { ...message(3, 2), content: 'no longer matching' },
      { ...message(1, 2), content: '', deleted_at: '2026-10-14T01:00:00Z' },
    ]).map((m) => m.id),
  ).toEqual([2])
})
it('scopes search to room, account and query and removes it with room cleanup', () => {
  const keys = [
    queryKeys.searchMessages(7, 1, 'hello'),
    queryKeys.searchMessages(7, 2, 'hello'),
    queryKeys.searchMessages(7, 1, 'other'),
  ]
  expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(3)
  for (const key of keys) queryClient.setQueryData(key, { messages: [] })
  const other = queryKeys.searchMessages(8, 1, 'hello')
  queryClient.setQueryData(other, { messages: [] })
  clearRoomQueries(7)
  expect(queryClient.getQueriesData({ queryKey: queryKeys.messageSearch(7) })).toEqual([])
  expect(queryClient.getQueryData(other)).toEqual({ messages: [] })
})
