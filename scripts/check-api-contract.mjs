import { createHash } from 'node:crypto'

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
]

const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`Swagger request failed: HTTP ${response.status}`)
const raw = await response.text()
const document = JSON.parse(raw)
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

const token =
  document.definitions?.['github_com_xuanphongtran_gogo-dl_internal_middleware.TokenPair']
    ?.properties
for (const field of ['access_token', 'refresh_token', 'expires_at']) {
  if (!token?.[field]) failures.push(`Missing TokenPair.${field}`)
}

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
