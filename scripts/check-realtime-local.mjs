import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WebSocket } from 'ws'
import { prepareRealtimeFixtures } from './lib/realtime-live-fixtures.mjs'
import {
  startAcceptanceApp,
  withAcceptanceBrowser,
  requireLoopback,
} from './lib/acceptance-browser.mjs'
import {
  startRealtimeProxy,
  openRealtimePage,
  setRealtimeVisibility,
} from './lib/realtime-browser.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function realtimeLocalMain({
  directory = process.env.REALTIME_FIXTURE_DIR,
  apiOrigin = process.env.REALTIME_API_ORIGIN || 'http://127.0.0.1:8080',
} = {}) {
  requireLoopback(apiOrigin)
  if (!directory) throw Error('REALTIME_FIXTURE_DIR is required; reuse approved local fixtures')
  let fixtures, app, proxy, rawSocket, cleanup
  const report = {
    checks: [],
    cleanupComplete: false,
    frontendOrigin: 'http://localhost:3000',
    frontendAssetRemapping: true,
    scopedLocalNetworkPermission: true,
  }
  const record = async (name, fn) => {
    try {
      await fn()
      report.checks.push({ name, pass: true })
    } catch (error) {
      report.checks.push({ name, pass: false })
      throw error
    }
  }
  try {
    fixtures = await prepareRealtimeFixtures({ directory, apiOrigin })
    const guest = await fixtures.createGuest(),
      owner = fixtures.owner,
      room = fixtures.rooms.private.id,
      pub = fixtures.rooms.public.id
    const req = async (actor, method, path, body) => {
      const result = await fixtures.request(actor, method, path, body)
      assert.ok(result.status >= 200 && result.status < 300, 'Fixture request rejected')
      return result.data
    }
    await record('public join and private invitation', async () => {
      const denied = await fixtures.request(guest, 'GET', `/api/v1/rooms/${room}/presence`)
      assert.ok([403, 404].includes(denied.status))
      await req(guest, 'POST', `/api/v1/rooms/${pub}/join`)
      const invite = await req(owner, 'POST', `/api/v1/rooms/${room}/invitations`, {
        user_id: guest.id,
      })
      await req(guest, 'POST', `/api/v1/invitations/${invite.id}/accept`)
    })
    // One journaled guest message supplies a lifecycle target; guest deletion must not erase its tombstone identity.
    const message = await req(guest, 'POST', `/api/v1/rooms/${room}/messages`, {
      content: 'Realtime local lifecycle target',
    })
    for (let i = 0; i < 41; i++) {
      await sleep(650)
      await req(guest, 'POST', `/api/v1/rooms/${room}/messages`, {
        content: `Realtime local retained filler ${i + 1}`,
      })
    }
    app = await startAcceptanceApp(apiOrigin)
    const appOrigin = report.frontendOrigin
    proxy = await startRealtimeProxy({ appOrigin, apiOrigin, frontendTransportOrigin: app.origin })
    await withAcceptanceBrowser(
      {
        artifactDir: join(directory, 'native-local'),
        chromeArgs: [
          '--proxy-server=' + proxy.origin,
          '--proxy-bypass-list=<-loopback>',
          '--disable-background-networking',
        ],
      },
      async (browser) => {
        const pages = []
        const open = async (account, id = room) => {
          const p = await openRealtimePage({
            browser,
            appOrigin,
            apiOrigin,
            frontendTransportOrigin: app.origin,
          })
          pages.push(p)
          await browser.command(
            'Page.addScriptToEvaluateOnNewDocument',
            {
              source: `if(location.origin===${JSON.stringify(appOrigin)})sessionStorage.setItem('gogo-dl-session',${JSON.stringify(JSON.stringify(account.session))})`,
            },
            p.session,
          )
          await browser.command('Page.navigate', { url: appOrigin + '/app/rooms/' + id }, p.session)
          await browser.waitFor(
            p.session,
            "!!document.querySelector('.composer textarea:not(:disabled)')",
          )
          return p
        }
        const ev = (p, code) => browser.evaluate(p.session, code),
          wait = (p, code, timeout) => browser.waitFor(p.session, code, timeout)
        const has = (p, text) =>
          wait(p, `document.body.textContent.includes(${JSON.stringify(text)})`)
        const click = (p, text) =>
          wait(
            p,
            `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(text)}));if(!b||b.disabled)return false;b.click();return true})()`,
          )
        const input = async (p, text) => {
          await ev(p, "document.querySelector('.composer textarea').focus()")
          await browser.command('Input.insertText', { text }, p.session)
        }
        const a = await open(owner),
          b = await open(guest)
        await click(a, 'LOAD OLDER MESSAGES')
        await has(a, 'Realtime local lifecycle target')
        await click(a, 'MEMBERS')
        await record('first and last tab online aggregation', async () => {
          await has(a, '2 online')
          const c = await open(guest)
          await c.close()
          await has(a, '2 online')
        })
        await record('native input refresh idle blur and server expiry', async () => {
          await input(b, 'a')
          await has(a, guest.credentials.username + ' is typing')
          await sleep(1000)
          await input(b, 'b')
          await sleep(1100)
          await has(a, guest.credentials.username + ' is typing')
          await wait(a, "!document.querySelector('.typing-indicator')", 4000)
          await input(b, 'c')
          await has(a, guest.credentials.username + ' is typing')
          await ev(b, "document.querySelector('.composer textarea').blur()")
          await wait(a, "!document.querySelector('.typing-indicator')")
          await sleep(2100)
          await input(b, ' hidden transition')
          await has(a, guest.credentials.username + ' is typing')
          await setRealtimeVisibility(browser, b.session, true)
          await wait(a, "!document.querySelector('.typing-indicator')")
          await sleep(2100)
          await setRealtimeVisibility(browser, b.session, false)
          await wait(b, "!!document.querySelector('.composer textarea:not(:disabled)')")
          assert.equal(await ev(a, "!!document.querySelector('.typing-indicator')"), false)
          await input(b, ' restored input')
          await has(a, guest.credentials.username + ' is typing')
          await ev(b, "document.querySelector('.composer textarea').blur()")
          await wait(a, "!document.querySelector('.typing-indicator')")
          await sleep(2100)
          rawSocket = new WebSocket(
            apiOrigin.replace('http:', 'ws:') +
              '/api/v1/ws?token=' +
              encodeURIComponent(guest.session.access_token),
            { origin: appOrigin },
          )
          await new Promise((r, j) => {
            rawSocket.once('open', r)
            rawSocket.once('error', () => j(Error('Local WS rejected')))
          })
          const ack = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Local snapshot timeout')), 8000)
            rawSocket.on('message', (raw) => {
              for (const line of String(raw).split('\n'))
                try {
                  if (JSON.parse(line).type === 'presence_snapshot') {
                    clearTimeout(timer)
                    resolve()
                  }
                } catch {
                  /* Ignore non-JSON heartbeat. */
                }
            })
          })
          rawSocket.send(JSON.stringify({ type: 'join', room_id: String(room) }))
          await ack
          rawSocket.send(JSON.stringify({ type: 'typing_started', room_id: String(room) }))
          await has(a, guest.credentials.username + ' is typing')
          await wait(a, "!document.querySelector('.typing-indicator')", 6500)
          rawSocket.close()
          rawSocket = undefined
        })
        await record('lifecycle edit delete without reconnect', async () => {
          await req(guest, 'PATCH', `/api/v1/rooms/${room}/messages/${message.id}`, {
            content: 'Realtime revised local target',
            revision: message.revision,
          })
          await has(a, 'Realtime revised local target')
          await req(guest, 'DELETE', `/api/v1/rooms/${room}/messages/${message.id}`)
          await wait(a, "!document.body.textContent.includes('Realtime revised local target')")
        })
        await record('foreground fresh snapshot and offline recovery', async () => {
          await setRealtimeVisibility(browser, a.session, true)
          await setRealtimeVisibility(browser, a.session, false)
          await has(a, '2 online')
          await browser.command(
            'Network.emulateNetworkConditions',
            { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
            a.session,
          )
          await wait(a, "!document.querySelector('.typing-indicator')")
          await browser.command(
            'Network.emulateNetworkConditions',
            { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
            a.session,
          )
          await has(a, '2 online')
        })
        await record('private removal and reinvitation privacy', async () => {
          await req(owner, 'DELETE', `/api/v1/rooms/${room}/members/${guest.id}`)
          await wait(b, "location.pathname==='/app'")
          assert.equal(
            await ev(
              b,
              "document.body.textContent.includes('Realtime local lifecycle target')||!!document.querySelector('.typing-indicator')",
            ),
            false,
          )
          const invitation = await req(owner, 'POST', `/api/v1/rooms/${room}/invitations`, {
            user_id: guest.id,
          })
          await req(guest, 'POST', `/api/v1/invitations/${invitation.id}/accept`)
          await b.close()
        })
        await record('public leave and private logout', async () => {
          const c = await open(guest, pub)
          await req(guest, 'DELETE', `/api/v1/rooms/${pub}/membership`)
          await wait(c, "!document.querySelector('.composer textarea:not(:disabled)')")
          await c.close()
          await ev(
            a,
            "sessionStorage.removeItem('gogo-dl-session');window.dispatchEvent(new Event('session:changed'))",
          )
          await wait(a, "!document.querySelector('.composer textarea:not(:disabled)')")
        })
        assert.equal(
          pages.reduce((n, p) => n + p.escapes, 0),
          0,
        )
        const shot = await browser.command(
          'Page.captureScreenshot',
          { format: 'png', captureBeyondViewport: false },
          a.session,
        )
        await writeFile(join(directory, 'native-local.png'), Buffer.from(shot.data, 'base64'), {
          mode: 0o600,
        })
      },
    )
  } catch (error) {
    report.failed = true
    await writeFile(join(directory, 'native-local-failure.txt'), error.message, { mode: 0o600 })
  } finally {
    rawSocket?.terminate()
    const closes = await Promise.allSettled([proxy?.close(), app?.close()])
    try {
      if (fixtures) cleanup = await fixtures.cleanup({ minimumWriteIntervalMs: 650 })
    } catch {
      report.cleanupError = true
    }
    report.cleanupComplete =
      closes.every((r) => r.status === 'fulfilled') && !!cleanup && cleanup.unconfirmed === 0
    const fixtureReport = fixtures?.report()
    Object.assign(report, {
      httpChecks: fixtureReport?.checks,
      cleanupChecks: fixtureReport?.cleanupChecks,
      retained: fixtureReport?.retained,
      cleanup,
    })
    await writeFile(join(directory, 'native-local-report.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    })
  }
  return report.failed || !report.cleanupComplete ? 1 : 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  realtimeLocalMain()
    .then((code) => {
      process.exitCode = code
    })
    .catch(() => {
      console.error('Local realtime acceptance failed; inspect private registry evidence')
      process.exitCode = 1
    })
