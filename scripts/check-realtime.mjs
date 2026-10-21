import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startRealtimeApi } from './fixtures/realtime-api.mjs'
import {
  requireLoopback,
  startAcceptanceApp,
  withAcceptanceBrowser,
} from './lib/acceptance-browser.mjs'
import {
  openRealtimePage,
  startRealtimeProxy,
  setRealtimeVisibility,
} from './lib/realtime-browser.mjs'

export const realtimeScenarios = [
  'lifecycle-retained',
  'presence-tabs',
  'typing-lifecycle',
  'subscription-ack',
  'activity-late-account',
  'recovery-and-rate-limit',
  'revocation-batch',
  'mobile-keyboard',
]
export async function runRealtimeSuite({ origin, names, runScenario, closes, reportFile }) {
  requireLoopback(origin)
  const report = { checks: [], cleanupComplete: false }
  let exit = 0
  try {
    for (const name of names) {
      if (!realtimeScenarios.includes(name)) throw Error('Unknown realtime scenario')
      try {
        const data = await runScenario(name),
          check = { name, simulated: true, pass: true }
        for (const key of [
          'connections',
          'subscriptions',
          'privacyViolationCount',
          'escapedNavigationCount',
        ])
          if (Number.isSafeInteger(data?.[key])) check[key] = data[key]
        check.requestCounts = Object.fromEntries(
          Object.entries(data?.requestCounts || {}).filter(
            ([k, v]) =>
              /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/[a-z/:-]+$/.test(k) &&
              Number.isSafeInteger(v),
          ),
        )
        report.checks.push(check)
      } catch {
        exit = 1
        report.checks.push({ name, simulated: true, pass: false })
      }
    }
  } finally {
    const results = await Promise.allSettled(closes.map((close) => Promise.resolve().then(close)))
    report.cleanupComplete = results.every((r) => r.status === 'fulfilled')
    if (!report.cleanupComplete) exit = 1
    await writeFile(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  return exit
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function realtimeMain() {
  const dir = await mkdtemp(join(tmpdir(), 'gogo-realtime-')),
    api = await startRealtimeApi()
  let app, proxy
  try {
    app = await startAcceptanceApp(api.origin)
    api.allowOrigin(app.origin)
    proxy = await startRealtimeProxy({ appOrigin: app.origin, apiOrigin: api.origin })
    const exit = await runRealtimeSuite({
      origin: api.origin,
      names: process.env.REALTIME_SCENARIOS?.split(',') || realtimeScenarios,
      reportFile: join(dir, 'report.json'),
      closes: [() => proxy.close(), () => app.close(), () => api.close()],
      runScenario: async (name) => {
        console.log('Checking simulated realtime scenario: ' + name)
        api.setScenario(name)
        return withAcceptanceBrowser(
          {
            artifactDir: join(dir, name),
            chromeArgs: [
              '--proxy-server=' + proxy.origin,
              '--proxy-bypass-list=<-loopback>',
              '--disable-background-networking',
            ],
          },
          async (browser) => {
            const pages = []
            const open = async (user = 1) => {
              const p = await openRealtimePage({
                browser,
                appOrigin: app.origin,
                apiOrigin: api.origin,
              })
              pages.push(p)
              await browser.command(
                'Page.addScriptToEvaluateOnNewDocument',
                {
                  source: `if(location.origin===${JSON.stringify(app.origin)})sessionStorage.setItem('gogo-dl-session',JSON.stringify({access_token:'fixture-${user}',refresh_token:'refresh-${user}',expires_at:9999999999}))`,
                },
                p.session,
              )
              await browser.command(
                'Page.navigate',
                { url: app.origin + '/app/rooms/7' },
                p.session,
              )
              await browser.waitFor(
                p.session,
                "!!document.querySelector('.composer textarea:not(:disabled)')",
              )
              return p
            }
            const ev = (p, s) => browser.evaluate(p.session, s),
              wait = (p, s, t) => browser.waitFor(p.session, s, t)
            const text = (p, label) =>
              wait(p, `document.body.textContent.includes(${JSON.stringify(label)})`)
            const input = async (p, value) => {
              await ev(p, "document.querySelector('.composer textarea').focus()")
              await browser.command('Input.insertText', { text: value }, p.session)
            }
            const click = (p, label) =>
              wait(
                p,
                `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)}));if(!b||b.disabled)return false;b.click();return true})()`,
              )
            const members = async (p) => {
              await click(p, '☷ MEMBERS')
              await wait(p, "!!document.querySelector('.members-panel')")
            }
            const a = await open()
            try {
              if (name === 'lifecycle-retained') {
                await click(a, 'LOAD OLDER MESSAGES')
                await text(a, 'Synthetic message 6')
                await input(a, 'draft retained')
                api.lifecycle(6)
                await text(a, 'Revised message 6')
                api.lifecycle(6, true)
                await wait(a, "!document.body.textContent.includes('Revised message 6')")
                assert.equal(
                  await ev(a, "document.querySelector('.composer textarea').value"),
                  'draft retained',
                )
              } else if (name === 'presence-tabs') {
                await members(a)
                await text(a, '1 online')
                const b = await open(2)
                await text(a, '2 online')
                const c = await open(2)
                await c.close()
                await text(a, '2 online')
                await b.close()
                await text(a, '1 online')
              } else if (name === 'typing-lifecycle') {
                const b = await open(2)
                await input(b, 't')
                await text(a, 'Member 2 is typing')
                const requests = { ...api.snapshot().requestCounts }
                await sleep(1000)
                await input(b, 'y')
                await sleep(1100)
                assert.ok(api.snapshot().commands.typing_started >= 2)
                await text(a, 'Member 2 is typing')
                await ev(b, "document.querySelector('.composer textarea').blur()")
                await wait(a, "!document.body.textContent.includes('is typing')")
                await sleep(2100)
                await input(b, ' hide')
                await text(a, 'Member 2 is typing')
                const startsBeforeHide = api.snapshot().commands.typing_started
                const joinsBeforeHide = api.snapshot().commands.join
                await setRealtimeVisibility(browser, b.session, true)
                await wait(a, "!document.querySelector('.typing-indicator')")
                await sleep(2100)
                assert.equal(api.snapshot().commands.typing_started, startsBeforeHide)
                await setRealtimeVisibility(browser, b.session, false)
                await wait(b, "!!document.querySelector('.composer textarea:not(:disabled)')")
                assert.ok(api.snapshot().commands.join > joinsBeforeHide)
                assert.equal(api.snapshot().commands.typing_started, startsBeforeHide)
                await input(b, ' resumed')
                await text(a, 'Member 2 is typing')
                await ev(b, "document.querySelector('.composer textarea').blur()")
                await wait(a, "!document.querySelector('.typing-indicator')")
                api.broadcast({
                  type: 'typing_started',
                  room_id: '7',
                  payload: { user_id: 2, expires_at: new Date(Date.now() + 5000).toISOString() },
                })
                await text(a, 'Member 2 is typing')
                await wait(a, "!document.body.textContent.includes('is typing')", 6500)
                const after = api.snapshot().requestCounts
                assert.ok(
                  (after['GET /api/v1/rooms/:id/members'] || 0) -
                    (requests['GET /api/v1/rooms/:id/members'] || 0) <=
                    1,
                )
              } else if (name === 'subscription-ack') {
                await open(1)
                await input(a, 'before ACK')
                await sleep(150)
                assert.equal(api.snapshot().commands.typing_started || 0, 0)
                api.ack()
                await input(a, ' after ACK')
                await sleep(100)
                assert.equal(api.snapshot().commands.typing_started, 1)
              } else if (name === 'activity-late-account') {
                await open(2)
                api.delayPresence(true)
                api.broadcast({
                  type: 'typing_started',
                  room_id: '7',
                  payload: { user_id: 2, expires_at: 'invalid' },
                })
                await sleep(150)
                await ev(
                  a,
                  "sessionStorage.setItem('gogo-dl-session',JSON.stringify({access_token:'fixture-2',refresh_token:'refresh-2',expires_at:9999999999}));window.dispatchEvent(new CustomEvent('session:changed',{detail:{accountChanged:true}}))",
                )
                api.releasePresence()
                await sleep(300)
                assert.equal(await ev(a, "!!document.querySelector('.typing-indicator')"), false)
              } else if (name === 'recovery-and-rate-limit') {
                await members(a)
                await text(a, '1 online')
                api.setRate(true)
                api.broadcast({
                  type: 'typing_started',
                  room_id: '7',
                  payload: { user_id: 2, expires_at: 'bad' },
                })
                await text(a, 'Activity unavailable')
                const count = api.snapshot().requestCounts['GET /api/v1/rooms/:id/presence']
                for (let i = 0; i < 3; i++)
                  api.broadcast({
                    type: 'typing_stopped',
                    room_id: '7',
                    payload: { user_id: 2, expires_at: 'bad' },
                  })
                await sleep(500)
                assert.equal(api.snapshot().requestCounts['GET /api/v1/rooms/:id/presence'], count)
                api.setRate(false)
                api.disconnect()
                await text(a, '1 online')
                await browser.command(
                  'Network.emulateNetworkConditions',
                  { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
                  a.session,
                )
                await text(a, 'Offline')
                await browser.command(
                  'Network.emulateNetworkConditions',
                  { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
                  a.session,
                )
                await text(a, '1 online')
              } else if (name === 'revocation-batch') {
                api.revoke(1)
                await wait(a, "location.pathname==='/app'")
                assert.equal(
                  await ev(
                    a,
                    "document.body.textContent.includes('Synthetic message')||!!document.querySelector('.typing-indicator')",
                  ),
                  false,
                )
              } else if (name === 'mobile-keyboard') {
                await browser.command(
                  'Emulation.setDeviceMetricsOverride',
                  { width: 390, height: 844, deviceScaleFactor: 1, mobile: false },
                  a.session,
                )
                const b = await open(2)
                await input(b, 'mobile activity')
                await text(a, 'Member 2 is typing')
                const activityShot = await browser.command(
                  'Page.captureScreenshot',
                  { format: 'png', captureBeyondViewport: false },
                  a.session,
                )
                await writeFile(
                  join(dir, 'mobile-typing.png'),
                  Buffer.from(activityShot.data, 'base64'),
                )
                await input(a, 'mobile')
                await browser.command(
                  'Input.dispatchKeyEvent',
                  {
                    type: 'keyDown',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    shiftKey: true,
                    modifiers: 8,
                  },
                  a.session,
                )
                assert.equal(
                  api.snapshot().requestCounts['POST /api/v1/rooms/:id/messages'] || 0,
                  0,
                )
                await browser.command(
                  'Input.dispatchKeyEvent',
                  { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
                  a.session,
                )
                await wait(a, "document.querySelector('.composer textarea').value===''")
                assert.equal(await ev(a, 'document.documentElement.scrollWidth<=innerWidth'), true)
                const shot = await browser.command(
                  'Page.captureScreenshot',
                  { format: 'png', captureBeyondViewport: false },
                  a.session,
                )
                await writeFile(join(dir, 'mobile-keyboard.png'), Buffer.from(shot.data, 'base64'))
              }
              const escapedNavigationCount = pages.reduce((n, p) => n + p.escapes, 0)
              assert.equal(escapedNavigationCount, 0)
              assert.equal(api.snapshot().privacyViolationCount, 0)
              return { ...api.snapshot(), escapedNavigationCount }
            } catch (error) {
              await writeFile(
                join(dir, name + '-state.json'),
                JSON.stringify(
                  {
                    text: await ev(a, 'document.body.textContent'),
                    snapshot: api.snapshot(),
                    blocked: pages.flatMap((p) => p.blocked),
                  },
                  null,
                  2,
                ),
                { mode: 0o600 },
              )
              throw error
            }
          },
        ).catch(async (error) => {
          await writeFile(join(dir, name + '-failure.txt'), error.message, { mode: 0o600 })
          throw error
        })
      },
    })
    console.log('Realtime evidence: ' + join(dir, 'report.json'))
    return exit
  } catch {
    await Promise.allSettled([proxy?.close(), app?.close(), api.close()])
    throw Error('Realtime acceptance failed; inspect private artifacts')
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  realtimeMain()
    .then((code) => {
      process.exitCode = code
    })
    .catch((e) => {
      console.error(e.message)
      process.exitCode = 1
    })
