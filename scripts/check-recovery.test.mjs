import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { closeRecoveryResources, runAcceptanceSuite } from './check-recovery.mjs'
const directories = []
afterEach(async () => {
  for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true })
})
async function reportFile() {
  const d = await mkdtemp(join(tmpdir(), 'recovery-unit-'))
  directories.push(d)
  return join(d, 'report.json')
}
it('rejects a non-loopback fixture before running any scenario', async () => {
  let executed = false
  await expect(
    runAcceptanceSuite({
      origin: 'https://gogo-dl.onrender.com',
      scenarios: ['login-503'],
      runScenario: async () => {
        executed = true
      },
      close: async () => {},
      reportFile: await reportFile(),
    }),
  ).rejects.toThrow(/loopback/)
  expect(executed).toBe(false)
})
it('closes real fixture resources and returns nonzero after a failed scenario', async () => {
  const server = createServer((_q, r) => r.end('ready'))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const file = await reportFile()
  const result = await runAcceptanceSuite({
    origin,
    scenarios: ['login-503'],
    reportFile: file,
    runScenario: async () => {
      expect((await fetch(origin)).status).toBe(200)
      throw Error('Bearer secret')
    },
    close: () => new Promise((r) => server.close(r)),
  })
  expect(result).toBe(1)
  await expect(fetch(origin)).rejects.toThrow()
  const report = JSON.parse(await readFile(file, 'utf8'))
  expect(report.checks).toEqual([{ name: 'login-503', simulated: true, pass: false }])
  expect(JSON.stringify(report)).not.toContain('secret')
})
it('reports only counts, never response bodies, keys or raw URLs', async () => {
  const file = await reportFile()
  expect(
    await runAcceptanceSuite({
      origin: 'http://127.0.0.1:1234',
      scenarios: ['workspace-503'],
      reportFile: file,
      close: async () => {},
      runScenario: async () => ({
        canonicalMessageCount: 1,
        requestCounts: { 'GET /api/v1/rooms': 2 },
        headers: { Authorization: 'Bearer secret' },
        body: 'private message',
        key: 'retry-secret',
        url: 'wss://host/?token=secret',
      }),
    }),
  ).toBe(0)
  const report = JSON.parse(await readFile(file, 'utf8'))
  expect(report.checks[0]).toEqual({
    name: 'workspace-503',
    simulated: true,
    pass: true,
    canonicalMessageCount: 1,
    requestCounts: { 'GET /api/v1/rooms': 2 },
  })
  expect(JSON.stringify(report)).not.toMatch(/secret|private|wss:/)
})
it('fixture rejects a changed payload under an existing mention key', async () => {
  const { startRecoveryApi } = await import('./fixtures/recovery-api.mjs')
  const fixture = await startRecoveryApi()
  try {
    const post = (content) =>
      fetch(fixture.origin + '/api/v1/rooms/7/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-test-key' },
        body: JSON.stringify({ content, mention_user_ids: [2] }),
      })
    expect((await post('Original synthetic message')).status).toBe(201)
    expect((await post('Changed synthetic message')).status).toBe(409)
    expect(fixture.snapshot().canonicalMessageCount).toBe(1)
  } finally {
    await fixture.close()
  }
})

it('persists scenario evidence and returns failure when cleanup rejects without exposing its error', async () => {
  const file = await reportFile()
  const exit = await runAcceptanceSuite({
    origin: 'http://127.0.0.1:1234',
    scenarios: ['workspace-503'],
    reportFile: file,
    runScenario: async () => ({}),
    close: async () => {
      throw Error('Bearer private-cleanup-secret')
    },
  })
  expect(exit).toBe(1)
  const report = JSON.parse(await readFile(file, 'utf8'))
  expect(report.checks).toEqual([{ name: 'workspace-503', simulated: true, pass: true }])
  expect(report.cleanupComplete).toBe(false)
  expect(JSON.stringify(report)).not.toMatch(/Bearer|secret/)
})

it('attempts API cleanup even if closing the application fails and records incomplete cleanup', async () => {
  const file = await reportFile()
  let apiClosed = false
  const exit = await runAcceptanceSuite({
    origin: 'http://127.0.0.1:1234',
    scenarios: ['workspace-503'],
    reportFile: file,
    runScenario: async () => ({}),
    close: () =>
      closeRecoveryResources(
        {
          close: () => {
            throw Error('private provider details')
          },
        },
        {
          close: async () => {
            apiClosed = true
          },
        },
      ),
  })
  expect(apiClosed).toBe(true)
  expect(exit).toBe(1)
  expect(JSON.parse(await readFile(file, 'utf8')).cleanupComplete).toBe(false)
})
