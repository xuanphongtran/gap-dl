// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api, request } from './api'
import { ApiError, errorMessage, http, publicHttp } from './http'
import { clearSession, readSession, saveSession } from './session'

let privateMock: MockAdapter
let publicMock: MockAdapter

beforeEach(() => {
  sessionStorage.clear()
  saveSession({ access_token: 'old', refresh_token: 'refresh-old', expires_at: 0 })
  privateMock = new MockAdapter(http)
  publicMock = new MockAdapter(publicHttp)
})
afterEach(() => {
  privateMock.restore()
  publicMock.restore()
})

describe('Axios session refresh', () => {
  it('shares one refresh request across concurrent 401 responses', async () => {
    let refreshCount = 0
    publicMock.onPost('/api/v1/auth/refresh').reply(async () => {
      refreshCount++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return [200, { access_token: 'new', refresh_token: 'refresh-new', expires_at: 1 }]
    })
    privateMock
      .onGet(/\/(one|two)$/)
      .reply((config) =>
        config.headers?.Authorization === 'Bearer new'
          ? [200, { ok: true }]
          : [401, { error: 'unauthorized' }],
      )
    const result = await Promise.all([
      request<{ ok: boolean }>('/one'),
      request<{ ok: boolean }>('/two'),
    ])
    expect(result).toEqual([{ ok: true }, { ok: true }])
    expect(refreshCount).toBe(1)
    expect(readSession()?.access_token).toBe('new')
  })

  it('clears the session when refresh is rejected', async () => {
    privateMock.onGet('/private').reply(401, { error: 'unauthorized' })
    publicMock.onPost('/api/v1/auth/refresh').reply(401, { error: 'invalid token' })
    await expect(request('/private')).rejects.toThrow('invalid token')
    expect(readSession()).toBeNull()
  })

  it('does not restore a session after logout during refresh', async () => {
    let resolveRefresh: ((response: [number, object]) => void) | undefined
    privateMock.onGet('/private').reply(401, { error: 'unauthorized' })
    publicMock.onPost('/api/v1/auth/refresh').reply(
      () =>
        new Promise<[number, object]>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const pending = request('/private')
    await expect.poll(() => resolveRefresh).toBeTypeOf('function')
    clearSession()
    resolveRefresh!([200, { access_token: 'new', refresh_token: 'refresh-new', expires_at: 1 }])
    await expect(pending).rejects.toThrow('Your session has changed.')
    expect(readSession()).toBeNull()
  })

  it('refreshes the session without replaying a rejected write', async () => {
    let writes = 0
    privateMock.onPost('/private').reply(() => {
      writes++
      return [401, { error: 'unauthorized' }]
    })
    publicMock.onPost('/api/v1/auth/refresh').reply(200, {
      access_token: 'new',
      refresh_token: 'refresh-new',
      expires_at: 1,
    })
    await expect(request('/private', { method: 'POST' })).rejects.toThrow(
      'Session refreshed. Please retry this action.',
    )
    expect(writes).toBe(1)
    expect(readSession()?.access_token).toBe('new')
  })

  it('cancels a request with the caller signal', async () => {
    privateMock
      .onGet('/private')
      .reply(() => new Promise((resolve) => setTimeout(() => resolve([200, { ok: true }]), 20)))
    const controller = new AbortController()
    const pending = request('/private', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })

  it('returns undefined for a 204 response', async () => {
    privateMock.onDelete('/private').reply(204)
    await expect(request('/private', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('keeps rate-limit diagnostics and caps the retry delay', async () => {
    privateMock.onGet('/limited').reply(
      429,
      { error: 'too many requests' },
      {
        'Retry-After': '90000',
        'X-Request-ID': 'request-123',
      },
    )
    await expect(request('/limited')).rejects.toMatchObject({
      status: 429,
      requestId: 'request-123',
      retryAfterSeconds: 86_400,
    })
  })

  it('does not use an invalid retry delay or expose a server error body', async () => {
    privateMock
      .onGet('/limited')
      .reply(429, { error: 'too many requests' }, { 'Retry-After': 'soon' })
    await expect(request('/limited')).rejects.toMatchObject({ retryAfterSeconds: undefined })
    expect(errorMessage(new ApiError(503, 'internal database detail'))).toBe(
      'The server is temporarily unavailable. Please try again.',
    )
    expect(errorMessage(new ApiError(404, 'private room 7 exists'))).toBe(
      'This resource is unavailable or you no longer have access.',
    )
    expect(errorMessage(new ApiError(413, 'oversized HTTP body'))).toBe(
      'The request body is too large.',
    )
    expect(errorMessage(new ApiError(400, 'database connection string'))).toBe(
      'Check the information and try again.',
    )
    expect(errorMessage(new ApiError(403, 'private room details'))).toBe(
      'You do not have permission for this action.',
    )
  })
})

it('passes the search query, cursor and cancellation through the existing transport', async () => {
  const { api } = await import('./api')
  privateMock
    .onGet('/api/v1/rooms/7/messages/search')
    .reply(200, { messages: [], next_before: null })
  const controller = new AbortController()
  expect(await api.searchMessages(7, 'hello', undefined, undefined, controller.signal)).toEqual({
    messages: [],
    next_before: null,
  })
  expect(privateMock.history.get[0]?.params).toEqual({ q: 'hello', limit: 20 })
  expect(privateMock.history.get[0]?.signal).toBe(controller.signal)
  await api.searchMessages(7, 'hello', 10, 42)
  expect(privateMock.history.get[1]?.params).toEqual({ q: 'hello', limit: 10, before: 42 })
})

describe('notification contracts', () => {
  it('adds typed recipients and retry key without changing plain sends', async () => {
    const { api } = await import('./api')
    privateMock.onPost('/api/v1/rooms/7/messages').reply(201, { id: 1 })
    await api.sendMessage(7, 'plain')
    await api.sendMessage(7, 'mention', {
      mentionUserIds: [8],
      idempotencyKey: 'retry-key-0123456789',
    })
    expect(JSON.parse(privateMock.history.post[0]!.data)).toEqual({ content: 'plain' })
    expect(JSON.parse(privateMock.history.post[1]!.data)).toEqual({
      content: 'mention',
      mention_user_ids: [8],
    })
    expect(privateMock.history.post[1]!.headers?.['Idempotency-Key']).toBe('retry-key-0123456789')
  })
  it('propagates feed filters and cancellation and explicit false preferences', async () => {
    const { api } = await import('./api')
    privateMock
      .onGet('/api/v1/users/me/notifications')
      .reply(200, { notifications: [], next_before: null })
    privateMock.onPut().reply(200, {})
    const signal = new AbortController().signal
    await api.notifications(20, 9, true, signal)
    expect(privateMock.history.get[0]!.params).toEqual({ limit: 20, before: 9, unread_only: true })
    expect(privateMock.history.get[0]!.signal).toBe(signal)
    await api.updateNotificationPreferences(false)
    await api.updateRoomNotificationPreferences(7, false)
    await api.readNotification(9)
    expect(
      privateMock.history.put.map((c) => [c.url, c.data ? JSON.parse(c.data) : undefined]),
    ).toEqual([
      ['/api/v1/users/me/notification-preferences', { mentions_enabled: false }],
      ['/api/v1/rooms/7/notification-preferences', { muted: false }],
      ['/api/v1/users/me/notifications/9/read', undefined],
    ])
  })
})

it('reads presence through authenticated transport with AbortSignal', async () => {
  const data = { room_id: '7', online_user_ids: [1], typing_user_ids: [] },
    controller = new AbortController()
  privateMock.onGet('/api/v1/rooms/7/presence').reply(200, data)
  expect(await api.presence(7, controller.signal)).toEqual(data)
  expect(privateMock.history.get[0]!.signal).toBe(controller.signal)
  expect(privateMock.history.get[0]!.headers?.Authorization).toBe('Bearer old')
})
