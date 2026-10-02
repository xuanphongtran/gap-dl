// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api } from './api'
import { http } from './http'
import { saveSession } from './session'

let mock: MockAdapter

beforeEach(() => {
  sessionStorage.clear()
  saveSession({ access_token: 'test-access', refresh_token: 'test-refresh', expires_at: 0 })
  mock = new MockAdapter(http)
})

afterEach(() => mock.restore())

describe('documented message contract', () => {
  it('sends a bounded page request with an older-message cursor', async () => {
    mock.onGet('/api/v1/rooms/7/messages').reply((config) => {
      expect(config.params).toEqual({ limit: 40, before: 21 })
      expect(config.headers?.Authorization).toBe('Bearer test-access')
      return [200, { messages: [] }]
    })
    await expect(api.messages(7, 40, 21)).resolves.toEqual({ messages: [] })
  })

  it('passes through a message with nullable author and tombstone fields', async () => {
    const tombstone = {
      id: 21,
      room_id: 7,
      user_id: null,
      username: 'Deleted user',
      content: '',
      created_at: '2026-10-02T00:00:00Z',
      revision: 2,
      edited_at: null,
      deleted_at: '2026-10-02T00:01:00Z',
    }
    mock.onGet('/api/v1/rooms/7/messages').reply(200, { messages: [tombstone] })
    await expect(api.messages(7)).resolves.toEqual({ messages: [tombstone] })
  })

  it('posts message content to the room endpoint', async () => {
    mock.onPost('/api/v1/rooms/7/messages').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ content: 'Hello' })
      return [201, { id: 21, content: 'Hello' }]
    })
    await expect(api.sendMessage(7, 'Hello')).resolves.toMatchObject({ id: 21 })
  })
})
