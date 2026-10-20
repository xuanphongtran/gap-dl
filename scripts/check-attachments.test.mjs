import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { guardAttachmentRequest, runAttachmentSuite } from './check-attachments.mjs'
import { startAttachmentsApi } from './fixtures/attachments-api.mjs'
const dirs = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
async function reportPath() {
  const d = await mkdtemp(join(tmpdir(), 'attachments-unit-'))
  dirs.push(d)
  return join(d, 'report.json')
}
it('rejects non-loopback acceptance before running a scenario', async () => {
  let ran = false
  await expect(
    runAttachmentSuite({
      origin: 'https://gogo-dl.onrender.com',
      names: ['processing'],
      runScenario: async () => {
        ran = true
      },
      close: async () => {},
      reportFile: await reportPath(),
    }),
  ).rejects.toThrow(/loopback/)
  expect(ran).toBe(false)
})
it('persists redacted failure evidence even when cleanup rejects', async () => {
  const file = await reportPath()
  expect(
    await runAttachmentSuite({
      origin: 'http://127.0.0.1:1234',
      names: ['processing'],
      runScenario: async () => {
        throw Error('signature=secret')
      },
      close: async () => {
        throw Error('Bearer secret')
      },
      reportFile: file,
    }),
  ).toBe(1)
  const report = JSON.parse(await readFile(file, 'utf8'))
  expect(report.checks).toEqual([{ name: 'processing', simulated: true, pass: false }])
  expect(report.cleanupComplete).toBe(false)
  expect(JSON.stringify(report)).not.toContain('secret')
})
it('only fulfills the exact synthetic HTTPS provider and blocks all external network', async () => {
  const fixture = await startAttachmentsApi()
  try {
    const origins = [fixture.origin, 'http://127.0.0.1:1234']
    expect(
      (
        await guardAttachmentRequest(
          { url: fixture.origin + '/health', method: 'GET', headers: {} },
          origins,
          fixture,
        )
      ).action,
    ).toBe('continue')
    for (const url of [
      'https://gogo-dl.onrender.com/api/v1/rooms',
      'https://attachments.fixture.invalid.evil.test/uploads/10',
      'http://attachments.fixture.invalid/uploads/10',
      'https://user:pass@attachments.fixture.invalid/uploads/10',
    ])
      expect(
        (await guardAttachmentRequest({ url, method: 'GET', headers: {} }, origins, fixture))
          .action,
      ).toBe('fail')
    const provider = await guardAttachmentRequest(
      { url: 'https://attachments.fixture.invalid/uploads/10', method: 'OPTIONS', headers: {} },
      origins,
      fixture,
    )
    expect(provider.action).toBe('fulfill')
    expect(provider.response.status).toBe(204)
    await guardAttachmentRequest(
      {
        url: 'https://attachments.fixture.invalid/downloads/10',
        method: 'GET',
        headers: { Authorization: 'Bearer synthetic-secret' },
      },
      origins,
      fixture,
    )
    expect(fixture.snapshot().privacyViolationCount).toBe(1)
  } finally {
    await fixture.close()
  }
})
it('fixture respects immutable reservation keys and reports only safe counts', async () => {
  const fixture = await startAttachmentsApi()
  try {
    const post = (body) =>
      fetch(fixture.origin + '/api/v1/rooms/7/attachments/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-upload-key' },
        body: JSON.stringify(body),
      })
    const body = {
      filename: 'a.txt',
      content_type: 'text/plain',
      size_bytes: 1,
      sha256: 'a'.repeat(64),
    }
    const a = await post(body),
      b = await post(body)
    expect(a.status).toBe(201)
    expect((await a.json()).attachment.id).toBe((await b.json()).attachment.id)
    expect((await post({ ...body, filename: 'b.txt' })).status).toBe(409)
    expect(JSON.stringify(fixture.snapshot())).not.toMatch(
      /sha256|filename|upload_url|signature|synthetic-upload-key/,
    )
  } finally {
    await fixture.close()
  }
})
it('successful report whitelists aggregate fields rather than raw transport data', async () => {
  const file = await reportPath()
  expect(
    await runAttachmentSuite({
      origin: 'http://127.0.0.1:1234',
      names: ['send-retry'],
      runScenario: async () => ({
        canonicalMessageCount: 1,
        privacyViolationCount: 0,
        cancellationCount: 0,
        requestCounts: { 'POST /api/v1/rooms/:id/messages': 2 },
        secret: 'signature=secret',
        download_url: 'https://storage.test/private',
      }),
      close: async () => {},
      reportFile: file,
    }),
  ).toBe(0)
  const report = await readFile(file, 'utf8')
  expect(report).not.toMatch(/signature|secret|download_url/)
  expect(JSON.parse(report).checks[0].canonicalMessageCount).toBe(1)
})
it('local pinned HTTPS provider receives actual original bytes without an external storage request', async () => {
  const fixture = await startAttachmentsApi(),
    file = await reportPath()
  const { dirname } = await import('node:path'),
    { request } = await import('node:https'),
    { createHash } = await import('node:crypto')
  try {
    const provider = await fixture.startProvider(dirname(file)),
      bytes = Buffer.from('a')
    const reservation = await fetch(fixture.origin + '/api/v1/rooms/7/attachments/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-https-key' },
      body: JSON.stringify({
        filename: 'a.txt',
        content_type: 'text/plain',
        size_bytes: 1,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    })
    const ticket = await reservation.json(),
      url = new URL(ticket.upload_url)
    expect(url.origin).toBe(provider.origin)
    expect(
      guardAttachmentRequest(
        { url: ticket.upload_url, method: 'PUT', headers: {} },
        [fixture.origin],
        fixture,
      ).action,
    ).toBe('provider')
    const status = await new Promise((resolve, reject) => {
      const r = request(
        {
          hostname: '127.0.0.1',
          port: url.port,
          path: url.pathname,
          method: 'PUT',
          ca: provider.certificate,
          headers: ticket.headers,
        },
        (response) => {
          response.resume()
          resolve(response.statusCode)
        },
      )
      r.on('error', reject)
      r.end(bytes)
    })
    expect(status).toBe(200)
    await fetch(fixture.origin + `/api/v1/rooms/7/attachments/${ticket.attachment.id}/complete`, {
      method: 'POST',
    })
    expect(
      (
        await (
          await fetch(fixture.origin + `/api/v1/rooms/7/attachments/${ticket.attachment.id}`)
        ).json()
      ).verified,
    ).toBe(true)
    expect(
      provider.chromeArgs.some((arg) => arg.startsWith('--ignore-certificate-errors-spki-list=')),
    ).toBe(true)
    expect(provider.chromeArgs).not.toContain('--ignore-certificate-errors')
  } finally {
    await fixture.close()
  }
})
it('origin proxy denies HTTP and CONNECT before any forbidden loopback request', async () => {
  const { createServer, request } = await import('node:http')
  const { startAttachmentsProxy } = await import('./lib/attachments-proxy.mjs')
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.end('local')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const proxy = await startAttachmentsProxy([origin], 'https://attachments.fixture.invalid:1234')
  const send = (path, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = request(proxy.origin, { method, path }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('connect', (res, socket) => {
        socket.destroy()
        resolve(res.statusCode)
      })
      req.on('error', reject)
      req.end()
    })
  try {
    expect(await send(origin + '/allowed')).toBe(200)
    expect(await send('http://localhost:' + server.address().port + '/denied')).toBe(403)
    expect(await send('attachments.fixture.invalid.evil.test:1234', 'CONNECT')).toBe(403)
    expect(hits).toBe(1)
    expect(proxy.denied).toBe(2)
  } finally {
    await proxy.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
