import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = 'https://gogo-dl.onrender.com'
const accounts = []
const sent = []
let roomId
async function call(path, account, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(account ? { Authorization: `Bearer ${account.access_token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, expected, `${method} ${path} status`)
  return response.status === 204 ? undefined : response.json()
}
try {
  for (let i = 0; i < 2; i++) {
    const suffix = randomUUID().slice(0, 8)
    const account = await call(
      '/api/v1/auth/register',
      null,
      'POST',
      { email: `read-${suffix}@example.com`, username: `read_${suffix}`, password: randomUUID() },
      201,
    )
    accounts.push(account)
  }
  const [reader, author] = accounts
  const rooms = await call('/api/v1/rooms', reader)
  const room = rooms.rooms.find((r) => r.visibility === 'public' && r.role === null)
  assert.ok(room, 'Existing public fixture required; no new room will be created')
  roomId = room.id
  const root = `/api/v1/rooms/${roomId}`
  await call(`${root}/read-state`, reader, 'GET', undefined, 403)
  for (const account of accounts) await call(`${root}/join`, account, 'POST')
  const history = await call(`${root}/messages?limit=1`, reader)
  const baseline = history.messages[0]?.id || 0
  if (baseline) await call(`${root}/read-state`, reader, 'PUT', { last_read_message_id: baseline })
  const initial = await call(`${root}/read-state`, reader)
  const own = await call(
    `${root}/messages`,
    reader,
    'POST',
    { content: 'Disposable read-state contract probe' },
    201,
  )
  sent.push([reader, own.id])
  const first = await call(
    `${root}/messages`,
    author,
    'POST',
    { content: 'Disposable unread contract probe' },
    201,
  )
  sent.push([author, first.id])
  assert.equal(
    (await call(`${root}/read-state`, reader)).unread_count,
    initial.unread_count + 1,
    'Own messages excluded',
  )
  await call(`${root}/messages/${first.id}`, author, 'DELETE')
  assert.equal(
    (await call(`${root}/read-state`, reader)).unread_count,
    initial.unread_count + 1,
    'Tombstones counted by ID',
  )
  const advanced = await call(`${root}/read-state`, reader, 'PUT', {
    last_read_message_id: first.id,
  })
  assert.equal(advanced.last_read_message_id, first.id)
  assert.equal(advanced.unread_count, 0)
  const backward = await call(`${root}/read-state`, reader, 'PUT', { last_read_message_id: own.id })
  assert.equal(backward.last_read_message_id, first.id, 'Cursor monotonic across stale tabs')
  const repeat = await call(`${root}/read-state`, reader, 'PUT', { last_read_message_id: first.id })
  assert.equal(repeat.last_read_message_id, first.id, 'Duplicate acknowledgement converges')
  await call(`${root}/membership`, reader, 'DELETE', undefined, 204)
  await call(`${root}/read-state`, reader, 'GET', undefined, 403)
  await call(`${root}/join`, reader, 'POST')
  const rejoined = await call(`${root}/read-state`, reader)
  console.log(
    JSON.stringify({
      result: 'PASS',
      ownExcluded: true,
      tombstonesCounted: true,
      monotonicCursor: true,
      duplicateWrite: true,
      membershipDenied: true,
      rejoinCursor: rejoined.last_read_message_id,
      previousCursor: first.id,
    }),
  )
} finally {
  if (roomId) {
    for (const [account, id] of sent)
      await call(`/api/v1/rooms/${roomId}/messages/${id}`, account, 'DELETE').catch(() =>
        console.log('Message cleanup incomplete'),
      )
    for (const account of accounts)
      await call(`/api/v1/rooms/${roomId}/membership`, account, 'DELETE', undefined, 204).catch(
        () => console.log('Membership cleanup incomplete'),
      )
  }
  for (const account of accounts)
    await call('/api/v1/users/me', account, 'DELETE', undefined, 204).catch(() =>
      console.log('Account cleanup incomplete'),
    )
  console.log('Disposable account cleanup finished')
}
