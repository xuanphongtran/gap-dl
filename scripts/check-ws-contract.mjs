import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { websocketURL } from '../src/lib/realtime.ts'

try {
  let token = process.env.WS_ACCESS_TOKEN
  let apiBaseURL = process.env.WS_API_BASE_URL || 'https://gogo-dl.onrender.com'
  const origin = process.env.WS_ORIGIN || 'http://localhost:3000'
  if (process.env.WS_FIXTURE_FILE) {
    const fixture = JSON.parse(await readFile(process.env.WS_FIXTURE_FILE, 'utf8'))
    token = fixture.accounts?.[0]?.session?.access_token
    apiBaseURL = fixture.apiOrigin || apiBaseURL
  }
  if (!token) {
    console.error('Set WS_ACCESS_TOKEN or WS_FIXTURE_FILE for an authenticated read-only probe.')
    process.exitCode = 1
  } else {
    const target = new URL(websocketURL(apiBaseURL, token))
    target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'
    const key = randomBytes(16).toString('base64')
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    await new Promise((resolve, reject) => {
      let connection
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        headers: {
          Origin: origin,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      })
      const timer = setTimeout(() => {
        request.destroy()
        connection?.destroy()
        reject(new Error('WebSocket upgrade timed out.'))
      }, 15000)
      request.on('upgrade', (response, socket) => {
        connection = socket
        clearTimeout(timer)
        const valid =
          response.statusCode === 101 && response.headers['sec-websocket-accept'] === accept
        socket.destroy()
        if (valid) resolve()
        else reject(new Error('Invalid WebSocket upgrade response.'))
      })
      request.on('response', (response) => {
        clearTimeout(timer)
        response.resume()
        reject(new Error(`WebSocket upgrade rejected: HTTP ${response.statusCode}.`))
      })
      request.on('error', () => {
        clearTimeout(timer)
        reject(new Error('Could not establish the WebSocket connection.'))
      })
      request.end()
    })
    console.log('PASS: authenticated WebSocket upgrade (101) with the configured Origin.')
    console.log('No room subscription or durable writes were performed.')
  }
} catch (error) {
  // Native request and JSON errors can contain sensitive input.
  console.error(
    error instanceof Error &&
      /^(WebSocket|Invalid WebSocket|Could not establish)/.test(error.message)
      ? error.message
      : 'WebSocket configuration or probe failed.',
  )
  process.exitCode = 1
}
