import type { AttachmentSummary, Message } from '../../types'
export function safeMessageAttachments(message: Message): AttachmentSummary[] {
  if (message.deleted_at || !Array.isArray(message.attachments)) return []
  const seen = new Set<number>()
  return message.attachments
    .flatMap((a) => {
      if (
        !a ||
        !Number.isSafeInteger(a.id) ||
        a.id <= 0 ||
        seen.has(a.id) ||
        a.verified !== true ||
        typeof a.filename !== 'string' ||
        !a.filename.trim() ||
        new TextEncoder().encode(a.filename).length > 255 ||
        a.filename.includes('/') ||
        a.filename.includes('\\') ||
        Array.from(a.filename).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
        !['image/png', 'image/jpeg', 'text/plain'].includes(a.content_type) ||
        !Number.isSafeInteger(a.size_bytes) ||
        a.size_bytes < 1 ||
        a.size_bytes > 10485760 ||
        typeof a.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(a.sha256)
      )
        return []
      seen.add(a.id)
      return [
        {
          id: a.id,
          filename: a.filename,
          content_type: a.content_type,
          size_bytes: a.size_bytes,
          sha256: a.sha256,
          verified: true,
        },
      ]
    })
    .slice(0, 5)
}
