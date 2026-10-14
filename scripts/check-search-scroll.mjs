import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { cp, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const repository = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'gogo-search-scroll-'))
await cp(join(repository, 'src'), join(directory, 'src'), { recursive: true })
await cp(join(repository, 'package.json'), join(directory, 'package.json'))
await cp(join(repository, 'scripts/fixtures/search-scroll.html'), join(directory, 'index.html'))
await symlink(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir')
const server = await createServer({
  root: directory,
  cacheDir: join(directory, 'vite-cache'),
  configFile: join(repository, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, repository] } },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = spawn(
    process.env.CHROME_PATH || '/usr/bin/google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + join(directory, 'chrome'),
      '--dump-dom',
      '--virtual-time-budget=10000',
      `http://127.0.0.1:${address.port}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  let html = ''
  browser.stdout.on('data', (chunk) => {
    html += chunk
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.kill('SIGTERM')
      reject(new Error('Chrome scroll probe timed out.'))
    }, 45000)
    browser.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    browser.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error('Chrome scroll probe exited unsuccessfully.'))
    })
  })
  await writeFile(join(directory, 'browser-output.html'), html)
  const matched = html.match(/<pre id="report">([^<]+)<\/pre>/)
  assert.ok(matched, 'Browser did not produce scroll evidence.')
  const report = JSON.parse(matched[1])
  assert.equal(report.before, 1000)
  assert.equal(report.duringRows, 0, 'Private result rows must be hidden during refetch.')
  assert.equal(report.afterRows, 20)
  assert.equal(report.after, 1000, 'Same-query refetch must restore the reading position.')
  assert.equal(report.newQueryTop, 0, 'A different query must reset its reading position.')
  assert.ok(report.callsBeforeNewQuery >= 2)
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log('PASS: Search preserves scroll across refetch and resets it for a new query.')
  console.log('Evidence: ' + join(directory, 'report.json'))
} finally {
  browser?.kill('SIGTERM')
  await server.close()
}
