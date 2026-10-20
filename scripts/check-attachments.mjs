import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startAttachmentsProxy } from './lib/attachments-proxy.mjs'
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startAttachmentsApi, attachmentProviderOrigin } from './fixtures/attachments-api.mjs'
import {
  requireLoopback,
  startAcceptanceApp,
  withAcceptanceBrowser,
} from './lib/acceptance-browser.mjs'
const scenarios = [
  'send-retry',
  'processing',
  'put-412',
  'upload-room-change',
  'account-change',
  'download-access',
  'mobile-keyboard',
]
export function guardAttachmentRequest(request, origins, fixture) {
  for (const origin of origins) requireLoopback(origin)
  let url
  try {
    url = new URL(request.url)
  } catch {
    return { action: 'fail' }
  }
  if (url.username || url.password) return { action: 'fail' }
  if (origins.includes(url.origin)) return { action: 'continue' }
  if (
    url.origin === fixture.providerOrigin &&
    fixture.providerOrigin !== attachmentProviderOrigin &&
    url.hostname === 'attachments.fixture.invalid' &&
    url.protocol === 'https:'
  )
    return { action: 'provider' }
  if (url.origin === attachmentProviderOrigin)
    return {
      action: 'fulfill',
      response: fixture.handleProvider({
        method: request.method,
        path: url.pathname,
        headers: request.headers,
        body: request.postData || '',
      }),
    }
  return { action: 'fail' }
}
export async function runAttachmentSuite({ origin, names, runScenario, close, reportFile }) {
  requireLoopback(origin)
  const report = { checks: [], cleanupComplete: false }
  let exit = 0
  try {
    for (const name of names) {
      if (!scenarios.includes(name)) throw Error('Unknown attachment scenario')
      try {
        const result = await runScenario(name),
          check = { name, simulated: true, pass: true }
        for (const key of [
          'canonicalMessageCount',
          'privacyViolationCount',
          'cancellationCount',
          'blockedExternalRequestCount',
          'escapedNavigationCount',
        ])
          if (Number.isSafeInteger(result?.[key])) check[key] = result[key]
        check.requestCounts = Object.fromEntries(
          Object.entries(result?.requestCounts || {}).filter(
            ([key, value]) =>
              /^(GET|POST|PUT|PATCH|DELETE) \/(api\/v1|provider)\/[a-z/:-]+$/.test(key) &&
              Number.isSafeInteger(value) &&
              value >= 0,
          ),
        )
        report.checks.push(check)
      } catch {
        exit = 1
        report.checks.push({ name, simulated: true, pass: false })
      }
    }
  } finally {
    try {
      await close()
      report.cleanupComplete = true
    } catch {
      exit = 1
    }
    await writeFile(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  return exit
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(test) {
  for (let i = 0; i < 200; i++) {
    if (await test()) return
    await sleep(75)
  }
  throw Error('Fixture observation timed out')
}
export async function attachmentsMain({ names = scenarios } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gogo-attachments-native-')),
    api = await startAttachmentsApi()
  let escapedNavigationCount = 0
  const forbiddenServer = createServer((_req, res) => {
    escapedNavigationCount++
    res.end('Forbidden fixture origin')
  })
  let app, proxy, cleanupPromise
  const close = () =>
    (cleanupPromise ||= Promise.allSettled([
      app?.close(),
      proxy?.close(),
      api.close(),
      new Promise((resolve, reject) => {
        forbiddenServer.closeAllConnections()
        forbiddenServer.close((e) => (e ? reject(e) : resolve()))
      }),
    ]).then((results) => {
      if (results.some((result) => result.status === 'rejected'))
        throw Error('Acceptance cleanup incomplete')
    }))
  try {
    await new Promise((resolve) => forbiddenServer.listen(0, '127.0.0.1', resolve))
    const forbiddenOrigin = 'http://127.0.0.1:' + forbiddenServer.address().port
    const provider = await api.startProvider(directory)
    app = await startAcceptanceApp(api.origin)
    proxy = await startAttachmentsProxy([app.origin, api.origin], api.providerOrigin)
    const exit = await runAttachmentSuite({
      origin: api.origin,
      names,
      reportFile: join(directory, 'report.json'),
      close,
      runScenario: async (name) => {
        api.setScenario(name)
        console.log('Checking synthetic attachment scenario: ' + name)
        const artifactDir = join(directory, name),
          filePath = join(artifactDir, 'synthetic.txt'),
          downloadPath = join(artifactDir, 'downloads')
        await mkdir(artifactDir, { mode: 0o700 })
        await mkdir(downloadPath, { mode: 0o700 })
        await writeFile(filePath, 'Harmless local attachment fixture.\n', { mode: 0o600 })
        return withAcceptanceBrowser(
          {
            artifactDir,
            chromeArgs: [
              ...provider.chromeArgs.filter((arg) => arg !== '--no-proxy-server'),
              '--proxy-server=' + proxy.origin,
              '--proxy-bypass-list=<-loopback>',
              '--disable-background-networking',
              '--disable-component-update',
              '--disable-default-apps',
              '--disable-sync',
              '--no-first-run',
            ],
          },
          async (browser) => {
            const { command, evaluate: ev, waitFor: wait } = browser
            const s = await browser.newPage()
            const initialDenials = proxy.denied
            let baselineBlocked
            const discovered = new Set()
            let blocked = 0,
              dropped = false,
              downloaded = 0
            const configured = new Set()
            const configure = async (session) => {
              if (configured.has(session)) return
              configured.add(session)
              await command('Page.enable', {}, session)
              await command('Runtime.enable', {}, session)
              await command('Network.enable', { maxPostDataSize: 10485760 }, session)
              await command(
                'Fetch.enable',
                {
                  patterns: [
                    { urlPattern: '*', requestStage: 'Request' },
                    ...(name === 'send-retry'
                      ? [
                          {
                            urlPattern: api.origin + '/api/v1/rooms/7/messages',
                            requestStage: 'Response',
                          },
                        ]
                      : []),
                  ],
                },
                session,
              )
              await command('Network.setBlockedURLs', { urls: [] }, session)
              await command(
                'Target.setAutoAttach',
                { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
                session,
              )
            }
            const remove = browser.onEvent(async (m) => {
              if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page')
                discovered.add(m.params.targetInfo.targetId)
              if (m.method === 'Target.attachedToTarget') {
                await configure(m.params.sessionId)
                await command('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId)
                return
              }
              if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') {
                downloaded++
                return
              }
              if (m.method !== 'Fetch.requestPaused') return
              const session = m.sessionId,
                p = m.params
              if (p.responseStatusCode) {
                if (
                  name === 'send-retry' &&
                  !dropped &&
                  p.request.method === 'POST' &&
                  p.responseStatusCode === 201
                ) {
                  dropped = true
                  await command(
                    'Fetch.failRequest',
                    { requestId: p.requestId, errorReason: 'ConnectionClosed' },
                    session,
                  )
                } else await command('Fetch.continueResponse', { requestId: p.requestId }, session)
                return
              }
              const result = guardAttachmentRequest(p.request, [app.origin, api.origin], api)
              if (result.action === 'continue' || result.action === 'provider')
                await command('Fetch.continueRequest', { requestId: p.requestId }, session)
              else if (result.action === 'fulfill') {
                const r = result.response
                await command(
                  'Fetch.fulfillRequest',
                  {
                    requestId: p.requestId,
                    responseCode: r.status,
                    responseHeaders: Object.entries(r.headers).map(([name, value]) => ({
                      name,
                      value,
                    })),
                    body: Buffer.from(r.body || '').toString('base64'),
                  },
                  session,
                )
              } else {
                blocked++
                await command(
                  'Fetch.failRequest',
                  { requestId: p.requestId, errorReason: 'BlockedByClient' },
                  session,
                )
              }
            })
            await configure(s)
            await command('Target.setDiscoverTargets', { discover: true })
            const info = await command('Target.getTargetInfo', {}, s)
            await command('Browser.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath,
              browserContextId: info.targetInfo.browserContextId,
              eventsEnabled: true,
            })
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
            // Prove exact HTTPS synthetic fulfillment before exercising product code.
            assert.equal(
              await ev(
                s,
                `fetch('${api.providerOrigin}/uploads/0',{method:'OPTIONS'}).then(r=>r.status)`,
              ),
              204,
            )
            assert.equal(
              await ev(s, `fetch('${forbiddenOrigin}/fetch').then(()=>false,()=>true)`),
              true,
            )
            const previousTargets = new Set(discovered)
            await command(
              'Runtime.evaluate',
              {
                expression: `(()=>{const a=document.createElement('a');a.href='${forbiddenOrigin}/download';a.target='_blank';a.rel='noreferrer noopener';a.referrerPolicy='no-referrer';document.body.append(a);a.click();a.remove()})()`,
                userGesture: true,
              },
              s,
            )
            await until(() => [...discovered].some((id) => !previousTargets.has(id)))
            assert.equal(escapedNavigationCount, 0, 'New download target escaped interception')
            await sleep(250)
            assert.equal(escapedNavigationCount, 0)
            assert.ok(proxy.denied > initialDenials || blocked >= 2)
            for (const targetId of discovered)
              if (!previousTargets.has(targetId)) await command('Target.closeTarget', { targetId })
            baselineBlocked = blocked
            await command('Page.bringToFront', {}, s)
            await fill('input[type=email]', 'member@example.test')
            await fill('input[type=password]', 'fixture-password')
            await ev(s, "document.querySelector('form').requestSubmit()")
            await wait(s, "location.pathname==='/app'")
            await navigate('/app/rooms/7')
            await wait(
              s,
              "!!document.querySelector('input[type=file]') && !document.querySelector('#message-input').disabled",
            )
            if (name === 'mobile-keyboard')
              await command(
                'Emulation.setDeviceMetricsOverride',
                { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
                s,
              )
            const doc = await command('DOM.getDocument', {}, s),
              input = await command(
                'DOM.querySelector',
                { nodeId: doc.root.nodeId, selector: 'input[type=file]' },
                s,
              )
            await command('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filePath] }, s)
            await fill('#message-input', 'caption with file')
            if (['upload-room-change', 'account-change'].includes(name)) {
              await until(
                () =>
                  api.snapshot().requestCounts['POST /api/v1/rooms/:id/attachments/uploads'] === 1,
              )
              if (name === 'upload-room-change') {
                await ev(s, 'document.querySelector(\'a[href="/app/rooms/8"]\').click()')
                await wait(s, "location.pathname==='/app/rooms/8'")
              } else {
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
              }
              api.releaseReservations()
              await sleep(350)
              assert.equal(
                await ev(s, "document.body.textContent.includes('synthetic.txt')"),
                false,
              )
              assert.equal(api.snapshot().canonicalMessageCount, 0)
            } else {
              if (name === 'processing') {
                await wait(
                  s,
                  "document.querySelector('.attachment-item')?.textContent.includes('Processing')",
                )
                assert.equal(await ev(s, "document.querySelector('.send-button').disabled"), true)
                await ev(
                  s,
                  "document.querySelector('#message-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))",
                )
                assert.equal(api.snapshot().canonicalMessageCount, 0)
                api.releaseProcessing()
              }
              if (name === 'put-412') {
                await wait(s, "document.body.textContent.includes('Upload outcome is uncertain')")
                assert.equal(api.snapshot().requestCounts['PUT /provider/uploads/:id'], 1)
                await wait(
                  s,
                  `(()=>{const b=document.querySelector('button[aria-label="Retry synthetic.txt"]');if(!b||b.disabled)return false;b.click();return true})()`,
                )
              }
              try {
                await wait(
                  s,
                  "document.querySelector('.attachment-item')?.textContent.includes('Ready')",
                )
              } catch (error) {
                console.error(
                  'Safe processing diagnostic: ' +
                    JSON.stringify(
                      await ev(
                        s,
                        "(async()=>{const {queryClient}=await import('/src/lib/query.ts');return queryClient.getQueryCache().getAll().filter(q=>q.queryKey[2]==='attachments').map(q=>({phase:q.state.data?.state,verified:q.state.data?.verified,errorStatus:q.state.error?.status,fetch:q.state.fetchStatus}))})()",
                      ),
                    ),
                )
                console.error('Fixture counts: ' + JSON.stringify(api.snapshot()))
                throw error
              }
              if (name === 'send-retry')
                await ev(
                  s,
                  "(()=>{const e=document.querySelector('.mention-picker select');e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}))})()",
                )
              if (name === 'mobile-keyboard') {
                await wait(
                  s,
                  `(()=>{const b=document.querySelector('button[aria-label="Search room messages"]');if(!b||b.disabled)return false;b.click();return true})()`,
                )
                await click('CLOSE SEARCH')
                await wait(
                  s,
                  `document.activeElement?.getAttribute('aria-label')==='Search room messages'`,
                )
                assert.equal(
                  await ev(s, "document.body.textContent.includes('synthetic.txt')"),
                  true,
                )
                assert.equal(await ev(s, 'document.documentElement.scrollWidth<=innerWidth'), true)
              }
              await ev(s, "document.querySelector('#message-input').focus()")
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
              if (name === 'send-retry') {
                await wait(s, "document.body.textContent.includes('DISCARD PENDING SEND')")
                assert.equal(dropped, true)
                await sleep(350)
                assert.equal(api.snapshot().requestCounts['POST /api/v1/rooms/:id/messages'], 1)
                await ev(s, `document.querySelector('a[href="/app/rooms/8"]').click()`)
                await wait(s, "location.pathname==='/app/rooms/8'")
                await ev(s, `document.querySelector('a[href="/app/rooms/7"]').click()`)
                await wait(
                  s,
                  "location.pathname==='/app/rooms/7' && document.body.textContent.includes('DISCARD PENDING SEND')",
                )
                assert.equal(api.snapshot().cancellationCount, 0)
                await wait(
                  s,
                  "(()=>{const a=[...document.querySelectorAll('.alert')].find(a=>a.textContent.includes('DISCARD PENDING SEND'));const b=a?.querySelector('button');if(!b||b.disabled)return false;b.click();return true})()",
                )
              }
              await wait(
                s,
                "document.querySelector('#message-input').value==='' && !!document.querySelector('[aria-label=\"Download synthetic.txt\"]')",
              )
              assert.equal(api.snapshot().canonicalMessageCount, 1)
              if (name === 'send-retry')
                assert.equal(api.snapshot().requestCounts['POST /api/v1/rooms/:id/messages'], 2)
              await wait(
                s,
                `(()=>{const b=document.querySelector('button[aria-label="Search room messages"]');if(!b||b.disabled)return false;b.click();return true})()`,
              )
              await fill('.room-search input', 'caption')
              await ev(s, "document.querySelector('.search-form').requestSubmit()")
              await wait(
                s,
                '!!document.querySelector(\'.search-results [aria-label="Download synthetic.txt"]\')',
              )
              await click('CLOSE SEARCH')
              if (name === 'download-access' || name === 'mobile-keyboard') {
                await wait(
                  s,
                  '(()=>{const b=document.querySelector(\'[aria-label="Download synthetic.txt"]\');if(!b||b.disabled)return false;b.click();return true})()',
                )
                await until(() => downloaded === 1)
                const stored = (await readdir(downloadPath)).filter(
                  (n) => !n.endsWith('.crdownload'),
                )
                assert.equal(stored.length, 1)
                assert.equal(
                  await readFile(join(downloadPath, stored[0]), 'utf8'),
                  'Harmless local attachment fixture.\n',
                )
              }
              if (name === 'download-access') {
                await fill('#message-input', 'preserved caption')
                api.denyBinding()
                await wait(
                  s,
                  '(()=>{const b=document.querySelector(\'[aria-label="Download synthetic.txt"]\');if(!b||b.disabled)return false;b.click();return true})()',
                )
                try {
                  await wait(s, "document.body.textContent.includes('File unavailable')")
                } catch (error) {
                  console.log('Download diagnostic: ' + JSON.stringify(api.snapshot()))
                  console.log(
                    await ev(
                      s,
                      `({visibility:document.visibilityState,rows:[...document.querySelectorAll('.attachment-item')].map(x=>x.innerText)})`,
                    ),
                  )
                  throw error
                }
                assert.equal(
                  await ev(
                    s,
                    "location.pathname==='/app/rooms/7' && document.querySelector('#message-input').value==='preserved caption'",
                  ),
                  true,
                )
                api.revoke()
                await wait(s, "location.pathname==='/app'", 20000)
                assert.equal(
                  await ev(s, "document.body.textContent.includes('synthetic.txt')"),
                  false,
                )
              }
              await command('Page.captureScreenshot', { format: 'png' }, s).then((r) =>
                writeFile(join(artifactDir, 'screen.png'), Buffer.from(r.data, 'base64'), {
                  mode: 0o600,
                }),
              )
            }
            if (!['upload-room-change', 'account-change'].includes(name)) {
              assert.equal(
                api.snapshot().requestCounts['POST /api/v1/rooms/:id/attachments/uploads'],
                1,
              )
              assert.equal(api.snapshot().requestCounts['PUT /provider/uploads/:id'], 1)
            }
            assert.equal(api.snapshot().privacyViolationCount, 0)
            assert.equal(api.snapshot().unexpectedRequests, 0)
            assert.equal(blocked, baselineBlocked)
            assert.equal(escapedNavigationCount, 0)
            remove()
            return {
              ...api.snapshot(),
              blockedExternalRequestCount: proxy.denied - initialDenials + blocked,
              escapedNavigationCount,
            }
          },
        ).catch((error) => {
          console.error('Attachment scenario failed: ' + name + ': ' + error.message)
          throw error
        })
      },
    })
    console.log(
      `Attachments acceptance: ${exit ? 'FAIL' : 'PASS'}; evidence ${join(directory, 'report.json')}`,
    )
    return exit
  } finally {
    await close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await attachmentsMain()
