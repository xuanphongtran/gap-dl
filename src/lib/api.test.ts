// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './api'
import { clearSession, readSession, saveSession } from './session'

const ok = (value: object) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })

describe('API session refresh', () => {
  beforeEach(() => {
    sessionStorage.clear()
    saveSession({ access_token: 'old', refresh_token: 'refresh-old', expires_at: 0 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shares one refresh request across concurrent 401 responses', async () => {
    let refreshCount = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshCount++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return ok({ access_token: 'new', refresh_token: 'refresh-new', expires_at: 1 })
      }
      return new Headers(init?.headers).get('Authorization') === 'Bearer new'
        ? ok({ ok: true })
        : unauthorized()
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await Promise.all([
      request<{ ok: boolean }>('/one'),
      request<{ ok: boolean }>('/two'),
    ])
    expect(result).toEqual([{ ok: true }, { ok: true }])
    expect(refreshCount).toBe(1)
    expect(readSession()?.access_token).toBe('new')
  })

  it('clears the session when the refresh token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    )
    await expect(request('/private')).rejects.toThrow()
    expect(readSession()).toBeNull()
  })

  it('does not restore a session after logout during refresh', async () => {
    let resolveRefresh: ((response: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        if (String(input).endsWith('/auth/refresh')) {
          return new Promise<Response>((resolve) => {
            resolveRefresh = resolve
          })
        }
        return Promise.resolve(unauthorized())
      }),
    )

    const pending = request('/private')
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf('function'))
    clearSession()
    resolveRefresh!(ok({ access_token: 'new', refresh_token: 'refresh-new', expires_at: 1 }))
    await expect(pending).rejects.toThrow('Your session has changed.')
    expect(readSession()).toBeNull()
  })

  it('aborts a request when its caller is disposed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    const controller = new AbortController()
    const pending = request('/private', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
