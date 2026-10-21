import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { prepareRealtimeFixtures } from './lib/realtime-live-fixtures.mjs'
import { requireLoopback } from './lib/acceptance-browser.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function runActivityContract({
  directory,
  apiOrigin = 'http://127.0.0.1:8080',
  origin = 'http://localhost:3000',
}) {
  requireLoopback(apiOrigin)
  requireLoopback(origin)
  if (!directory) throw Error('REALTIME_FIXTURE_DIR must name an existing private directory')
  const report = {
    apiOrigin,
    origin,
    startedAt: new Date().toISOString(),
    passed: false,
    activitySupported: false,
    checks: [],
  }
  let fixtures
  const clients = []
  const check = async (name, run) => {
    try {
      await run()
      report.checks.push({ name, passed: true })
    } catch {
      report.checks.push({ name, passed: false })
      throw Error(name)
    }
  }
  const snapshot = (event, roomId) => {
    assert.equal(event.room_id, String(roomId))
    assert.equal(event.payload.room_id, String(roomId))
    for (const field of ['online_user_ids', 'typing_user_ids']) {
      const ids = event.payload[field]
      assert.ok(Array.isArray(ids))
      assert.ok(ids.every((id) => Number.isSafeInteger(id) && id > 0))
      assert.equal(new Set(ids).size, ids.length)
    }
    return event.payload
  }
  async function connect(account) {
    const url = new URL('/api/v1/ws', apiOrigin)
    url.protocol = 'ws:'
    url.searchParams.set('token', account.session.access_token)
    const ws = new WebSocket(url, { headers: { Origin: origin }, perMessageDeflate: false }),
      events = []
    let failed = false
    ws.on('error', () => {
      failed = true
    })
    ws.on('message', (data) => {
      for (const line of data.toString().split('\n'))
        if (line.trim())
          try {
            events.push(JSON.parse(line))
          } catch {
            failed = true
          }
    })
    const client = {
      ws,
      events,
      send: (type, id) => ws.send(JSON.stringify({ type, room_id: String(id) })),
      take: async (predicate, timeout = 8000) => {
        const deadline = Date.now() + timeout
        do {
          const i = events.findIndex(predicate)
          if (i >= 0) return events.splice(i, 1)[0]
          if (failed) throw Error('Protocol connection failed')
          await sleep(20)
        } while (Date.now() < deadline)
        throw Error('Protocol observation timed out')
      },
      close: () =>
        new Promise((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) return resolve()
          const timer = setTimeout(() => {
            ws.terminate()
            resolve()
          }, 500)
          ws.once('close', () => {
            clearTimeout(timer)
            resolve()
          })
          ws.close()
        }),
    }
    clients.push(client)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Upgrade timed out')), 5000)
      ws.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.once('error', () => {
        clearTimeout(timer)
        reject(Error('Upgrade rejected'))
      })
    })
    return client
  }
  try {
    for (const path of ['/health', '/readyz', '/swagger/doc.json', '/asyncapi/asyncapi.yaml'])
      await check('local ' + path, async () => {
        const r = await fetch(apiOrigin + path, { signal: AbortSignal.timeout(10000) })
        assert.equal(r.status, 200)
        const body = await r.text()
        if (path.endsWith('.json') || path.endsWith('.yaml'))
          report[path.endsWith('.yaml') ? 'asyncapiSha256' : 'swaggerSha256'] = createHash('sha256')
            .update(body)
            .digest('hex')
      })
    fixtures = await prepareRealtimeFixtures({ directory, apiOrigin })
    const { owner, rooms } = fixtures,
      guest = await fixtures.createGuest(),
      publicId = rooms.public.id,
      privateId = rooms.private.id
    await check('public nonmember presence403 and private404', async () => {
      assert.equal(
        (await fixtures.request(guest, 'GET', `/api/v1/rooms/${publicId}/presence`)).status,
        403,
      )
      assert.equal(
        (await fixtures.request(guest, 'GET', `/api/v1/rooms/${privateId}/presence`)).status,
        404,
      )
    })
    const denied = await connect(guest)
    await check('unauthorized websocket join denied', async () => {
      denied.send('join', privateId)
      const e = await denied.take((e) => e.type === 'error')
      assert.equal(e.payload.code, 'forbidden')
    })
    await denied.close()
    await check('fixture public join and private invite acceptance', async () => {
      assert.equal(
        (await fixtures.request(guest, 'POST', `/api/v1/rooms/${publicId}/join`)).status,
        200,
      )
      const invite = await fixtures.request(
        owner,
        'POST',
        `/api/v1/rooms/${privateId}/invitations`,
        { user_id: guest.id },
      )
      assert.equal(invite.status, 201)
      assert.equal(
        (await fixtures.request(guest, 'POST', `/api/v1/invitations/${invite.data.id}/accept`))
          .status,
        200,
      )
    })
    const o = await connect(owner)
    await check('initial owner snapshot matches typed contract', async () => {
      o.send('join', publicId)
      const p = snapshot(await o.take((e) => e.type === 'presence_snapshot'), publicId)
      assert.deepEqual(p.online_user_ids, [owner.id])
    })
    let a = await connect(guest)
    await check('first guest subscription emits online and snapshot', async () => {
      a.send('join', publicId)
      const p = snapshot(await a.take((e) => e.type === 'presence_snapshot'), publicId)
      assert.deepEqual(
        p.online_user_ids,
        [owner.id, guest.id].sort((a, b) => a - b),
      )
      const e = await o.take((e) => e.type === 'presence' && e.payload.user_id === guest.id)
      assert.equal(e.payload.online, true)
    })
    const b = await connect(guest)
    await check('second tab is aggregated once and first close stays online', async () => {
      b.send('join', publicId)
      const p = snapshot(await b.take((e) => e.type === 'presence_snapshot'), publicId)
      assert.equal(p.online_user_ids.length, 2)
      await a.close()
      await sleep(100)
      assert.equal(
        o.events.some(
          (e) => e.type === 'presence' && e.payload.user_id === guest.id && !e.payload.online,
        ),
        false,
      )
      const r = await fixtures.request(owner, 'GET', `/api/v1/rooms/${publicId}/presence`)
      assert.equal(r.status, 200)
      assert.ok(r.data.online_user_ids.includes(guest.id))
    })
    await check('last guest tab close emits offline', async () => {
      await b.close()
      const e = await o.take(
        (e) => e.type === 'presence' && e.payload.user_id === guest.id && !e.payload.online,
      )
      assert.equal(e.payload.online, false)
    })
    a = await connect(guest)
    a.send('join', publicId)
    snapshot(await a.take((e) => e.type === 'presence_snapshot'), publicId)
    await check('duplicate join returns a fresh snapshot', async () => {
      a.send('join', publicId)
      snapshot(await a.take((e) => e.type === 'presence_snapshot'), publicId)
    })
    let firstExpiry
    await check('typing start has user identity and five-second deadline', async () => {
      a.send('typing_started', publicId)
      const e = await o.take((e) => e.type === 'typing_started' && e.payload.user_id === guest.id)
      firstExpiry = Date.parse(e.payload.expires_at)
      assert.ok(firstExpiry > Date.now() + 4000 && firstExpiry <= Date.now() + 5100)
    })
    await check('controlled repeated start is rate_limited', async () => {
      a.send('typing_started', publicId)
      const e = await a.take((e) => e.type === 'error')
      assert.equal(e.payload.code, 'rate_limited')
    })
    await check('typing refresh extends deadline and explicit stop uses null', async () => {
      await sleep(2100)
      a.send('typing_started', publicId)
      const e = await o.take((e) => e.type === 'typing_started' && e.payload.user_id === guest.id)
      assert.ok(Date.parse(e.payload.expires_at) > firstExpiry)
      a.send('typing_stopped', publicId)
      const stop = await o.take(
        (e) => e.type === 'typing_stopped' && e.payload.user_id === guest.id,
      )
      assert.equal(stop.payload.expires_at, null)
    })
    await check('typing expires without a client stop', async () => {
      await sleep(1100)
      a.send('typing_started', publicId)
      await o.take((e) => e.type === 'typing_started' && e.payload.user_id === guest.id)
      const stop = await o.take(
        (e) => e.type === 'typing_stopped' && e.payload.user_id === guest.id,
        8000,
      )
      assert.equal(stop.payload.expires_at, null)
    })
    const p = await connect(guest)
    p.send('join', privateId)
    snapshot(await p.take((e) => e.type === 'presence_snapshot'), privateId)
    await check('private leave revokes presence and typing access', async () => {
      assert.equal(
        (await fixtures.request(guest, 'DELETE', `/api/v1/rooms/${privateId}/membership`)).status,
        204,
      )
      assert.equal(
        (await fixtures.request(guest, 'GET', `/api/v1/rooms/${privateId}/presence`)).status,
        404,
      )
      p.send('typing_started', privateId)
      await p.take(
        (e) =>
          e.type === 'error' &&
          ['membership_revoked', 'forbidden', 'not_joined'].includes(e.payload.code),
      )
    })
    report.passed = true
    report.activitySupported = true
  } catch (e) {
    report.failure =
      report.checks.at(-1)?.passed === false
        ? e.message
        : 'Local activity setup/probe failed; inspect private journal'
  } finally {
    const closed = await Promise.allSettled(clients.map((c) => c.close()))
    if (closed.some((r) => r.status === 'rejected')) report.passed = false
    if (fixtures) {
      try {
        report.cleanup = await fixtures.cleanup()
      } catch {
        report.cleanup = { unconfirmed: 1, error: 'Cleanup could not be confirmed' }
        report.passed = false
      }
      const safe = fixtures.report()
      report.httpChecks = safe.checks
      report.cleanupChecks = safe.cleanupChecks
      report.retained = safe.retained
      if (report.cleanup.unconfirmed) report.passed = false
    }
    report.finishedAt = new Date().toISOString()
    await writeFile(
      join(directory, 'activity-contract-report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    )
  }
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await runActivityContract({
      directory: process.env.REALTIME_FIXTURE_DIR,
      apiOrigin: process.env.REALTIME_API_ORIGIN || 'http://127.0.0.1:8080',
      origin: process.env.WS_ORIGIN || 'http://localhost:3000',
    })
    console.log(JSON.stringify(r))
    process.exitCode = r.passed ? 0 : 1
  } catch {
    console.error('Activity contract failed: check private directory, loopback origin and journal.')
    process.exitCode = 1
  }
}
