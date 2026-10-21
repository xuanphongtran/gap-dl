import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareRealtimeFixtures } from './lib/realtime-live-fixtures.mjs'
const cleanup = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'realtime-fixtures-test-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  let next = 0,
    roomId = 0,
    failRegistration = false,
    failRoom = false,
    failDelete = false,
    failMessageDelete = false,
    nextMessage = 0
  const calls = [],
    accounts = new Map(),
    rooms = new Map(),
    messages = new Map()
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    calls.push({ method: req.method, path })
    let raw = ''
    for await (const c of req) raw += c
    const body = JSON.parse(raw || '{}'),
      token = req.headers.authorization?.slice(7),
      user = accounts.get(token)
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(data ? JSON.stringify(data) : '')
    }
    if (path === '/api/v1/auth/register') {
      if (failRegistration) {
        req.socket.destroy()
        return
      }
      const id = ++next
      accounts.set('token-' + id, { id, ...body })
      return reply(201, {
        access_token: 'token-' + id,
        refresh_token: 'refresh-' + id,
        expires_at: Date.now() / 1000 + 3600,
      })
    }
    if (path === '/api/v1/auth/login') {
      const entry = [...accounts].find(
        ([, a]) => a.email === body.email && a.password === body.password,
      )
      return entry
        ? reply(200, {
            access_token: entry[0],
            refresh_token: 'refresh',
            expires_at: Date.now() / 1000 + 3600,
          })
        : reply(401)
    }
    if (!user) return reply(401)
    if (path === '/api/v1/users/me' && req.method === 'DELETE') {
      if (failDelete && user.id % 2 === 0) return reply(500)
      accounts.delete(token)
      return reply(204)
    }
    if (path === '/api/v1/users/me') return reply(200, { id: user.id, username: user.username })
    if (path === '/api/v1/rooms' && req.method === 'POST') {
      if (failRoom) {
        req.socket.destroy()
        return
      }
      const room = { id: ++roomId, ...body, role: 'owner' }
      rooms.set(room.id, room)
      return reply(201, room)
    }
    if (/^\/api\/v1\/rooms\/\d+$/.test(path))
      return reply(200, rooms.get(Number(path.split('/').at(-1))))
    if (/^\/api\/v1\/rooms\/\d+\/messages$/.test(path) && req.method === 'POST') {
      const message = {
        id: ++nextMessage,
        user_id: user.id,
        content: body.content,
        revision: 1,
        deleted_at: null,
      }
      messages.set(message.id, message)
      return reply(201, message)
    }
    if (/^\/api\/v1\/rooms\/\d+\/messages\/\d+$/.test(path) && req.method === 'DELETE') {
      if (failMessageDelete) {
        failMessageDelete = false
        return reply(503, { error: 'Temporary failure' })
      }
      const id = Number(path.split('/').at(-1)),
        message = messages.get(id)
      if (!message) return reply(404)
      messages.delete(id)
      return reply(200, { ...message, content: '', deleted_at: '2026-10-21T00:00:00Z' })
    }
    if (path.endsWith('/membership')) return reply(204)
    return reply(404)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  cleanup.push(
    () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(r)
      }),
  )
  return {
    directory,
    apiOrigin: 'http://127.0.0.1:' + server.address().port,
    calls,
    messageCount: () => messages.size,
    hasAccount: (id) => [...accounts.values()].some((a) => a.id === id),
    failMessageDeleteOnce: () => {
      failMessageDelete = true
    },
    failRegistration: () => {
      failRegistration = true
    },
    failRoom: () => {
      failRoom = true
    },
    failDelete: () => {
      failDelete = true
    },
  }
}
it('reject_remote_or_cross_origin_registry_before_writes', async () => {
  const s = await setup()
  await expect(
    prepareRealtimeFixtures({ ...s, apiOrigin: 'https://gogo-dl.onrender.com' }),
  ).rejects.toThrow(/loopback/)
  await prepareRealtimeFixtures(s)
  const n = s.calls.length
  await expect(prepareRealtimeFixtures({ ...s, apiOrigin: 'http://127.0.0.1:1' })).rejects.toThrow(
    /origin/,
  )
  expect(s.calls).toHaveLength(n)
})
it('reuse_retained_owner_and_rooms_without_duplicate_creation', async () => {
  const s = await setup(),
    a = await prepareRealtimeFixtures(s),
    b = await prepareRealtimeFixtures(s)
  expect(b.owner.id).toBe(a.owner.id)
  expect(b.rooms).toEqual(a.rooms)
  expect(
    s.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/auth/register'),
  ).toHaveLength(1)
  expect(s.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/rooms')).toHaveLength(2)
})
it.each(['registration', 'room'])('ambiguous_%s_write_stays_uncertain', async (kind) => {
  const s = await setup()
  if (kind === 'registration') s.failRegistration()
  else s.failRoom()
  await expect(prepareRealtimeFixtures(s)).rejects.toThrow()
  const first = s.calls.length
  await expect(prepareRealtimeFixtures(s)).rejects.toThrow(/uncertain|unresolved/i)
  expect(s.calls).toHaveLength(first)
  const journal = JSON.parse(await readFile(join(s.directory, 'retained.json'), 'utf8'))
  expect(journal.entries.at(-1).status).toBe('uncertain')
  expect(journal.entries[0].recovery.password).toBeTruthy()
})
it('cleanup_attempts_all_guests_and_persists_each_result', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s)
  await f.createGuest()
  await f.createGuest()
  s.failDelete()
  const report = await f.cleanup()
  expect(report.confirmed).toBe(1)
  expect(report.unconfirmed).toBe(1)
  expect(
    s.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/v1/users/me'),
  ).toHaveLength(2)
  const journal = JSON.parse(await readFile(join(s.directory, 'temporary.json'), 'utf8'))
  expect(journal.entries.some((e) => e.status === 'cleaned')).toBe(true)
})
it('retained_is_not_cleaned_or_uncertain', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s)
  await f.cleanup()
  expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  expect(f.report().retained).toHaveLength(3)
  expect(f.report().retained.every((r) => r.status === 'retained')).toBe(true)
})
it('report_excludes_credentials_urls_and_payloads', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s)
  await f.createGuest()
  await f.cleanup()
  expect(JSON.stringify(f.report())).not.toMatch(
    /access_token|refresh_token|token-|@example|password|ws:\/\/|content/,
  )
})

