// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { http } from '../../lib/http'
import { saveSession } from '../../lib/session'
import type { Message } from '../../types'
import { recoverMessageGap, refreshRetainedMessages } from './recoverMessageGap'

function message(id: number, revision = 1): Message {
  return {
    id,
    room_id: 7,
    user_id: 2,
    username: 'reader',
    content: `Message ${id}`,
    created_at: '2026-10-14T00:00:00Z',
    revision,
    edited_at: null,
    deleted_at: null,
  }
}
const mock = new MockAdapter(http)
afterEach(() => {
  mock.reset()
  sessionStorage.clear()
})
function serve(ids: number[]) {
  saveSession({ access_token: 'test', refresh_token: 'refresh', expires_at: 0 })
  mock.onGet('/api/v1/rooms/7/messages').reply((config) => {
    const before = config.params.before ?? Infinity
    return [
      200,
      {
        messages: ids
          .filter((id) => id < before)
          .slice(0, 40)
          .map((id) => message(id)),
      },
    ]
  })
}
it('bridges a 45-message gap with exclusive older-page cursors', async () => {
  serve(Array.from({ length: 46 }, (_, i) => 46 - i))
  const result = await recoverMessageGap(7, [message(1)], new AbortController().signal)
  expect(result.gap).toBe(false)
  expect(result.messages.map((m) => m.id)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
  expect(mock.history.get.map((c) => c.params.before)).toEqual([undefined, 7])
})
it('never restores tombstone text or overwrites a newer revision', async () => {
  serve([3, 2, 1])
  const tombstone = { ...message(2, 4), content: '', deleted_at: '2026-10-14T00:01:00Z' }
  const result = await recoverMessageGap(
    7,
    [message(1, 3), tombstone],
    new AbortController().signal,
  )
  expect(result.messages.find((m) => m.id === 1)?.revision).toBe(3)
  expect(result.messages.find((m) => m.id === 2)).toEqual(tombstone)
})
it('terminates on empty history and at the end of an exact 40-message page', async () => {
  serve([])
  expect((await recoverMessageGap(7, [message(1)], new AbortController().signal)).gap).toBe(false)
  mock.resetHistory()
  serve(Array.from({ length: 40 }, (_, i) => 100 - i))
  expect((await recoverMessageGap(7, [message(1)], new AbortController().signal)).gap).toBe(false)
  expect(mock.history.get.map((c) => c.params.before)).toEqual([undefined, 61])
})
it('exposes a gap after ten additional full pages without overlap', async () => {
  serve(Array.from({ length: 1000 }, (_, i) => 2000 - i))
  const result = await recoverMessageGap(7, [message(1)], new AbortController().signal)
  expect(result.gap).toBe(true)
  expect(mock.history.get).toHaveLength(11)
})
it('does not turn an aborted recovery into a partial success', async () => {
  const controller = new AbortController()
  serve([3, 2, 1])
  controller.abort()
  await expect(recoverMessageGap(7, [message(1)], controller.signal)).rejects.toBeDefined()
  expect(mock.history.get).toHaveLength(0)
})

it('refreshes sparse retained ranges with stable cursors despite newer arrivals', async () => {
  serve(Array.from({ length: 200 }, (_, i) => 200 - i))
  const result = await refreshRetainedMessages(
    7,
    [message(1), message(85)],
    new AbortController().signal,
  )
  expect(result.pages.flat().map((m) => m.id)).toEqual(Array.from({ length: 85 }, (_, i) => 85 - i))
  expect(result.pageParams).toEqual([86, 46, 6])
})
it('rejects a nonadvancing retained-history cursor without reporting recovery success', async () => {
  serve([])
  mock
    .onGet('/api/v1/rooms/7/messages')
    .reply(200, { messages: Array.from({ length: 40 }, () => message(85)) })
  await expect(
    refreshRetainedMessages(7, [message(1), message(85)], new AbortController().signal),
  ).rejects.toThrow('cursor did not advance')
})
