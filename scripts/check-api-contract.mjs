import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const url = process.env.SWAGGER_URL || 'https://gogo-dl.onrender.com/swagger/doc.json'
const requiredOperations = [
  ['post', '/api/v1/auth/login'],
  ['post', '/api/v1/auth/refresh'],
  ['post', '/api/v1/auth/register'],
  ['get', '/api/v1/users/me'],
  ['patch', '/api/v1/users/me'],
  ['delete', '/api/v1/users/me'],
  ['get', '/api/v1/rooms'],
  ['post', '/api/v1/rooms'],
  ['get', '/api/v1/rooms/{id}'],
  ['post', '/api/v1/rooms/{id}/join'],
  ['delete', '/api/v1/rooms/{id}/membership'],
  ['post', '/api/v1/rooms/{id}/ownership'],
  ['get', '/api/v1/rooms/{id}/members'],
  ['patch', '/api/v1/rooms/{id}/members/{user_id}'],
  ['delete', '/api/v1/rooms/{id}/members/{user_id}'],
  ['get', '/api/v1/rooms/{id}/messages'],
  ['post', '/api/v1/rooms/{id}/messages'],
  ['post', '/api/v1/rooms/{id}/invitations'],
  ['get', '/api/v1/users/me/invitations'],
  ['post', '/api/v1/invitations/{id}/accept'],
  ['post', '/api/v1/invitations/{id}/decline'],
  ['patch', '/api/v1/rooms/{id}/messages/{message_id}'],
  ['delete', '/api/v1/rooms/{id}/messages/{message_id}'],
  ['get', '/api/v1/rooms/{id}/read-state'],
  ['put', '/api/v1/rooms/{id}/read-state'],
  ['get', '/api/v1/rooms/{id}/presence'],
  ['post', '/api/v1/rooms/{id}/attachments/uploads'],
  ['get', '/api/v1/rooms/{id}/attachments/{attachment_id}'],
  ['post', '/api/v1/rooms/{id}/attachments/{attachment_id}/complete'],
  ['delete', '/api/v1/rooms/{id}/attachments/{attachment_id}'],
  ['get', '/api/v1/rooms/{id}/messages/{message_id}/attachments/{attachment_id}/download'],
  ['get', '/livez'],
  ['get', '/readyz'],
  ['get', '/readyz/realtime'],
]

export function validateApiContract(document) {
  const failures = []

  if (document.swagger !== '2.0') failures.push('Expected Swagger 2.0')
  for (const [method, path] of requiredOperations) {
    if (!document.paths?.[path]?.[method]) failures.push(`Missing ${method.toUpperCase()} ${path}`)
  }

  const message = document.definitions?.['internal_chat.Message']?.properties
  for (const field of [
    'id',
    'room_id',
    'user_id',
    'username',
    'content',
    'created_at',
    'revision',
    'edited_at',
    'deleted_at',
  ]) {
    if (!message?.[field]) failures.push(`Missing Message.${field}`)
  }
  for (const field of ['user_id', 'edited_at', 'deleted_at']) {
    if (message?.[field]?.['x-nullable'] !== true)
      failures.push(`Message.${field} is no longer nullable`)
  }
  if (message?.revision?.minimum !== 1) failures.push('Message.revision minimum changed')

  const room = document.definitions?.['internal_chat.Room']?.properties
  if (room?.role?.['x-nullable'] !== true) failures.push('Room.role is no longer nullable')

  const sendContent =
    document.definitions?.['internal_chat.SendMessageRequest']?.properties?.content
  if (sendContent?.maxLength !== 4000 || !sendContent.description?.includes('UTF-8 bytes'))
    failures.push('SendMessageRequest.content byte limit changed')

  const token =
    document.definitions?.['github_com_xuanphongtran_gogo-dl_internal_middleware.TokenPair']
      ?.properties
  for (const field of ['access_token', 'refresh_token', 'expires_at']) {
    if (!token?.[field]) failures.push(`Missing TokenPair.${field}`)
  }

  const resolve = (schema) =>
    schema?.$ref?.startsWith('#/definitions/')
      ? document.definitions?.[schema.$ref.slice(14)]
      : schema
  const summary = resolve(message?.attachments?.items)?.properties
  if (message?.attachments?.type !== 'array') failures.push('AttachmentSummary array missing')
  for (const [field, type] of Object.entries({
    id: 'integer',
    filename: 'string',
    content_type: 'string',
    size_bytes: 'integer',
    sha256: 'string',
    verified: 'boolean',
  }))
    if (summary?.[field]?.type !== type) failures.push(`AttachmentSummary.${field} type changed`)
  const definition = (suffix) =>
    Object.entries(document.definitions || {}).find(([name]) => name.endsWith(suffix))?.[1]
      ?.properties
  for (const [name, fields] of Object.entries({
    '.UploadTicket': { upload_url: 'string', method: 'string', headers: 'object' },
    '.DownloadTicket': { download_url: 'string', expires_at: 'string' },
    '.Metadata': {
      id: 'integer',
      filename: 'string',
      content_type: 'string',
      size_bytes: 'integer',
      sha256: 'string',
      verified: 'boolean',
      state: 'string',
      created_at: 'string',
      upload_expires_at: 'string',
      expires_at: 'string',
    },
    '.UploadRequest': {
      filename: 'string',
      content_type: 'string',
      sha256: 'string',
      size_bytes: 'integer',
    },
  })) {
    const properties = definition(name)
    for (const [field, type] of Object.entries(fields))
      if (properties?.[field]?.type !== type)
        failures.push(`Attachment${name}.${field} type changed`)
  }
  const upload = definition('.UploadRequest')?.size_bytes
  if (upload?.minimum !== 1 || upload?.maximum !== 10485760)
    failures.push('Attachment upload size bounds changed')
  if (!resolve(definition('.UploadTicket')?.attachment)?.properties?.id)
    failures.push('AttachmentUploadTicket.attachment missing')
  const ids = definition('.SendMessageRequest')?.attachment_ids
  if (ids?.type !== 'array' || ids?.maxItems !== 5 || ids?.items?.type !== 'integer')
    failures.push('SendMessageRequest.attachment_ids limit changed')
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Swagger request failed: HTTP ${response.status}`)
  const raw = await response.text()
  const document = JSON.parse(raw)
  const failures = validateApiContract(document)
  const hash = createHash('sha256').update(raw).digest('hex')
  const operationCount = Object.values(document.paths || {}).reduce(
    (count, operations) => count + Object.keys(operations).length,
    0,
  )
  console.log(
    `Swagger ${document.info?.version || 'unknown'}: ${Object.keys(document.paths || {}).length} paths, ${operationCount} operations`,
  )
  console.log(`SHA-256: ${hash}`)
  if (failures.length) {
    for (const failure of failures) console.error(failure)
    process.exitCode = 1
  } else {
    console.log(`${requiredOperations.length} required operations and core DTO fields found`)
  }
}
