import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { requireLoopback } from '../lib/acceptance-browser.mjs'
import { routeTemplate, fixtureMessage } from './recovery-api.mjs'

export async function startRealtimeApi() {
  const allowed = new Set(),
    clients = new Set(),
    timers = new Map(),
    denied = new Set(),
    held = []
  let scenario = '',
    counts = {},
    commands = {},
    connections = 0,
    subscriptions = 0,
    violations = 0,
    rate = false,
    delay = false,
    messages = []
  const room = (id) => ({
    id,
    name: `Realtime room ${id}`,
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: '2026-10-20T00:00:00Z',
  })
  const full = (id) => ({ ...fixtureMessage(id), mention_user_ids: [], attachments: [] })
  const send = (c, event) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(event))
  }
  const broadcast = (id, event) => {
    for (const c of clients) if (c.room === id) send(c, event)
  }
  const online = (id) =>
    [...new Set([...clients].filter((c) => c.room === id).map((c) => c.user))].sort()
  const presence = (id) => ({
    room_id: String(id),
    online_user_ids: online(id),
    typing_user_ids: [...timers.keys()]
      .filter((k) => k.startsWith(id + ':'))
      .map((k) => Number(k.split(':')[1]))
      .sort(),
  })
  const snapshot = (c) =>
    send(c, { type: 'presence_snapshot', room_id: String(c.room), payload: presence(c.room) })
  function stop(id, user) {
    const key = id + ':' + user
    clearTimeout(timers.get(key))
    timers.delete(key)
    broadcast(id, {
      type: 'typing_stopped',
      room_id: String(id),
      payload: { user_id: user, expires_at: null },
    })
  }
  function leave(c) {
    if (!c.room) return
    const id = c.room
    c.room = null
    if (!online(id).includes(c.user)) {
      stop(id, c.user)
      broadcast(id, {
        type: 'presence',
        room_id: String(id),
        payload: { user_id: c.user, online: false },
      })
    }
  }
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    if (origin && !allowed.has(origin)) {
      res.writeHead(403).end()
      return
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After')
    const reply = (status, data, headers = {}) => {
      if (!res.destroyed)
        res
          .writeHead(status, { 'Content-Type': 'application/json', ...headers })
          .end(JSON.stringify(data))
    }
    if (req.method === 'OPTIONS') return reply(204)
    const url = new URL(req.url, 'http://fixture'),
      path = url.pathname,
      key = req.method + ' ' + routeTemplate(path)
    counts[key] = (counts[key] || 0) + 1
    const user = Number(req.headers.authorization?.match(/^Bearer fixture-([12])$/)?.[1])
    if (!user) return reply(401, { error: 'Fixture authentication required' })
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return reply(400, { error: 'Invalid JSON' })
    }
    const rid = Number(path.match(/\/rooms\/(\d+)/)?.[1])
    if (rid && denied.has(user)) return reply(404, { error: 'Unavailable' })
    if (path === '/api/v1/users/me')
      return reply(200, {
        id: user,
        username: `Member ${user}`,
        email: `member${user}@example.test`,
        created_at: room(7).created_at,
      })
    if (path === '/api/v1/rooms')
      return reply(200, { rooms: denied.has(user) ? [] : [room(7), room(8)] })
    if (path.endsWith('/invitations')) return reply(200, { invitations: [] })
    if (path.endsWith('/notifications')) return reply(200, { notifications: [], next_before: null })
    if (path.endsWith('/notification-preferences'))
      return reply(200, { muted: false, mentions_enabled: true })
    if (/^\/api\/v1\/rooms\/\d+$/.test(path)) return reply(200, room(rid))
    if (path.endsWith('/members'))
      return reply(200, {
        members: [1, 2].map((id) => ({
          room_id: rid,
          user_id: id,
          username: `Member ${id}`,
          role: 'member',
          joined_at: room(rid).created_at,
        })),
      })
    if (path.endsWith('/read-state'))
      return reply(200, {
        room_id: rid,
        last_read_message_id: body.last_read_message_id || 0,
        unread_count: 0,
      })
    if (path.endsWith('/presence')) {
      const data = presence(rid)
      if (rate) return reply(429, { error: 'Limited' }, { 'Retry-After': '3' })
      if (delay) {
        held.push(() => reply(200, data))
        return
      }
      return reply(200, data)
    }
    if (path.endsWith('/messages/search'))
      return reply(200, {
        messages: messages
          .filter(
            (m) =>
              !m.deleted_at &&
              m.content.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase()),
          )
          .reverse()
          .slice(0, 20),
        next_before: null,
      })
    if (path.endsWith('/messages')) {
      if (req.method === 'POST') {
        const m = {
          ...full(messages.length + 1),
          user_id: user,
          username: `Member ${user}`,
          content: body.content,
        }
        messages.push(m)
        broadcast(rid, { type: 'message', room_id: String(rid), payload: m })
        return reply(201, m)
      }
      return reply(200, {
        messages:
          rid === 7
            ? messages
                .filter(
                  (m) =>
                    !url.searchParams.has('before') ||
                    m.id < Number(url.searchParams.get('before')),
                )
                .slice()
                .reverse()
                .slice(0, Number(url.searchParams.get('limit') || 40))
            : [],
      })
    }
    reply(404, { error: 'Unknown fixture route' })
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://fixture'),
      user = Number(url.searchParams.get('token')?.match(/^fixture-([12])$/)?.[1])
    if (url.pathname !== '/api/v1/ws' || !allowed.has(req.headers.origin) || !user) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c = { ws, user, room: null }
      clients.add(c)
      connections++
      ws.on('message', (raw) => {
        let event
        try {
          event = JSON.parse(raw)
        } catch {
          return
        }
        const id = Number(event.room_id)
        if (![7, 8].includes(id) || denied.has(user)) return
        commands[event.type] = (commands[event.type] || 0) + 1
        if (event.type === 'join') {
          const already = online(id).includes(user)
          if (c.room !== id) {
            leave(c)
            c.room = id
          }
          subscriptions++
          if (!already)
            broadcast(id, {
              type: 'presence',
              room_id: String(id),
              payload: { user_id: user, online: true },
            })
          broadcast(id, {
            type: 'join',
            room_id: String(id),
            payload: { user_id: user, client_id: 'fixture' },
          })
          if (scenario !== 'subscription-ack' || user !== 1) snapshot(c)
        } else if (event.type === 'leave') leave(c)
        else if (event.type === 'typing_started') {
          if (c.room !== id) {
            violations++
            return
          }
          const key = id + ':' + user
          clearTimeout(timers.get(key))
          timers.set(
            key,
            setTimeout(() => stop(id, user), 5000),
          )
          broadcast(id, {
            type: 'typing_started',
            room_id: String(id),
            payload: { user_id: user, expires_at: new Date(Date.now() + 5000).toISOString() },
          })
        } else if (event.type === 'typing_stopped') stop(id, user)
      })
      ws.on('close', () => {
        leave(c)
        clients.delete(c)
      })
      ws.on('error', () => {})
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    allowOrigin(origin) {
      requireLoopback(origin)
      allowed.add(origin)
    },
    setScenario(name) {
      for (const c of clients) c.ws.terminate()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      denied.clear()
      scenario = name
      counts = {}
      commands = {}
      connections = 0
      subscriptions = 0
      violations = 0
      rate = false
      delay = false
      messages = Array.from({ length: 85 }, (_, i) => full(i + 1))
    },
    snapshot: () => ({
      requestCounts: { ...counts },
      commands: { ...commands },
      connections,
      subscriptions,
      privacyViolationCount: violations,
    }),
    ack() {
      for (const c of clients) if (c.room) snapshot(c)
    },
    broadcast(event) {
      broadcast(7, event)
    },
    lifecycle(id, deleted = false) {
      const m = messages.find((m) => m.id === id)
      Object.assign(m, {
        content: deleted ? '' : `Revised message ${id}`,
        revision: m.revision + 1,
        edited_at: new Date().toISOString(),
        deleted_at: deleted ? new Date().toISOString() : null,
        user_id: null,
        username: 'Deleted user',
        attachments: [],
      })
      broadcast(7, {
        type: deleted ? 'message_deleted' : 'message_updated',
        room_id: '7',
        payload: m,
      })
    },
    delayPresence(value) {
      delay = value
    },
    releasePresence() {
      for (const release of held.splice(0)) release()
    },
    setRate(value) {
      rate = value
    },
    disconnect() {
      for (const c of clients) c.ws.close(1012)
    },
    revoke(user) {
      denied.add(user)
      for (const c of clients)
        if (c.user === user) {
          send(c, { type: 'presence_snapshot', room_id: '7', payload: presence(7) })
          c.ws.send(
            JSON.stringify({
              type: 'typing_started',
              room_id: '7',
              payload: { user_id: 2, expires_at: new Date(Date.now() + 5000).toISOString() },
            }) +
              '\n' +
              JSON.stringify({
                type: 'membership_changed',
                room_id: '7',
                payload: { action: 'removed', user_id: user, actor_user_id: 2, role: 'member' },
              }),
          )
          leave(c)
        }
    },
    close: async () => {
      for (const release of held.splice(0)) release()
      for (const timer of timers.values()) clearTimeout(timer)
      for (const c of clients) c.ws.terminate()
      await new Promise((r) => wss.close(r))
      server.closeAllConnections()
      await new Promise((r, j) => server.close((e) => (e ? j(e) : r())))
    },
  }
}
