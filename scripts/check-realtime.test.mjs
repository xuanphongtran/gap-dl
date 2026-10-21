import { expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { startRealtimeApi } from './fixtures/realtime-api.mjs'
import { allowedRealtimeURL, startRealtimeProxy } from './lib/realtime-browser.mjs'
import { runRealtimeSuite } from './check-realtime.mjs'

it('rejects remote destinations and escaped targets before requests', async () => {
  expect(
    allowedRealtimeURL('https://external.test/x', 'http://localhost:3000', 'http://127.0.0.1:8080'),
  ).toBe(false)
  expect(
    allowedRealtimeURL(
      'ws://127.0.0.1:8080/api/v1/ws?token=private',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
    ),
  ).toBe(true)
  expect(
    allowedRealtimeURL(
      'ws://127.0.0.1:8080/other',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
    ),
  ).toBe(false)
  await expect(
    startRealtimeProxy({ appOrigin: 'http://localhost:3000', apiOrigin: 'https://external.test' }),
  ).rejects.toThrow()
})
it('persists redacted evidence and attempts every independent close after failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt-report-')),
    closed = []
  const exit = await runRealtimeSuite({
    origin: 'http://127.0.0.1:8080',
    names: ['presence-tabs'],
    reportFile: join(dir, 'report.json'),
    runScenario: async () => ({
      connections: 2,
      token: 'private-value',
      url: 'ws://secret?token=private-value',
      requestCounts: { 'GET /api/v1/rooms/:id/messages': 3, 'secret-token': 9 },
    }),
    closes: [
      async () => {
        closed.push(1)
        throw Error('private-value')
      },
      async () => {
        closed.push(2)
      },
    ],
  })
  expect(exit).toBe(1)
  expect(closed).toEqual([1, 2])
  const report = await readFile(join(dir, 'report.json'), 'utf8')
  expect(report).not.toContain('private-value')
  expect(report).not.toContain('secret-token')
  expect(JSON.parse(report).cleanupComplete).toBe(false)
})
it('real socket upgrades reject unknown Origin, path and token', async () => {
  const api = await startRealtimeApi()
  api.allowOrigin('http://localhost:3000')
  try {
    for (const [path, origin] of [
      ['/api/v1/ws?token=fixture-1', 'http://external.test'],
      ['/other?token=fixture-1', 'http://localhost:3000'],
      ['/api/v1/ws?token=other', 'http://localhost:3000'],
    ]) {
      const status = await new Promise((resolve) => {
        const ws = new WebSocket(api.origin.replace('http:', 'ws:') + path, { origin })
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode)
          res.resume()
          ws.terminate()
        })
        ws.on('error', () => {})
        ws.on('open', () => {
          resolve(101)
          ws.close()
        })
      })
      expect(status).toBe(403)
    }
  } finally {
    await api.close()
  }
})

it('proxy tunnels preserve real upstream authorization and reject non-WebSocket paths', async () => {
  const api = await startRealtimeApi(),
    appOrigin = 'http://localhost:3000'
  api.allowOrigin(appOrigin)
  const proxy = await startRealtimeProxy({ appOrigin, apiOrigin: api.origin })
  const { request } = await import('node:http')
  try {
    for (const [path, expected] of [
      ['/api/v1/ws?token=fixture-1', 101],
      ['/api/v1/ws?token=unknown', 403],
      ['/outside', 403],
    ]) {
      const socket = await new Promise((resolve, reject) => {
        const r = request(proxy.origin, { method: 'CONNECT', path: new URL(api.origin).host })
        r.on('connect', (_res, s) => resolve(s))
        r.on('error', reject)
        r.end()
      })
      const status = await new Promise((resolve) => {
        const ws = new WebSocket(api.origin.replace('http:', 'ws:') + path, {
          origin: appOrigin,
          createConnection: () => socket,
        })
        ws.on('open', () => {
          resolve(101)
          ws.close()
        })
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode)
          res.resume()
          ws.terminate()
        })
        ws.on('error', () => {})
      })
      expect(status).toBe(expected)
    }
  } finally {
    await Promise.allSettled([proxy.close(), api.close()])
  }
})
it('detects escaped future web targets and excludes Chrome internal browser UI', async () => {
  let handler
  const browser = {
    newPage: async () => 'session',
    command: async (method) =>
      method === 'Target.getTargetInfo' ? { targetInfo: { browserContextId: 'context' } } : {},
    onEvent: (fn) => {
      handler = fn
      return () => {}
    },
  }
  const { openRealtimePage } = await import('./lib/realtime-browser.mjs')
  const page = await openRealtimePage({
    browser,
    appOrigin: 'http://localhost:3000',
    apiOrigin: 'http://127.0.0.1:8080',
  })
  await handler({
    method: 'Target.targetCreated',
    params: { targetInfo: { type: 'browser_ui', url: 'chrome://omnibox_popup_aim.html' } },
  })
  expect(page.escapes).toBe(0)
  await handler({
    method: 'Target.targetCreated',
    params: { targetInfo: { type: 'page', url: 'https://external.test/?token=do-not-retain' } },
  })
  expect(page.escapes).toBe(1)
  expect(JSON.stringify(page.blocked)).not.toContain('do-not-retain')
})
it('visibility helper minimizes only the current page window and waits for actual document state', async () => {
  const { setRealtimeVisibility } = await import('./lib/realtime-browser.mjs')
  expect(setRealtimeVisibility).toBeTypeOf('function')
  const calls = [],
    browser = {
      command: async (method, params, session) => {
        calls.push({ method, params, session })
        return method === 'Target.getTargetInfo'
          ? { targetInfo: { targetId: 'target' } }
          : method === 'Browser.getWindowForTarget'
            ? { windowId: 42 }
            : {}
      },
      waitFor: async (session, expression) => {
        calls.push({ session, expression })
      },
    }
  await setRealtimeVisibility(browser, 'current-page', true)
  expect(calls).toContainEqual({
    method: 'Browser.setWindowBounds',
    params: { windowId: 42, bounds: { windowState: 'minimized' } },
    session: undefined,
  })
  expect(calls.at(-1)).toEqual({
    session: 'current-page',
    expression: "document.visibilityState==='hidden'",
  })
})
