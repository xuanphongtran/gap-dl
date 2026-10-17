import { createServer } from 'node:http'

const timestamp = '2026-10-16T00:00:00Z'
export function fixtureMessage(id, room = 7) {
  return {
    id,
    room_id: room,
    user_id: 2,
    username: 'Other member',
    content: `Synthetic message ${id}`,
    created_at: timestamp,
    revision: 1,
    edited_at: null,
    deleted_at: null,
  }
}
export function routeTemplate(path) {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id')
}
export async function startRecoveryApi({ messageCount = 40 } = {}) {
  let scenario = '',
    counts = {},
    messages = [],
    writes = new Map(),
    payloads = new Map(),
    notes = [],
    read = 0,
    workspaceHealthy = false,
    inboxHealthy = false,
    unexpected = 0
  const pendingRecovery = new Set()
  const room = (id) => ({
    id,
    name: `Synthetic room ${id}`,
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: timestamp,
  })
  const reset = (name) => {
    scenario = name
    counts = {}
    messages = Array.from({ length: messageCount }, (_, i) => fixtureMessage(i + 1))
    writes = new Map()
    payloads = new Map()
    notes = [
      {
        id: 1,
        kind: 'mention',
        room_id: 7,
        message_id: 1,
        created_at: timestamp,
        read_at: null,
        availability: 'available',
      },
    ]
    read = 0
    workspaceHealthy = false
    inboxHealthy = false
    unexpected = 0
  }
  reset('')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'),
      path = url.pathname
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After,X-Request-Id')
    res.setHeader('X-Request-Id', 'fixture-reference')
    const reply = (status, data, headers = {}) => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(data))
    }
    if (req.method === 'OPTIONS') return reply(204)
    const key = req.method + ' ' + routeTemplate(path)
    counts[key] = (counts[key] || 0) + 1
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return reply(400, { error: 'Invalid JSON' })
    }
    const user = req.headers.authorization === 'Bearer fixture-2' ? 2 : 1
    if (path === '/api/v1/auth/login' && req.method === 'POST') {
      if (scenario === 'login-503' && counts[key] === 1) return reply(503, { error: 'Warming up' })
      const id = body.email === 'second@example.test' ? 2 : 1
      return reply(200, {
        access_token: `fixture-${id}`,
        refresh_token: `refresh-${id}`,
        expires_at: Date.now() / 1000 + 3600,
      })
    }
    if (path === '/api/v1/users/me')
      return reply(200, {
        id: user,
        username: `Fixture member ${user}`,
        email: `member${user}@example.test`,
        created_at: timestamp,
        avatar_url: null,
      })
    if (path === '/api/v1/users/me/invitations') return reply(200, { invitations: [] })
    if (path === '/api/v1/rooms' && req.method === 'GET') {
      if (['workspace-503', 'session-change'].includes(scenario) && user === 1 && !workspaceHealthy)
        return reply(503, { error: 'Warming up' })
      if (scenario === 'session-change' && user === 1 && workspaceHealthy) {
        pendingRecovery.add(() => reply(200, { rooms: [room(7)] }))
        return
      }
      return reply(200, { rooms: user === 2 ? [] : [room(7), room(8)] })
    }
    if (/^\/api\/v1\/rooms\/\d+$/.test(path))
      return reply(200, room(Number(path.split('/').at(-1))))
    if (path.endsWith('/members'))
      return reply(200, {
        members: [1, 2].map((id) => ({
          user_id: id,
          room_id: 7,
          username: `Fixture member ${id}`,
          role: 'member',
          joined_at: timestamp,
        })),
      })
    if (path.endsWith('/read-state')) {
      if (req.method === 'PUT') read = Math.max(read, body.last_read_message_id || 0)
      return reply(200, {
        room_id: Number(path.split('/')[4]),
        last_read_message_id: read,
        unread_count: 0,
      })
    }
    if (path.endsWith('/notification-preferences'))
      return reply(
        200,
        path.includes('/rooms/')
          ? { muted: body.muted ?? false }
          : { mentions_enabled: body.mentions_enabled ?? true },
      )
    if (path === '/api/v1/users/me/notifications') {
      if (scenario.startsWith('inbox-429') && !inboxHealthy) {
        const headers =
          scenario === 'inbox-429'
            ? { 'Retry-After': '5' }
            : scenario.endsWith('malformed-header')
              ? { 'Retry-After': 'invalid' }
              : {}
        return reply(429, { error: 'Slow down' }, headers)
      }
      return reply(200, {
        notifications: notes.filter(
          (n) =>
            !url.searchParams.has('unread_only') ||
            url.searchParams.get('unread_only') !== 'true' ||
            !n.read_at,
        ),
        next_before: null,
      })
    }
    if (/\/notifications\/\d+\/read$/.test(path)) {
      notes = notes.map((n) => ({ ...n, read_at: timestamp }))
      return reply(200, notes[0])
    }
    if (path.endsWith('/messages') && req.method === 'GET') {
      const rid = Number(path.split('/')[4]),
        before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER),
        limit = Number(url.searchParams.get('limit') || 40)
      return reply(200, {
        messages: messages
          .filter((m) => m.room_id === rid && m.id < before)
          .sort((a, b) => b.id - a.id)
          .slice(0, limit),
      })
    }
    if (path.endsWith('/messages') && req.method === 'POST') {
      const idempotency = req.headers['idempotency-key']
      if (idempotency && writes.has(idempotency))
        return JSON.stringify(body) === payloads.get(idempotency)
          ? reply(201, writes.get(idempotency))
          : reply(409, { error: 'Idempotency conflict' })
      const m = {
        ...fixtureMessage(messageCount + writes.size + 1),
        user_id: user,
        content: body.content,
      }
      if (idempotency) payloads.set(idempotency, JSON.stringify(body))
      messages.push(m)
      writes.set(idempotency || Symbol(), m)
      return reply(201, m)
    }
    if (path === '/readyz' || path === '/readyz/realtime') return reply(200, { ready: true })
    if (path === '/api/v1/ws') return reply(503, { error: 'Fixture REST fallback' })
    unexpected++
    reply(404, { error: 'Unhandled fixture route' })
  })
  server.on('upgrade', (_req, socket) => {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setScenario: reset,
    recover: () => {
      workspaceHealthy = true
      inboxHealthy = true
    },
    releaseRecovery: () => {
      for (const reply of pendingRecovery) reply()
      pendingRecovery.clear()
    },
    pendingRecoveryCount: () => pendingRecovery.size,
    snapshot: () => ({
      requestCounts: { ...counts },
      canonicalMessageCount: writes.size,
      unexpectedRequests: unexpected,
    }),
    close: async () => {
      pendingRecovery.clear()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
