import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('does not leak malformed credential-file contents in probe errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ws-probe-'))
  const file = join(directory, 'fixture.json')
  await writeFile(file, 'private-access-token-sentinel', { mode: 0o600 })
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./check-ws-contract.mjs', import.meta.url))],
      { env: { ...process.env, WS_FIXTURE_FILE: file } },
    ).catch((error) => error)
    expect(result).toHaveProperty('code', 1)
    expect(result.stderr).not.toContain('private-access-token-sentinel')
    expect(result.stderr).toContain('WebSocket configuration or probe failed.')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
