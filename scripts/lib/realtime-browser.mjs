import { createServer, request } from 'node:http'
import { requireLoopback } from './acceptance-browser.mjs'

export function allowedRealtimeURL(value, appOrigin, apiOrigin) {
  try {
    requireLoopback(appOrigin)
    requireLoopback(apiOrigin)
    const u = new URL(value)
    if (u.username || u.password) return false
    if (u.protocol === 'http:')
      return u.origin === appOrigin || (u.origin === apiOrigin && u.pathname.startsWith('/api/v1/'))
    if (u.protocol === 'ws:')
      return (
        (u.origin === apiOrigin.replace('http:', 'ws:') && u.pathname === '/api/v1/ws') ||
        (u.origin === appOrigin.replace('http:', 'ws:') && u.pathname === '/')
      )
    return false
  } catch {
    return false
  }
}
export async function startRealtimeProxy({
  appOrigin,
  apiOrigin,
  frontendTransportOrigin = appOrigin,
}) {
  for (const origin of [appOrigin, apiOrigin, frontendTransportOrigin]) requireLoopback(origin)
  let denied = 0
  const sockets = new Set()
  const track = (s) => {
    sockets.add(s)
    s.once('close', () => sockets.delete(s))
    return s
  }
  const target = (req) => {
    let u
    try {
      u = new URL(
        req.url,
        req.socket.realtimeTunnelHost ? 'ws://' + req.socket.realtimeTunnelHost : undefined,
      )
    } catch {
      return null
    }
    if (!allowedRealtimeURL(u.href, appOrigin, apiOrigin)) return null
    if (u.origin === appOrigin || u.origin === appOrigin.replace('http:', 'ws:')) {
      const upstream = new URL(frontendTransportOrigin)
      u.hostname = upstream.hostname
      u.port = upstream.port
    }
    if (u.protocol === 'ws:') u.protocol = 'http:'
    return u
  }
  const headers = (req, url) => {
    const h = { ...req.headers, host: url.host }
    delete h['proxy-authorization']
    delete h['proxy-connection']
    return h
  }
  const server = createServer((req, res) => {
    const url = target(req)
    if (!url) {
      denied++
      res.writeHead(403).end()
      return
    }
    const upstream = request(url, { method: req.method, headers: headers(req, url) }, (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  server.on('connection', track)
  const tunnel = createServer((_req, res) => {
    denied++
    res.writeHead(403).end()
  })
  server.on('connect', (req, s, head) => {
    if (![new URL(appOrigin).host, new URL(apiOrigin).host].includes(req.url)) {
      denied++
      s.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    s.realtimeTunnelHost = req.url
    s.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    tunnel.emit('connection', s)
    if (head.length) s.unshift(head)
  })
  const upgrade = (req, socket, head) => {
    const url = target(req)
    if (
      !url ||
      (socket.realtimeTunnelHost && req.headers.host !== socket.realtimeTunnelHost) ||
      req.headers.origin !== appOrigin
    ) {
      denied++
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    // Preserve upstream authorization, Origin and WebSocket handshake; never fabricate a 101.
    const upstream = request(url, { headers: headers(req, url) })
    upstream.on('upgrade', (res, remote, remoteHead) => {
      track(remote)
      let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`
      for (let i = 0; i < res.rawHeaders.length; i += 2)
        response += res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + '\r\n'
      socket.write(response + '\r\n')
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.pipe(remote)
      remote.pipe(socket)
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
      remote.on('error', () => socket.destroy())
    })
    upstream.on('response', (res) => {
      socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\nConnection: close\r\n\r\n`)
      res.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  }
  server.on('upgrade', upgrade)
  tunnel.on('upgrade', upgrade)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    get denied() {
      return denied
    },
    close: () =>
      new Promise((r, j) => {
        for (const s of sockets) s.destroy()
        server.close((e) => (e ? j(e) : r()))
      }),
  }
}
export async function openRealtimePage({ browser, appOrigin, apiOrigin, frontendTransportOrigin }) {
  for (const origin of [appOrigin, apiOrigin, frontendTransportOrigin || appOrigin])
    requireLoopback(origin)
  const session = await browser.newPage(),
    { command } = browser
  let escapes = 0
  const blocked = []
  const { targetInfo } = await command('Target.getTargetInfo', {}, session)
  await command('Browser.grantPermissions', {
    origin: appOrigin,
    browserContextId: targetInfo.browserContextId,
    permissions: ['localNetworkAccess', 'loopbackNetwork'],
  })
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, session)
  await command('Target.setDiscoverTargets', { discover: true })
  const off = browser.onEvent(async (e) => {
    if (['Target.targetCreated', 'Target.targetInfoChanged'].includes(e.method)) {
      const url = e.params.targetInfo.url
      if (
        e.params.targetInfo.type !== 'browser_ui' &&
        url &&
        url !== 'about:blank' &&
        !allowedRealtimeURL(url, appOrigin, apiOrigin)
      ) {
        escapes++
        const u = new URL(url)
        blocked.push(e.params.targetInfo.type + ':' + u.origin + u.pathname)
      }
    }
    if (e.sessionId !== session) return
    if (e.method === 'Fetch.requestPaused') {
      const allowed = allowedRealtimeURL(e.params.request.url, appOrigin, apiOrigin)
      if (!allowed) {
        escapes++
        const u = new URL(e.params.request.url)
        blocked.push(u.origin + u.pathname)
      }
      await command(
        allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        { requestId: e.params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) },
        session,
      )
    }
    if (
      e.method === 'Page.frameNavigated' &&
      e.params.frame.url !== 'about:blank' &&
      !allowedRealtimeURL(e.params.frame.url, appOrigin, apiOrigin)
    )
      escapes++
    if (
      e.method === 'Network.webSocketCreated' &&
      !allowedRealtimeURL(e.params.url, appOrigin, apiOrigin)
    )
      escapes++
  })
  return {
    session,
    get blocked() {
      return blocked
    },
    get escapes() {
      return escapes
    },
    close: async () => {
      off()
      await command('Target.disposeBrowserContext', {
        browserContextId: targetInfo.browserContextId,
      })
    },
  }
}
