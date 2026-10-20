import { expect, it } from 'vitest'
import { validateApiContract } from './check-api-contract.mjs'
const download = '/api/v1/rooms/{id}/messages/{message_id}/attachments/{attachment_id}/download'
it('requires download and typed safe summary, ticket and upload/send bounds', () => {
  const invalid = { swagger: '2.0', paths: {}, definitions: {} }
  expect(validateApiContract(invalid)).toContain('Missing GET ' + download)
  expect(validateApiContract(invalid).some((e) => e.includes('Attachment'))).toBe(true)
  const defs = {
    'internal_chat.Message': {
      properties: { attachments: { type: 'array', items: { $ref: '#/definitions/Summary' } } },
    },
    Summary: {
      properties: Object.fromEntries(
        ['id', 'filename', 'content_type', 'size_bytes', 'sha256', 'verified'].map((k) => [
          k,
          {
            type:
              k === 'verified'
                ? 'boolean'
                : ['id', 'size_bytes'].includes(k)
                  ? 'integer'
                  : 'string',
          },
        ]),
      ),
    },
    'internal_attachment.UploadRequest': {
      properties: {
        filename: { type: 'string' },
        content_type: { type: 'string' },
        sha256: { type: 'string' },
        size_bytes: { type: 'integer', minimum: 1, maximum: 10485760 },
      },
    },
    'internal_attachment.Metadata': {
      properties: Object.fromEntries(
        [
          'id',
          'filename',
          'content_type',
          'size_bytes',
          'sha256',
          'verified',
          'state',
          'created_at',
          'upload_expires_at',
          'expires_at',
        ].map((k) => [
          k,
          {
            type:
              k === 'verified'
                ? 'boolean'
                : ['id', 'size_bytes'].includes(k)
                  ? 'integer'
                  : 'string',
          },
        ]),
      ),
    },
    'internal_attachment.UploadTicket': {
      properties: {
        attachment: { $ref: '#/definitions/internal_attachment.Metadata' },
        method: { type: 'string' },
        headers: { type: 'object' },
        upload_url: { type: 'string' },
      },
    },
    'internal_attachment.DownloadTicket': {
      properties: { download_url: { type: 'string' }, expires_at: { type: 'string' } },
    },
    'internal_chat.SendMessageRequest': {
      properties: { attachment_ids: { type: 'array', maxItems: 5, items: { type: 'integer' } } },
    },
  }
  const doc = { swagger: '2.0', paths: { [download]: { get: {} } }, definitions: defs }
  expect(validateApiContract(doc).filter((e) => /Attachment|attachment_ids/.test(e))).toEqual([])
  defs.Summary.properties.verified.type = 'string'
  expect(validateApiContract(doc).some((e) => e.includes('AttachmentSummary.verified'))).toBe(true)
  defs['internal_chat.SendMessageRequest'].properties.attachment_ids.maxItems = 6
  expect(validateApiContract(doc)).toContain('SendMessageRequest.attachment_ids limit changed')
})
