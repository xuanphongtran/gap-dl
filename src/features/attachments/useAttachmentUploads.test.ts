// @vitest-environment jsdom
import { ref } from 'vue'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { queryClient, queryKeys } from '../../lib/query'
import { uploadHttp } from '../../lib/http'
import { saveSession } from '../../lib/session'
import { begin, end, mock, mountFeature, settle } from '../notifications/notification-test-utils'
import { attachment, file } from './attachment-test-utils'
import { useAttachmentUploads } from './useAttachmentUploads'
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const storage = new MockAdapter(uploadHttp)
beforeEach(() => {
  begin()
  vi.stubGlobal('crypto', webcrypto)
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(201, {
    attachment: attachment(10, 'pending_upload'),
    method: 'PUT',
    headers: {},
    upload_url: 'https://storage.test/file?signature=private-secret',
  })
  mock.onPost('/api/v1/rooms/7/attachments/10/complete').reply(202, attachment(10, 'processing'))
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment())
  mock.onDelete(/\/attachments\/\d+$/).reply(204)
  storage.onPut().reply(200)
})
afterEach(() => {
  end()
  storage.reset()
  vi.unstubAllGlobals()
})
function mount() {
  const roomId = ref(7),
    userId = ref<number | undefined>(1),
    enabled = ref(true),
    lost = vi.fn()
  const mounted = mountFeature(() =>
    useAttachmentUploads({ roomId, userId, enabled, onAccessLost: lost }),
  )
  return { f: mounted.value, roomId, userId, enabled, lost }
}
it('ready_releases_files_and_tickets_from_query_and_mutation_cache; duplicate/max5 selections reserve once', async () => {
  const { f } = mount(),
    a = file()
  await f.select([a])
  await settle()
  expect(f.readyAttachments.value.map((x) => x.id)).toEqual([10])
  expect(f.blocked.value).toBe(false)
  await f.select([a])
  await settle()
  expect(mock.history.post.filter((c) => c.url?.endsWith('/uploads'))).toHaveLength(1)
  await f.select(Array.from({ length: 6 }, (_, i) => file('a', i + '.txt')))
  expect(f.selectionError.value).not.toBe('')
  const cached = [
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
    ...queryClient
      .getMutationCache()
      .getAll()
      .map((m) => ({
        variables: m.state.variables,
        data: m.state.data,
        context: m.state.context,
        error: m.state.error,
      })),
  ]
  expect(JSON.stringify(cached)).not.toContain('private-secret')
  expect(JSON.stringify(f.rows.value)).not.toMatch(/upload_url|signature|arrayBuffer/)
})
it('cancel_before_reservation_returns_never_restores_row', async () => {
  let release!: (v: [number, object]) => void
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  const { f } = mount()
  const selected = f.select([file()])
  await settle()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await f.remove(f.rows.value[0]!.localId)
  release([
    201,
    {
      attachment: attachment(10, 'pending_upload'),
      method: 'PUT',
      headers: {},
      upload_url: 'https://storage.test/file',
    },
  ])
  await selected
  await settle()
  expect(f.rows.value).toHaveLength(0)
  expect(storage.history.put).toHaveLength(0)
})
it('account_switch_does_not_cancel_with_new_token', async () => {
  let release!: (v: [number, object]) => void
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  const { f, userId } = mount(),
    work = f.select([file()])
  await settle()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  saveSession({ access_token: 'second', refresh_token: 'second-refresh', expires_at: 0 }, true)
  userId.value = 2
  release([
    201,
    {
      attachment: attachment(),
      method: 'PUT',
      headers: {},
      upload_url: 'https://storage.test/file',
    },
  ])
  await work
  await settle()
  expect(f.rows.value).toHaveLength(0)
  expect(mock.history.delete).toHaveLength(0)
  expect(queryClient.getQueryData(queryKeys.attachment(7, 1, 10))).toBeUndefined()
})
it('room_switch_cancels_only_known_unbound_ids and pending_send_ids_are_not_cancelled_on_scope_disposal', async () => {
  const { f, roomId } = mount()
  await f.select([file()])
  await settle()
  f.claimForSend([10])
  roomId.value = 8
  await settle()
  expect(mock.history.delete).toHaveLength(0)
  expect(f.rows.value).toHaveLength(0)
})
it('room_switch_cancels_known_unbound_ready_file_once', async () => {
  const { f, roomId } = mount()
  await f.select([file()])
  await settle()
  roomId.value = 8
  await settle()
  expect(mock.history.delete).toHaveLength(1)
})
it('uncertain_put_or_412_requires_explicit_reconciliation', async () => {
  storage.onPut().reply(412)
  const { f } = mount()
  await f.select([file()])
  await settle()
  expect(f.readyAttachments.value).toHaveLength(0)
  expect(storage.history.put).toHaveLength(1)
  const key = mock.history.post[0]!.headers?.['Idempotency-Key']
  await f.retry(f.rows.value[0]!.localId)
  await settle()
  expect(storage.history.put).toHaveLength(1)
  expect(f.readyAttachments.value).toHaveLength(1)
  expect(mock.history.post.filter((c) => c.url?.endsWith('/uploads'))).toHaveLength(1)
  expect(mock.history.post[0]!.headers?.['Idempotency-Key']).toBe(key)
})
it('processing_202_is_not_ready and unknown_state_and_60s_active_timeout_show_check_status', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment(10, 'future-state'))
  const { f } = mount()
  await f.select([file()])
  await settle()
  expect(f.blocked.value).toBe(true)
  expect(f.readyAttachments.value).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(60001)
  await settle()
  expect(f.rows.value[0]!.error).not.toBe('')
  const before = mock.history.get.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(mock.history.get).toHaveLength(before)
})
it('hidden_time_does_not_consume_active_observation and ready_expiry_blocks_claim', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment(10, 'processing'))
  const { f } = mount()
  await f.select([file()])
  await settle()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  const before = mock.history.get.length
  await vi.advanceTimersByTimeAsync(61000)
  expect(mock.history.get).toHaveLength(before)
  expect(f.rows.value[0]!.error).toBe('')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  mock
    .onGet('/api/v1/rooms/7/attachments/10')
    .reply(200, attachment(10, 'ready', { expires_at: new Date(Date.now() + 1000).toISOString() }))
  await f.check(f.rows.value[0]!.localId)
  await settle()
  await vi.advanceTimersByTimeAsync(1001)
  expect(() => f.claimForSend([10])).toThrow()
})
it('staggered429 gates poll focus and manual checks until the latest absolute deadline', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  const { f } = mount()
  await f.select([file()])
  await settle()
  const id = f.rows.value[0]!.localId
  const count = mock.history.get.length
  await vi.advanceTimersByTimeAsync(4999)
  await f.check(id)
  window.dispatchEvent(new Event('focus'))
  await settle()
  expect(mock.history.get).toHaveLength(count)
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment())
  await vi.advanceTimersByTimeAsync(1)
  await f.check(id)
  await settle()
  expect(f.readyAttachments.value).toHaveLength(1)
})

