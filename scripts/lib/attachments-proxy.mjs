import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { requireLoopback } from './acceptance-browser.mjs'

// Enforce the origin allowlist before a new tab can issue its first request.
export async function startAttachmentsProxy(origins, providerOrigin) {
  origins.forEach(requireLoopback)
  const provider = new URL(providerOrigin)
  if (
    provider.username ||
    provider.password ||
    provider.protocol !== 'https:' ||
    provider.hostname !== 'attachments.fixture.invalid' ||
    !provider.port
  )
    throw Error('Invalid local provider origin')
  let denied = 0
  const sockets = new Set()
  const track = (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    return socket
  }
  const server = createServer((req, res) => {
    let url
    try {
      url = new URL(req.url)
    } catch {
      denied++
      res.writeHead(403).end()
      return
    }
    if (url.username || url.password || !origins.includes(url.origin)) {
      denied++
      res.writeHead(403).end()
      return
    }
    const headers = { ...req.headers, host: url.host }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const upstream = request(url, { method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  server.on('connection', track)
  server.on('connect', (req, socket, head) => {
    if (req.url !== provider.host) {
      denied++
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = track(connect(Number(provider.port), '127.0.0.1'))
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  server.on('upgrade', (_req, socket) =>
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    get denied() {
      return denied
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
