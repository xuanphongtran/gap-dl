// @vitest-environment jsdom
import { ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { saveSession } from '../../lib/session'
import { queryClient } from '../../lib/query'
import { begin, end, mock, mountFeature, settle } from '../notifications/notification-test-utils'
import { attachment, attachmentMessage } from './attachment-test-utils'
import { useAttachmentDownload } from './useAttachmentDownload'
const url = '/api/v1/rooms/7/messages/9/attachments/10/download'
let opened: string[] = []
beforeEach(() => {
  begin()
  opened = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.rel).toContain('noreferrer')
    expect(this.referrerPolicy).toBe('no-referrer')
    opened.push(this.href)
  })
  mock.onGet(url).reply(200, {
    download_url: 'https://storage.test/download?signature=private-secret',
    expires_at: new Date(Date.now() + 60000).toISOString(),
  })
})
afterEach(end)
function mount() {
  const message = ref(attachmentMessage()),
    userId = ref<number | undefined>(1),
    enabled = ref(true),
    lost = vi.fn()
  const f = mountFeature(() =>
    useAttachmentDownload({ message, userId, enabled, onAccessLost: lost }),
  ).value
  return { f, message, userId, enabled, lost }
}
it('does_not_prefetch_and_uses_fresh_ephemeral_ticket_without_cache_or_storage_API_token', async () => {
  const { f } = mount()
  await settle()
  expect(mock.history.get).toHaveLength(0)
  await f.download(10)
  expect(opened).toHaveLength(1)
  expect(document.querySelector('a[href*="signature"]')).toBeNull()
  await f.download(10)
  expect(mock.history.get).toHaveLength(2)
  const states = queryClient
    .getMutationCache()
    .getAll()
    .map((m) => ({
      data: m.state.data,
      variables: m.state.variables,
      error: m.state.error,
      context: m.state.context,
    }))
  expect(JSON.stringify(states)).not.toMatch(/signature|private-secret|download_url/)
  expect(mock.history.get.every((c) => c.url?.startsWith('/api/v1/'))).toBe(true)
})
it.each(['account', 'room', 'deletion'] as const)(
  'late_ticket_is_ignored_after_%s',
  async (boundary) => {
    let release!: (v: [number, object]) => void
    mock.onGet(url).reply(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    const f = mount()
    const work = f.f.download(10)
    await settle()
    if (boundary === 'account') {
      saveSession({ access_token: 'second', refresh_token: 'refresh2', expires_at: 0 }, true)
      f.userId.value = 2
    }
    if (boundary === 'room') f.message.value = { ...f.message.value, room_id: 8 }
    if (boundary === 'deletion')
      f.message.value = { ...f.message.value, revision: 2, deleted_at: '2026-10-20T00:00:00Z' }
    release([
      200,
      {
        download_url: 'https://storage.test/private',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    ])
    await work
    expect(opened).toHaveLength(0)
  },
)
it('binding_404_does_not_revoke_authorized_room_or_other_file', async () => {
  mock.onGet(url).reply(404, { error: 'missing' })
  mock.onGet('/api/v1/rooms/7').reply(200, { id: 7, role: 'member' })
  const { f, message, lost } = mount()
  message.value.attachments.push(attachment(11))
  await f.download(10)
  expect(f.unavailable(10)).toBe(true)
  expect(f.unavailable(11)).toBe(false)
  expect(lost).not.toHaveBeenCalled()
  expect(mock.history.get.some((c) => c.url === '/api/v1/rooms/7')).toBe(true)
})
it('room_check503_is_not_proof_of_revocation_but_confirmed403_is', async () => {
  mock.onGet(url).reply(404, { error: 'missing' })
  mock.onGet('/api/v1/rooms/7').reply(503, { error: 'temporary' })
  const { f, lost, message } = mount()
  await f.download(10)
  expect(lost).not.toHaveBeenCalled()
  message.value = { ...message.value, revision: 2 }
  mock.onGet('/api/v1/rooms/7').reply(403, { error: 'revoked' })
  await f.download(10)
  expect(lost).toHaveBeenCalledWith(7)
})
it('independent429_deadlines_block_manual_retries_and_unsafe_URLs_never_navigate', async () => {
  mock.onGet(url).reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  const { f, message } = mount()
  message.value.attachments.push(attachment(11))
  mock
    .onGet('/api/v1/rooms/7/messages/9/attachments/11/download')
    .reply(429, { error: 'slow' }, { 'Retry-After': '5' })
  await f.download(10)
  await vi.advanceTimersByTimeAsync(500)
  await f.download(11)
  const count = mock.history.get.length
  await vi.advanceTimersByTimeAsync(4500)
  await f.download(11)
  expect(mock.history.get).toHaveLength(count)
  mock
    .onGet('/api/v1/rooms/7/messages/9/attachments/11/download')
    .reply(200, { download_url: 'javascript:alert(1)', expires_at: new Date().toISOString() })
  await vi.advanceTimersByTimeAsync(500)
  await f.download(11)
  expect(opened).toHaveLength(0)
  expect(f.error(11)).not.toContain('javascript')
})
it('normalizes_URL_bearing_errors_before_mutation_cache', async () => {
  mock.onGet(url).reply(503, { error: 'https://storage.test/private?signature=private-secret' })
  const { f } = mount()
  await f.download(10)
  expect(f.error(10)).not.toContain('private-secret')
  expect(
    JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ),
  ).not.toContain('private-secret')
})
it('queued_download_never_uses_a_replacement_account_token', async () => {
  const { f, userId } = mount()
  const work = f.download(10)
  saveSession(
    { access_token: 'replacement', refresh_token: 'replacement-refresh', expires_at: 0 },
    true,
  )
  userId.value = 2
  await work
  expect(mock.history.get).toHaveLength(0)
  expect(opened).toHaveLength(0)
})