it('cached_ready_result_cannot_be_claimed_after_expiry_between_ticks', async () => {
  mock
    .onGet('/api/v1/rooms/7/attachments/10')
    .reply(200, attachment(10, 'ready', { expires_at: new Date(Date.now() + 1010).toISOString() }))
  const { f } = mount()
  await f.select([file()])
  await settle()
  expect(f.readyAttachments.value).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1011)
  expect(() => f.claimForSend([10])).toThrow()
})
it('explicit_check_restarts_processing_observation_after_timeout', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment(10, 'processing'))
  const { f } = mount()
  await f.select([file()])
  await settle()
  await vi.advanceTimersByTimeAsync(60001)
  await f.check(f.rows.value[0]!.localId)
  await settle()
  const count = mock.history.get.length
  await vi.advanceTimersByTimeAsync(2500)
  await settle()
  expect(mock.history.get.length).toBeGreaterThan(count)
})
it('foreground_recovery_preserves_the_active_observation_budget', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(200, attachment(10, 'processing'))
  const { f } = mount()
  await f.select([file()])
  await settle()
  await vi.advanceTimersByTimeAsync(30000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  await vi.advanceTimersByTimeAsync(30001)
  expect(f.rows.value[0]!.error).toContain('longer')
})
it('a_later_file429_keeps_its_full_five_second_deadline', async () => {
  mock.onGet('/api/v1/rooms/7/attachments/10').reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  const { f } = mount()
  await f.select([file()])
  await settle()
  await vi.advanceTimersByTimeAsync(500)
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(201, {
    attachment: attachment(11, 'pending_upload'),
    method: 'PUT',
    headers: {},
    upload_url: 'https://storage.test/second',
  })
  mock.onPost('/api/v1/rooms/7/attachments/11/complete').reply(202, attachment(11, 'processing'))
  mock.onGet('/api/v1/rooms/7/attachments/11').reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  await f.select([file('b', 'b.txt')])
  await settle()
  const id = f.rows.value.find((r) => r.attachmentId === 11)!.localId
  const count = () => mock.history.get.filter((c) => c.url?.endsWith('/11')).length
  const before = count()
  await vi.advanceTimersByTimeAsync(4500)
  await f.check(id)
  expect(count()).toBe(before)
  mock.onGet('/api/v1/rooms/7/attachments/11').reply(200, attachment(11))
  await vi.advanceTimersByTimeAsync(500)
  await f.check(id)
  await settle()
  expect(f.readyAttachments.value.some((a) => a.id === 11)).toBe(true)
})

