import type { AttachmentMetadata } from '../../types'
export function attachment(
  id = 10,
  state = 'ready',
  extra: Partial<AttachmentMetadata> = {},
): AttachmentMetadata {
  return {
    id,
    filename: 'a.txt',
    content_type: 'text/plain',
    size_bytes: 1,
    sha256: 'a'.repeat(64),
    verified: state === 'ready',
    state,
    created_at: new Date().toISOString(),
    upload_expires_at: new Date(Date.now() + 300000).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    ...extra,
  }
}
export function file(content = 'a', name = 'a.txt', type = 'text/plain'): File {
  const value = new File([content], name, { type })
  Object.defineProperty(value, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(content).buffer,
  })
  return value
}
