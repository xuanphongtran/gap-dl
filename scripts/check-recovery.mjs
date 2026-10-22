import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  requireLoopback,
  startAcceptanceApp,
  withAcceptanceBrowser,
} from './lib/acceptance-browser.mjs'
import { startRecoveryApi } from './fixtures/recovery-api.mjs'
const scenarios = [
  'login-503',
  'workspace-503',
  'mention-response-loss',
  'inbox-429',
  'inbox-429-no-header',
  'inbox-429-malformed-header',
  'session-change',
]
export async function runAcceptanceSuite({
  origin,
  scenarios: names,
  runScenario,
  close,
  reportFile,
}) {
  requireLoopback(origin)
  const report = { checks: [] }
  let exit = 0
  try {
    for (const name of names) {
      if (!scenarios.includes(name)) throw Error('Unknown scenario')
      try {
        const result = await runScenario(name)
        const check = { name, simulated: true, pass: true }
        if (result?.requestCounts)
          check.requestCounts = Object.fromEntries(
            Object.entries(result.requestCounts).filter(
              ([key, value]) =>
                /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/[a-z/:-]+$/.test(key) &&
                Number.isSafeInteger(value) &&
                value >= 0,
            ),
          )
        if (Number.isSafeInteger(result?.canonicalMessageCount))
          check.canonicalMessageCount = result.canonicalMessageCount
        report.checks.push(check)
      } catch {
        report.checks.push({ name, simulated: true, pass: false })
        exit = 1
      }
    }
  } finally {
    try {
      await close()
      report.cleanupComplete = true
    } catch {
      report.cleanupComplete = false
      exit = 1
    }
    await writeFile(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  return exit
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function closeRecoveryResources(app, api) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => app?.close()),
    Promise.resolve().then(() => api.close()),
  ])
  if (results.some((result) => result.status === 'rejected'))
    throw Error('Recovery resource cleanup failed')
}
export async function recoveryMain() {
  const dir = await mkdtemp(join(tmpdir(), 'gogo-recovery-'))
  const api = await startRecoveryApi()
  let app
  let cleanupHandled = false
  try {
    app = await startAcceptanceApp(api.origin)
    const exit = await runAcceptanceSuite({
      origin: api.origin,
      scenarios,
      reportFile: join(dir, 'report.json'),
      close: async () => {
        cleanupHandled = true
        await closeRecoveryResources(app, api)
      },
      runScenario: async (name) => {
        api.setScenario(name)
        const artifactDir = join(dir, name)
        await mkdir(artifactDir, { mode: 0o700 })
        console.log('Checking simulated scenario: ' + name)
        return withAcceptanceBrowser({ artifactDir }, async (browser) => {
          const { command, evaluate: ev, waitFor: wait } = browser,
            s = await browser.newPage()
          const navigate = async (path) => {
            await command('Page.navigate', { url: app.origin + path }, s)
            await wait(
              s,
              `location.pathname===${JSON.stringify(path)} && document.readyState==='complete'`,
            )
          }
          const click = async (text) =>
            wait(
              s,
              `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`,
            )
          const fill = async (selector, value) =>
            ev(
              s,
              `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
            )
          await navigate('/login')
          await wait(s, "!!document.querySelector('input[type=email]')")
          await fill('input[type=email]', 'member@example.test')
          await fill('input[type=password]', 'fixture-password')
          await ev(s, "document.querySelector('form').requestSubmit()")
          if (name === 'login-503') {
            await wait(s, "document.body.textContent.includes('temporarily unavailable')")
            await sleep(1100)
            assert.equal(api.snapshot().requestCounts['POST /api/v1/auth/login'], 1)
            assert.equal(
              await ev(s, "document.querySelector('input[type=password]').value"),
              'fixture-password',
            )
            await ev(s, "document.querySelector('form').requestSubmit()")
          }
          await wait(s, "location.pathname==='/app'")
          if (name === 'workspace-503') {
            await wait(
              s,
              "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='RETRY WORKSPACE')",
            )
            api.recover()
            await click('RETRY WORKSPACE')
            await wait(
              s,
              "document.querySelectorAll('.room-link').length===2 && !document.body.textContent.includes('temporarily unavailable')",
            )
          } else if (name.startsWith('inbox-429')) {
            const notificationTimes = []
            const stopTimes = browser.onEvent((m) => {
              if (
                m.sessionId === s &&
                m.method === 'Network.requestWillBeSent' &&
                m.params.request.method === 'GET' &&
                new URL(m.params.request.url).pathname === '/api/v1/users/me/notifications'
              )
                notificationTimes.push(m.params.timestamp * 1000)
            })
            await navigate('/app/inbox')
            await wait(s, "!!document.querySelector('.inbox-screen [role=alert]')")
            api.recover()
            const count = api.snapshot().requestCounts['GET /api/v1/users/me/notifications']
            if (name === 'inbox-429') {
              for (let i = 0; i < 3; i++) {
                await ev(
                  s,
                  "(async()=>{window.dispatchEvent(new Event('focus'));const {queryClient}=await import('/src/lib/query.ts');await queryClient.invalidateQueries({queryKey:['notifications']});[...document.querySelectorAll('.inbox-screen [role=alert] button')].find(b=>b.textContent.trim()==='RETRY')?.click()})()",
                )
                await sleep(600)
              }
              assert.equal(
                api.snapshot().requestCounts['GET /api/v1/users/me/notifications'],
                count,
              )
              await wait(s, "document.querySelectorAll('.notification-row').length===1", 12000)
              assert.ok(notificationTimes[1] - notificationTimes[0] >= 5000)
            } else {
              assert.equal(await ev(s, "document.body.textContent.includes('RETRY IN')"), false)
              await wait(
                s,
                "(()=>{const b=document.querySelector('.inbox-screen [role=alert] button');if(!b||b.disabled)return false;b.click();return true})()",
              )
              await wait(s, "document.querySelectorAll('.notification-row').length===1")
            }
            stopTimes()
          } else if (name === 'mention-response-loss') {
            await navigate('/app/rooms/7')
            await wait(
              s,
              "!!document.querySelector('.mention-picker select option[value=\"2\"]') && !document.querySelector('#message-input').disabled",
            )
            let dropped = false
            const remove = browser.onEvent(async (m) => {
              if (m.sessionId === s && m.method === 'Fetch.requestPaused') {
                if (!dropped && m.params.responseStatusCode === 201) {
                  dropped = true
                  await command(
                    'Fetch.failRequest',
                    { requestId: m.params.requestId, errorReason: 'ConnectionClosed' },
                    s,
                  )
                } else await command('Fetch.continueRequest', { requestId: m.params.requestId }, s)
              }
            })
            await command(
              'Fetch.enable',
              {
                patterns: [
                  { urlPattern: api.origin + '/api/v1/rooms/7/messages', requestStage: 'Response' },
                ],
              },
              s,
            )
            await fill('#message-input', 'Synthetic pending mention')
            await ev(
              s,
              "(()=>{const e=document.querySelector('.mention-picker select');e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#message-input').focus()})()",
            )
            await command(
              'Input.dispatchKeyEvent',
              {
                type: 'keyDown',
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                text: '\r',
              },
              s,
            )
            await wait(s, "document.body.textContent.includes('DISCARD PENDING SEND')")
            await sleep(1000)
            assert.equal(api.snapshot().requestCounts['POST /api/v1/rooms/:id/messages'], 1)
            assert.ok(dropped)
            await command('Fetch.disable', {}, s)
            remove()
            await wait(
              s,
              "(()=>{const p=[...document.querySelectorAll('.alert')].find(e=>e.textContent.includes('DISCARD PENDING SEND'));const b=p?.querySelector('button');if(!b||b.disabled)return false;b.click();return true})()",
            )
            await wait(s, "document.querySelector('#message-input').value===''")
            assert.equal(api.snapshot().canonicalMessageCount, 1)
            assert.equal(api.snapshot().requestCounts['POST /api/v1/rooms/:id/messages'], 2)
          } else if (name === 'session-change') {
            await wait(s, "document.body.textContent.includes('temporarily unavailable')")
            api.recover()
            await click('RETRY WORKSPACE')
            for (let attempt = 0; attempt < 100 && !api.pendingRecoveryCount(); attempt++)
              await sleep(50)
            assert.equal(api.pendingRecoveryCount(), 1)
            assert.equal(
              await ev(
                s,
                "(async()=>{const {queryClient,queryKeys}=await import('/src/lib/query.ts');return queryClient.getQueryState(queryKeys.rooms)?.fetchStatus==='fetching'})()",
              ),
              true,
            )
            await ev(
              s,
              "(async()=>{const {useAuthStore}=await import('/src/stores/auth.ts');useAuthStore().logout()})()",
            )
            await wait(s, "location.pathname==='/login'")
            await fill('input[type=email]', 'second@example.test')
            await fill('input[type=password]', 'fixture-password')
            await ev(s, "document.querySelector('form').requestSubmit()")
            await wait(
              s,
              "location.pathname==='/app' && document.querySelector('.profile-link strong')?.textContent==='Fixture member 2'",
            )
            api.releaseRecovery()
            await sleep(500)
            assert.equal(await ev(s, "document.querySelectorAll('.room-link').length"), 0)
            assert.equal(
              await ev(s, "document.body.textContent.includes('temporarily unavailable')"),
              false,
            )
            assert.equal(
              await ev(
                s,
                "(async()=>{const {queryClient,queryKeys}=await import('/src/lib/query.ts');const rooms=queryClient.getQueryData(queryKeys.rooms);return rooms?.rooms?.length===0 && queryClient.getQueryData(queryKeys.profile)?.id===2 && !queryClient.getQueryCache().getAll().some(q=>q.state.error)})()",
              ),
              true,
            )
          }
          const result = api.snapshot()
          assert.equal(result.unexpectedRequests, 0)
          return result
        }).catch((error) => {
          console.error('Scenario failed: ' + name + ': ' + error.message)
          throw error
        })
      },
    })
    console.log(
      `Recovery acceptance: ${exit ? 'FAIL' : 'PASS'}; evidence ${join(dir, 'report.json')}`,
    )
    return exit
  } finally {
    if (!cleanupHandled) await closeRecoveryResources(app, api)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await recoveryMain()