it('retained_room_journal_recovers_registry_gap_without_new_room', async () => {
  const s = await setup()
  await prepareRealtimeFixtures(s)
  const file = join(s.directory, 'registry.json'),
    registry = JSON.parse(await readFile(file, 'utf8'))
  delete registry.rooms.public
  await writeFile(file, JSON.stringify(registry))
  await prepareRealtimeFixtures(s)
  expect(s.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/rooms')).toHaveLength(2)
})
it('retained_owner_and_nonfixture_mutations_are_refused_before_transmission', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s),
    n = s.calls.length
  await expect(f.request(f.owner, 'DELETE', '/api/v1/users/me')).rejects.toThrow(
    /fixture|retained/i,
  )
  await expect(
    f.request(f.owner, 'POST', '/api/v1/rooms/' + f.rooms.public.id + '/ownership', { user_id: 1 }),
  ).rejects.toThrow(/fixture|retained/i)
  expect(s.calls).toHaveLength(n)
})
it('query_parameters_never_reach_sanitized_report', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s)
  await f.request(
    f.owner,
    'GET',
    '/api/v1/rooms/' + f.rooms.public.id + '/messages/search?q=private-secret',
  )
  expect(JSON.stringify(f.report())).not.toContain('private-secret')
})
it('rejects nonfixture message/invitation IDs and ownership transfer before any mutation', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s),
    guest = await f.createGuest(),
    count = s.calls.length
  for (const [actor, method, path, body] of [
    [guest, 'POST', '/api/v1/invitations/999/accept'],
    [f.owner, 'DELETE', `/api/v1/rooms/${f.rooms.private.id}/messages/999`],
    [
      f.owner,
      'PATCH',
      `/api/v1/rooms/${f.rooms.private.id}/members/${guest.id}`,
      { role: 'owner' },
    ],
  ])
    await expect(f.request(actor, method, path, body)).rejects.toThrow(/fixture|retained/i)
  expect(s.calls).toHaveLength(count)
})

it('message cleanup retries through the retained owner after the guest was deleted', async () => {
  const s = await setup(),
    f = await prepareRealtimeFixtures(s),
    guest = await f.createGuest()
  await f.request(guest, 'POST', `/api/v1/rooms/${f.rooms.private.id}/messages`, {
    content: 'Disposable',
  })
  s.failMessageDeleteOnce()
  const first = await f.cleanup()
  expect(first.unconfirmed).toBe(1)
  expect(s.hasAccount(guest.id)).toBe(false)
  expect(s.messageCount()).toBe(1)
  const second = await f.cleanup()
  expect(second.unconfirmed).toBe(0)
  expect(s.messageCount()).toBe(0)
  expect(s.hasAccount(f.owner.id)).toBe(true)
})
