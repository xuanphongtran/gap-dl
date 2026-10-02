// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { request } from './api'
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
  })
})
