import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startHistoryApi } from './fixtures/history-api.mjs'
import { startAcceptanceApp, withAcceptanceBrowser } from './lib/acceptance-browser.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function countsOnly(counts = {}) {
  return Object.fromEntries(
    Object.entries(counts).filter(
      ([key, value]) =>
        /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/[a-z/:-]+$/.test(key) &&
        Number.isSafeInteger(value) &&
        value >= 0,
    ),
  )
}
export function historyMetrics(input) {
  if (
    input.renderedIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    input.renderedIds.length !== input.messageCount ||
    new Set(input.renderedIds).size !== input.messageCount
  )
    throw Error('Missing or duplicate rendered rows')
  const postSwitchIds = input.postSwitchRenderedIds
  if (
    postSwitchIds &&
    (postSwitchIds.length !== input.messageCount ||
      new Set(postSwitchIds).size !== input.messageCount ||
      postSwitchIds.some((id) => !input.renderedIds.includes(id)))
  )
    throw Error('Missing or changed post-switch rendered rows')
  const heap = input.heapSample?.usedSize
  const laterHeap = (sample) =>
    Number.isFinite(sample?.usedSize) && sample.usedSize > 0 ? sample.usedSize : null
  const heapAfterIdle = laterHeap(input.heapAfterIdle)
  const heapAfterSwitch = laterHeap(input.heapAfterSwitch)
  return {
    messageCount: input.messageCount,
    renderedRows: input.renderedIds.length,
    loadMs: Math.round(input.loadMs),
    requestCounts: countsOnly(input.requestCounts),
    idleRequestCounts: countsOnly(input.idleRequestCounts),
    hiddenRequestCounts: countsOnly(input.hiddenRequestCounts),
    visibilityMode: 'simulated',
    heapBytes: Number.isFinite(heap) && heap > 0 ? heap : null,
    heapUnavailableReason:
      Number.isFinite(heap) && heap > 0 ? null : 'Chrome heap sampling unavailable',
    heapAfterIdleBytes: heapAfterIdle,
    heapAfterIdleUnavailableReason:
      heapAfterIdle === null ? 'Chrome idle heap sampling unavailable' : null,
    heapAfterSwitchBytes: heapAfterSwitch,
    heapAfterSwitchUnavailableReason:
      heapAfterSwitch === null ? 'Chrome post-switch heap sampling unavailable' : null,
    postSwitchRenderedRows: postSwitchIds?.length ?? input.postSwitchRenderedRows ?? null,
  }
}
const difference = (before, after) =>
  Object.fromEntries(
    Object.entries(after)
      .map(([key, value]) => [key, value - (before[key] || 0)])
      .filter(([, value]) => value > 0),
  )