it('completing during temporary authorization pause must remain recoverable', async () => {
  let release!: (v: [number, object]) => void
  mock.onPost('/api/v1/rooms/7/attachments/10/complete').reply(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  const { f, enabled } = mount()
  const work = f.select([file()])
  await settle()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  enabled.value = false
  release([202, attachment(10, 'processing')])
  await work
  enabled.value = true
  await settle()
  await vi.advanceTimersByTimeAsync(5000)
  await f.retry(f.rows.value[0]!.localId)
  await settle()
  expect(f.rows.value[0]!.phase).toBe('ready')
  expect(mock.history.post.filter((c) => c.url?.endsWith('/complete'))).toHaveLength(1)
})
it.each(['hashing', 'reserving', 'uploading'] as const)(
  'temporary authorization pause during %s resumes without replaying writes',
  async (phase) => {
    let release!: () => void
    let selected = file()
    if (phase === 'hashing') {
      selected = new File(['a'], 'a.txt', { type: 'text/plain' })
      Object.defineProperty(selected, 'arrayBuffer', {
        value: () =>
          new Promise<ArrayBuffer>((resolve) => {
            release = () => resolve(new TextEncoder().encode('a').buffer)
          }),
      })
    }
    if (phase === 'reserving')
      mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve([
                201,
                {
                  attachment: attachment(10, 'pending_upload'),
                  method: 'PUT',
                  headers: {},
                  upload_url: 'https://storage.test/file',
                },
              ])
          }),
      )
    if (phase === 'uploading')
      storage.onPut().reply(
        () =>
          new Promise((resolve) => {
            release = () => resolve([200])
          }),
      )
    const { f, enabled } = mount()
    const work = f.select([selected])
    await settle()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    enabled.value = false
    release()
    await settle()
    expect(mock.history.post.filter((c) => c.url?.endsWith('/complete'))).toHaveLength(0)
    enabled.value = true
    await work
    await settle()
    expect(f.rows.value[0]!.phase).toBe('ready')
    expect(storage.history.put).toHaveLength(1)
    expect(mock.history.post.filter((c) => c.url?.endsWith('/uploads'))).toHaveLength(1)
    expect(mock.history.post.filter((c) => c.url?.endsWith('/complete'))).toHaveLength(1)
  },
)

it('paused pipeline exits on room change without sending more file bytes', async () => {
  let release!: () => void
  mock.onPost('/api/v1/rooms/7/attachments/uploads').reply(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve([
            201,
            {
              attachment: attachment(10, 'pending_upload'),
              method: 'PUT',
              headers: {},
              upload_url: 'https://storage.test/file',
            },
          ])
      }),
  )
  const { f, enabled, roomId } = mount()
  const work = f.select([file()])
  await settle()
  enabled.value = false
  release()
  await settle()
  roomId.value = 8
  await work
  enabled.value = true
  await settle()
  expect(f.rows.value).toHaveLength(0)
  expect(storage.history.put).toHaveLength(0)
})
