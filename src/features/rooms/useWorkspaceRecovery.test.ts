// @vitest-environment jsdom
import { useQuery } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { clearSession, saveSession } from '../../lib/session'
import { begin, end, mock, mountFeature, settle } from '../notifications/notification-test-utils'
import { useWorkspaceRecovery } from './useWorkspaceRecovery'

beforeEach(() => {
  begin()
  mock.onGet('/api/v1/users/me/invitations').reply(200, { invitations: [] })
})
afterEach(end)
function mount() {
  return mountFeature(() => {
    useQuery({
      queryKey: queryKeys.profile,
      queryFn: ({ signal }) => api.profile(signal),
      retry: false,
    })
    useQuery({
      queryKey: queryKeys.rooms,
      queryFn: ({ signal }) => api.rooms(signal),
      retry: false,
    })
    useQuery({
      queryKey: queryKeys.invitations,
      queryFn: ({ signal }) => api.invitations(signal),
      retry: false,
    })
    return useWorkspaceRecovery()
  }).value
}
it('retry_refetches_active_workspace_reads_only', async () => {
  const f = mount()
  await settle()
  queryClient.setQueryData(queryKeys.room(7), { name: 'Unrelated' })
  mock.resetHistory()
  await f.retry()
  expect(mock.history.get.map((c) => c.url).sort()).toEqual([
    '/api/v1/rooms',
    '/api/v1/users/me',
    '/api/v1/users/me/invitations',
  ])
  expect(
    mock.history.post.concat(mock.history.put, mock.history.patch, mock.history.delete),
  ).toHaveLength(0)
})
it('double_retry_is_single_flight', async () => {
  const f = mount()
  await settle()
  let release!: (v: [number, object]) => void
  mock.onGet('/api/v1/rooms').reply(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  mock.resetHistory()
  const first = f.retry()
  await settle()
  expect(f.pending.value).toBe(true)
  await f.retry()
  expect(mock.history.get.filter((c) => c.url === '/api/v1/rooms')).toHaveLength(1)
  release([200, { rooms: [] }])
  await first
  expect(f.pending.value).toBe(false)
})
it('logout_cancels_recovery', async () => {
  const f = mount()
  await settle()
  let release!: (v: [number, object]) => void
  let signal: AbortSignal | undefined
  mock.onGet('/api/v1/rooms').reply((c) => {
    signal = c.signal as AbortSignal
    return new Promise((r) => {
      release = r
    })
  })
  const retry = f.retry()
  await settle()
  clearSession()
  queryClient.clear()
  expect(signal?.aborted).toBe(true)
  release([200, { rooms: [{ id: 99, name: 'Old private' }] }])
  await retry
  expect(f.error.value).toBe('')
  expect(f.pending.value).toBe(false)
  expect(queryClient.getQueryData(queryKeys.rooms)).toBeUndefined()
})
it('new_account_ignores_old_recovery_feedback', async () => {
  const f = mount()
  await settle()
  let release!: (v: [number, object]) => void
  mock.onGet('/api/v1/rooms').reply(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  const retry = f.retry()
  await settle()
  queryClient.clear()
  saveSession({ access_token: 'second', refresh_token: 'second-refresh', expires_at: 0 }, true)
  queryClient.setQueryData(queryKeys.rooms, { rooms: [] })
  release([503, { error: 'Old account outage' }])
  await retry
  expect(f.error.value).toBe('')
  expect(queryClient.getQueryData(queryKeys.rooms)).toEqual({ rooms: [] })
})
it('explicit_retry_respects_retry_after_5 including the initial read failure', async () => {
  mock.onGet('/api/v1/rooms').reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  const f = mount()
  await settle()
  expect(f.cooldownSeconds.value).toBe(5)
  mock.resetHistory()
  await f.retry()
  await vi.advanceTimersByTimeAsync(4999)
  await f.retry()
  expect(mock.history.get).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [] })
  await f.retry()
  expect(mock.history.get.filter((c) => c.url === '/api/v1/rooms')).toHaveLength(1)
  expect(f.error.value).toBe('')
})
it('successful recovery clears only the failed read feedback', async () => {
  mock.onGet('/api/v1/rooms').reply(503, { error: 'unavailable' })
  const f = mount()
  await settle()
  expect(f.error.value).toContain('temporarily unavailable')
  mock.onGet('/api/v1/rooms').reply(200, { rooms: [] })
  await f.retry()
  expect(f.error.value).toBe('')
})