export async function historyMain({ sizes = [40, 1000], runs = 3 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gogo-history-'))
  const report = { runs: [] }
  try {
    for (const messageCount of sizes)
      for (let run = 1; run <= runs; run++) {
        console.log(`History baseline: ${messageCount} rows, run ${run}/${runs}`)
        const fixture = await startHistoryApi({ messageCount })
        let app
        try {
          app = await startAcceptanceApp(fixture.origin)
          const metrics = await withAcceptanceBrowser(
            { artifactDir: join(directory, `${messageCount}-${run}`) },
            async (browser) => {
              const { command, evaluate: ev, waitFor: wait } = browser,
                s = await browser.newPage()
              const navigate = async (path) => {
                await command('Page.navigate', { url: app.origin + path }, s)
                await wait(
                  s,
                  `location.pathname===${JSON.stringify(path)} && document.readyState==='complete'`,
                )
              }
              const idle = () =>
                wait(
                  s,
                  "(async()=>{const {queryClient}=await import('/src/lib/query.ts');return queryClient.isFetching()===0})()",
                  25000,
                )
              const heap = () => command('Runtime.getHeapUsage', {}, s).catch(() => null)
              await navigate('/login')
              await wait(s, "!!document.querySelector('input[type=email]')")
              await ev(
                s,
                "(()=>{const e=document.querySelector('input[type=email]'),p=document.querySelector('input[type=password]');e.value='member@example.test';e.dispatchEvent(new Event('input',{bubbles:true}));p.value='fixture-password';p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit()})()",
              )
              await wait(s, "location.pathname==='/app'")
              const start = performance.now()
              await navigate('/app/rooms/7')
              await wait(s, "document.querySelectorAll('[data-message-id]').length===40")
              while (
                (await ev(s, "document.querySelectorAll('[data-message-id]').length")) <
                messageCount
              ) {
                const old = await ev(s, "document.querySelectorAll('[data-message-id]').length")
                await wait(
                  s,
                  "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('LOAD OLDER MESSAGES'));if(!b||b.disabled)return false;b.click();return true})()",
                )
                await wait(s, `document.querySelectorAll('[data-message-id]').length>${old}`)
              }
              const loadMs = performance.now() - start
              const renderedIds = await ev(
                s,
                "[...document.querySelectorAll('[data-message-id]')].map(e=>Number(e.dataset.messageId))",
              )
              await idle()
              const heapSample = await heap()
              const beforeIdle = fixture.snapshot().requestCounts
              await sleep(15000)
              await idle()
              const afterIdle = fixture.snapshot().requestCounts
              const heapAfterIdle = await heap()
              await ev(
                s,
                "Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange',{bubbles:true}))",
              )
              await sleep(300)
              const beforeHidden = fixture.snapshot().requestCounts
              await sleep(15000)
              const afterHidden = fixture.snapshot().requestCounts
              await ev(
                s,
                "Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange',{bubbles:true}))",
              )
              await idle()
              for (let i = 0; i < 10; i++) {
                const target = i % 2 ? 7 : 8
                await wait(
                  s,
                  `(()=>{const a=document.querySelector('a[href="/app/rooms/${target}"]');if(!a)return false;a.click();return true})()`,
                )
                try {
                  await wait(
                    s,
                    `location.pathname==='/app/rooms/${target}' && !!document.querySelector('#message-input') && !document.querySelector('#message-input').disabled`,
                  )
                } catch (error) {
                  console.error(
                    'Switch diagnostic: ' +
                      JSON.stringify(
                        await ev(
                          s,
                          "(async()=>{const {queryClient}=await import('/src/lib/query.ts');return {status:document.querySelector('.realtime-status')?.textContent,state:document.querySelector('.message-state')?.textContent,queries:queryClient.getQueryCache().getAll().map(q=>({kind:q.queryKey[2]||q.queryKey[0],state:q.state.status,fetch:q.state.fetchStatus,pages:q.state.data?.pages?.length||0}))}})()",
                        ),
                      ),
                  )
                  console.error('Fixture counts: ' + JSON.stringify(fixture.snapshot()))
                  throw error
                }
                await idle()
              }
              const postSwitchRenderedIds = await ev(
                s,
                "[...document.querySelectorAll('[data-message-id]')].map(e=>Number(e.dataset.messageId))",
              )
              const postSwitchRenderedRows = postSwitchRenderedIds.length
              assert.equal(postSwitchRenderedRows, messageCount)
              const heapAfterSwitch = await heap(),
                snapshot = fixture.snapshot()
              assert.equal(snapshot.unexpectedRequests, 0)
              return historyMetrics({
                messageCount,
                renderedIds,
                loadMs,
                requestCounts: snapshot.requestCounts,
                idleRequestCounts: difference(beforeIdle, afterIdle),
                hiddenRequestCounts: difference(beforeHidden, afterHidden),
                heapSample,
                heapAfterIdle,
                heapAfterSwitch,
                postSwitchRenderedRows,
                postSwitchRenderedIds,
              })
            },
          )
          report.runs.push({ run, ...metrics })
          await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), {
            mode: 0o600,
          })
        } finally {
          await app?.close()
          await fixture.close()
        }
      }
    console.log(
      `PASS: ${report.runs.length} history baseline runs; evidence ` +
        join(directory, 'report.json'),
    )
    return 0
  } catch (error) {
    report.failed = true
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    })
    console.error('History baseline failed: ' + error.message)
    console.log('Evidence: ' + join(directory, 'report.json'))
    return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await historyMain()
