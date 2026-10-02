// @vitest-environment jsdom
import MockAdapter from 'axios-mock-adapter'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { publicHttp } from '../lib/http'
import { queryClient, queryKeys } from '../lib/query'
import { readSession, saveSession } from '../lib/session'
import { useAuthStore } from './auth'

afterEach(() => {
  queryClient.clear()
  sessionStorage.clear()
})

it('clears prior account data on login and logout', async () => {
  setActivePinia(createPinia())
  saveSession({ access_token: 'previous', refresh_token: 'previous-refresh', expires_at: 0 })
  queryClient.setQueryData(queryKeys.latestMessages(7), [{ id: 1, content: 'Private' }])
  const mock = new MockAdapter(publicHttp)
  mock.onPost('/api/v1/auth/login').reply(200, {
    access_token: 'next',
    refresh_token: 'next-refresh',
    expires_at: 1,
  })
  try {
    const auth = useAuthStore()
    await auth.login('next@example.com', 'password')
    expect(readSession()?.access_token).toBe('next')
    expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
    queryClient.setQueryData(queryKeys.latestMessages(8), [{ id: 2, content: 'Next private' }])
    auth.logout()
    expect(readSession()).toBeNull()
    expect(queryClient.getQueryData(queryKeys.latestMessages(8))).toBeUndefined()
  } finally {
    mock.restore()
  }
})
