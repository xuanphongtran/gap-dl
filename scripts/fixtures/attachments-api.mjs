import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { createHash } from 'node:crypto'
import { fixtureMessage, routeTemplate } from './recovery-api.mjs'
export const attachmentProviderOrigin = 'https://attachments.fixture.invalid'
export async function startAttachmentsApi() {
  let providerOrigin = attachmentProviderOrigin,
    providerServer
  let scenario,
    counts,
    files,
    keys,
    sends,
    messages,
    held,
    privacy,
    cancelled,
    unexpected,
    nextId,
    processingHeld,
    revoked,
    bindingDenied
  const reset = (name) => {
    scenario = name
    counts = {}
    files = new Map()
    keys = new Map()
    sends = new Map()
    messages = Array.from({ length: 40 }, (_, i) => fixtureMessage(i + 1))
    held = []
    privacy = 0
    cancelled = 0
    unexpected = 0
    nextId = 100
    processingHeld = name === 'processing'
    revoked = false
    bindingDenied = false
  }
  reset('send-retry')
  const room = (id) => ({
    id,
    name: `Synthetic room ${id}`,
    visibility: 'private',
    role: 'member',
    created_by: 1,
    created_at: '2026-10-20T00:00:00Z',
  })
  const count = (method, path) => {
    const key = method + ' ' + routeTemplate(path)
    counts[key] = (counts[key] || 0) + 1
  }
  const summary = (f) => ({
    id: f.id,
    filename: f.filename,
    content_type: f.content_type,
    size_bytes: f.size_bytes,
    sha256: f.sha256,
    verified: true,
  })
  const publicMetadata = (f) => ({
    id: f.id,
    filename: f.filename,
    content_type: f.content_type,
    size_bytes: f.size_bytes,
    sha256: f.sha256,
    state: f.state,
    verified: ['ready', 'attached'].includes(f.state),
    created_at: '2026-10-20T00:00:00Z',
    upload_expires_at: new Date(Date.now() + 300000).toISOString(),
    expires_at: f.state === 'attached' ? null : new Date(Date.now() + 86400000).toISOString(),
  })
  const ticket = (f) => ({
    attachment: publicMetadata(f),
    method: 'PUT',
    headers: { 'Content-Type': f.content_type, 'If-None-Match': '*' },
    upload_url: providerOrigin + '/uploads/' + f.id + '?ticket=synthetic',
  })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'),
      path = url.pathname,
      method = req.method
    const reply = (status, data, headers = {}) => {
      if (res.destroyed) return
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Expose-Headers': 'Retry-After,X-Request-Id',
        ...headers,
      })
      res.end(data === undefined ? '' : JSON.stringify(data))
    }
    if (method === 'OPTIONS') return reply(204)
    count(method, path)
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return reply(400, { error: 'Invalid JSON' })
    }
    const user = req.headers.authorization === 'Bearer fixture-2' ? 2 : 1
    if (path === '/api/v1/auth/login')
      return reply(200, {
        access_token: body.email === 'second@example.test' ? 'fixture-2' : 'fixture-1',
        refresh_token: 'refresh-fixture',
        expires_at: Date.now() / 1000 + 3600,
      })
    if (path === '/api/v1/users/me')
      return reply(200, {
        id: user,
        username: 'Fixture member ' + user,
        email: 'member@example.test',
        created_at: '2026-10-20T00:00:00Z',
      })
    if (path === '/api/v1/users/me/invitations') return reply(200, { invitations: [] })
    if (path === '/api/v1/rooms')
      return reply(200, {
        rooms:
          scenario === 'account-change' && user === 2
            ? []
            : revoked
              ? [room(8)]
              : [room(7), room(8)],
      })
    const rid = Number(path.split('/')[4])
    if (
      path.startsWith('/api/v1/rooms/') &&
      ((revoked && rid === 7) || (scenario === 'account-change' && user === 2 && rid === 7))
    )
      return reply(404, { error: 'Unavailable' })
    if (/^\/api\/v1\/rooms\/\d+$/.test(path)) return reply(200, room(rid))
    if (path.endsWith('/members'))
      return reply(200, {
        members: [1, 2].map((user_id) => ({
          user_id,
          room_id: rid,
          username: 'Member ' + user_id,
          role: 'member',
          joined_at: '2026-10-20T00:00:00Z',
        })),
      })
    if (path.endsWith('/read-state'))
      return reply(200, {
        room_id: rid,
        last_read_message_id: method === 'PUT' ? body.last_read_message_id || 0 : 0,
        unread_count: 0,
      })
    if (path.endsWith('/notification-preferences'))
      return reply(200, path.includes('/rooms/') ? { muted: false } : { mentions_enabled: true })
    if (path === '/api/v1/users/me/notifications')
      return reply(200, { notifications: [], next_before: null })
    if (path.endsWith('/attachments/uploads')) {
      const key = req.headers['idempotency-key'],
        signature = JSON.stringify(body)
      if (keys.has(key)) {
        const old = keys.get(key)
        return old.signature === signature && old.file.state === 'pending_upload'
          ? reply(201, ticket(old.file))
          : reply(409, { error: 'Conflict' })
      }
      const f = {
        ...body,
        id: nextId++,
        room: rid,
        user,
        state: 'pending_upload',
        bytes: null,
        messageId: null,
      }
      files.set(f.id, f)
      keys.set(key, { signature, file: f })
      if (['upload-room-change', 'account-change'].includes(scenario)) {
        held.push(() => reply(201, ticket(f)))
        return
      }
      return reply(201, ticket(f))
    }
    if (/\/attachments\/\d+\/complete$/.test(path)) {
      const f = files.get(Number(path.split('/').at(-2)))
      if (!f || f.user !== user) return reply(404, { error: 'Unavailable' })
      if (!f.bytes) return reply(409, { error: 'No bytes' })
      f.state = 'processing'
      return reply(202, publicMetadata(f))
    }
    if (/\/attachments\/\d+$/.test(path)) {
      const f = files.get(Number(path.split('/').at(-1)))
      if (!f) return reply(404, { error: 'Unavailable' })
      if (f.user !== user) {
        privacy++
        return reply(404, { error: 'Unavailable' })
      }
      if (method === 'DELETE') {
        if (f.state === 'attached') return reply(409, { error: 'Attached' })
        f.state = 'cancelled'
        cancelled++
        return reply(204)
      }
      if (f.state === 'processing' && !processingHeld) {
        f.state =
          createHash('sha256')
            .update(f.bytes || '')
            .digest('hex') === f.sha256
            ? 'ready'
            : 'rejected'
      }
      return reply(200, publicMetadata(f))
    }
    if (path.endsWith('/download')) {
      const id = Number(path.split('/').at(-2)),
        messageId = Number(path.split('/')[6]),
        f = files.get(id),
        m = messages.find((m) => m.id === messageId)
      if (
        bindingDenied ||
        !f ||
        f.state !== 'attached' ||
        f.messageId !== messageId ||
        !m ||
        m.deleted_at
      )
        return reply(404, { error: 'Unavailable' })
      return reply(
        200,
        {
          download_url: providerOrigin + '/downloads/' + id + '?ticket=synthetic',
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
        { 'Cache-Control': 'private, no-store' },
      )
    }
    if (path.endsWith('/messages') && method === 'POST') {
      const key = req.headers['idempotency-key'],
        signature = JSON.stringify(body)
      if (sends.has(key)) {
        const old = sends.get(key)
        return old.signature === signature
          ? reply(201, old.message)
          : reply(409, { error: 'Conflict' })
      }
      const attachments = (body.attachment_ids || []).map((id) => files.get(id))
      if (attachments.some((f) => !f || f.user !== user || f.room !== rid))
        return reply(404, { error: 'Unavailable' })
      if (attachments.some((f) => f.state !== 'ready')) return reply(409, { error: 'Not ready' })
      const m = {
        ...fixtureMessage(1000 + sends.size, rid),
        user_id: user,
        content: body.content,
        attachments: attachments.map(summary),
      }
      for (const f of attachments) {
        f.state = 'attached'
        f.messageId = m.id
      }
      messages.push(m)
      sends.set(key, { signature, message: m })
      return reply(201, m)
    }
    if (/\/messages\/\d+$/.test(path)) {
      const m = messages.find((m) => m.id === Number(path.split('/').at(-1)))
      if (!m) return reply(404, { error: 'Unavailable' })
      m.revision++
      if (method === 'DELETE') {
        m.content = ''
        m.deleted_at = new Date().toISOString()
        m.attachments = []
        for (const f of files.values()) if (f.messageId === m.id) f.state = 'cancelled'
      } else m.content = body.content
      return reply(200, m)
    }
    if (path.endsWith('/messages') || path.endsWith('/messages/search')) {
      const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER),
        limit = Number(url.searchParams.get('limit') || 40),
        q = url.searchParams.get('q') || ''
      const result = messages
        .filter((m) => m.room_id === rid && m.id < before && (!q || m.content.includes(q)))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
      return reply(200, {
        messages: result,
        ...(path.endsWith('/search') ? { next_before: null } : {}),
      })
    }
    if (['/health', '/readyz', '/readyz/realtime'].includes(path))
      return reply(200, { ready: true })
    if (path === '/api/v1/ws') return reply(503, { error: 'Synthetic REST fallback' })
    unexpected++
    reply(404, { error: 'Unexpected fixture request' })
  })
  server.on('upgrade', (_req, socket) =>
    socket.end(
      'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    ),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    get providerOrigin() {
      return providerOrigin
    },
    async startProvider(directory) {
      const keyPath = join(directory, 'provider-key.pem'),
        certPath = join(directory, 'provider-cert.pem')
      const generated = spawnSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-subj',
          '/CN=attachments.fixture.invalid',
          '-addext',
          'subjectAltName=DNS:attachments.fixture.invalid,IP:127.0.0.1',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '1',
        ],
        { stdio: 'ignore' },
      )
      if (generated.status !== 0) throw Error('Local provider certificate generation failed')
      await chmod(keyPath, 0o600)
      const key = await readFile(keyPath),
        cert = await readFile(certPath)
      const pin = createHash('sha256')
        .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }))
        .digest('base64')
      const handle = this.handleProvider.bind(this)
      providerServer = createHttpsServer({ key, cert }, async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const result = handle({
          method: req.method,
          path: new URL(req.url, 'https://attachments.fixture.invalid').pathname,
          headers: req.headers,
          body: Buffer.concat(chunks),
        })
        res.writeHead(result.status, result.headers)
        res.end(result.body)
      })
      await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve))
      providerOrigin = attachmentProviderOrigin + ':' + providerServer.address().port
      return {
        origin: providerOrigin,
        certificate: cert,
        chromeArgs: [
          '--ignore-certificate-errors-spki-list=' + pin,
          '--host-resolver-rules=MAP attachments.fixture.invalid 127.0.0.1',
          '--no-proxy-server',
        ],
      }
    },
    origin: `http://127.0.0.1:${server.address().port}`,
    setScenario: reset,
    releaseProcessing: () => {
      processingHeld = false
    },
    releaseReservations: () => {
      for (const reply of held.splice(0)) reply()
    },
    denyBinding: () => {
      bindingDenied = true
    },
    revoke: () => {
      revoked = true
    },
    snapshot: () => ({
      requestCounts: { ...counts },
      canonicalMessageCount: sends.size,
      cancellationCount: cancelled,
      privacyViolationCount: privacy,
      unexpectedRequests: unexpected,
    }),
    handleProvider({ method, path, headers = {}, body = '' }) {
      count(method, '/provider' + path)
      if (
        Object.entries(headers).some(
          ([key, value]) => /^(authorization|cookie)$/i.test(key) && value,
        )
      ) {
        privacy++
        return { status: 403, headers: {}, body: '' }
      }
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,If-None-Match',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
        'Content-Type': 'application/octet-stream',
      }
      if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' }
      const f = files.get(Number(path.split('/').at(-1)))
      if (!f) return { status: 404, headers: cors, body: '' }
      if (method === 'PUT') {
        if (f.bytes) return { status: 412, headers: cors, body: '' }
        f.bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
        return { status: scenario === 'put-412' ? 412 : 200, headers: cors, body: '' }
      }
      if (method === 'GET' && f.state === 'attached')
        return {
          status: 200,
          headers: {
            ...cors,
            'Content-Type': f.content_type,
            'Content-Disposition': 'attachment; filename="synthetic.txt"',
            'Cache-Control': 'private, no-store',
          },
          body: f.bytes,
        }
      return { status: 404, headers: cors, body: '' }
    },
    close: async () => {
      held = []
      const results = await Promise.allSettled(
        [server, providerServer].filter(Boolean).map((s) => {
          s.closeAllConnections()
          return new Promise((resolve, reject) =>
            s.close((error) => (error ? reject(error) : resolve())),
          )
        }),
      )
      if (results.some((result) => result.status === 'rejected'))
        throw Error('Fixture cleanup incomplete')
    },
  }
}
