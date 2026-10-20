// @vitest-environment jsdom
import { h, ref } from 'vue'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { begin, end, mountFeature, settle, mock } from '../notifications/notification-test-utils'
import MessageAttachmentList from './MessageAttachmentList.vue'
import MessageRow from '../messages/MessageRow.vue'
import { attachmentMessage } from './attachment-test-utils'
beforeEach(begin)
afterEach(end)
it('renders file-only incoming content with safe names and hides every control on deletion', async () => {
  const message = ref(attachmentMessage())
  message.value.content = ''
  message.value.attachments[0]!.filename = '<img>.txt'
  const { host } = mountFeature(
    () => ({}),
    () =>
      h(MessageRow, {
        message: message.value,
        mine: false,
        time: 'now',
        userId: 1,
        attachmentsEnabled: true,
      }),
  )
  expect(host.textContent).toContain('<img>.txt')
  expect(host.querySelector('img')).toBeNull()
  expect(host.textContent).toContain('DOWNLOAD')
  expect(mock.history.get).toHaveLength(0)
  message.value = { ...message.value, revision: 2, deleted_at: '2026-10-20T00:00:00Z' }
  await settle()
  expect(host.textContent).not.toContain('<img>.txt')
  expect(host.textContent).not.toContain('DOWNLOAD')
})
it('does not render private filenames until authorized and shows neutral unavailable content', async () => {
  const message = attachmentMessage()
  const { host } = mountFeature(
    () => ({}),
    () => h(MessageAttachmentList, { message, userId: 1, enabled: false }),
  )
  expect(host.textContent).not.toContain('a.txt')
  const empty = { ...message, content: '', user_id: null, attachments: [] }
  const row = mountFeature(
    () => ({}),
    () => h(MessageRow, { message: empty, mine: false, time: 'now' }),
  )
  expect(row.host.textContent).toContain('Message content unavailable')
})
