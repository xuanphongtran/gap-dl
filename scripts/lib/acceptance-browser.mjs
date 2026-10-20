import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

export function requireLoopback(origin) {
  const u = new URL(origin)
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password
  )
    throw new Error('Acceptance requires a loopback HTTP fixture.')
}
export async function startAcceptanceApp(origin) {
  requireLoopback(origin)
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(origin) },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  return {
    origin: `http://127.0.0.1:${server.httpServer.address().port}`,
    close: () => server.close(),
  }
}
export async function withAcceptanceBrowser(
  {
    artifactDir,
    chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome',
    chromeArgs = [],
  },
  run,
) {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 })
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      ...chromeArgs,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      '--user-data-dir=' + artifactDir + '/chrome',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let ws
  const pending = new Map(),
    handlers = new Set(),
    exceptions = []
  let sequence = 0
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 15000)
      child.on('error', () => {
        clearTimeout(timer)
        reject(Error('Chrome unavailable'))
      })
      child.on('exit', () => {
        clearTimeout(timer)
        reject(Error('Chrome exited before startup'))
      })
      child.stderr.on('data', (chunk) => {
        buffer += chunk
        const m = buffer.match(/DevTools listening on (ws:\/\/\S+)/)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
    })
    ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(Error('Chrome debugger unavailable'))
    })
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data)
      if (message.id) {
        const p = pending.get(message.id)
        if (p) {
          pending.delete(message.id)
          if (message.error) p.reject(Error('CDP command failed'))
          else p.resolve(message.result)
        }
      } else {
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(true)
        for (const handler of handlers)
          Promise.resolve(handler(message)).catch(() => exceptions.push(true))
      }
    }
    const command = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(Error('CDP command timeout'))
        }, 15000)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    const evaluate = async (sessionId, expression) => {
      const r = await command(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )
      if (r.exceptionDetails) throw Error('Browser evaluation failed')
      return r.result.value
    }
    const waitFor = async (sessionId, expression, timeout = 15000) => {
      const end = Date.now() + timeout
      do {
        if (await evaluate(sessionId, expression)) return
        await new Promise((r) => setTimeout(r, 75))
      } while (Date.now() < end)
      throw Error('Browser condition timeout: ' + expression.slice(0, 100))
    }
    const newPage = async () => {
      const context = await command('Target.createBrowserContext')
      const target = await command('Target.createTarget', {
        url: 'about:blank',
        browserContextId: context.browserContextId,
      })
      const { sessionId } = await command('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      })
      await command('Page.enable', {}, sessionId)
      await command('Runtime.enable', {}, sessionId)
      await command('Network.enable', {}, sessionId)
      await command('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId)
      return sessionId
    }
    const value = await run({
      command,
      newPage,
      evaluate,
      waitFor,
      onEvent: (handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    })
    if (exceptions.length) throw Error('Unexpected browser exception')
    return value
  } finally {
    ws?.close()
    for (const p of pending.values()) p.reject(Error('Browser closing'))
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
}
