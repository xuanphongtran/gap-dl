import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openFixtureJournal } from './lib/live-fixture-journal.mjs'
const directories = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function journalFile() {
  const directory = await mkdtemp(join(tmpdir(), 'fixture-journal-'))
  directories.push(directory)
  return join(directory, 'private.json')
}
it('persists ambiguous message and registration writes before transmission and reconciles without a returned token', async () => {
  const file = await journalFile()
  const journal = await openFixtureJournal(file)
  const accepted = new Map()
  for (const kind of ['message', 'account']) {
    await expect(
      journal.write({ kind, recovery: { marker: kind, password: 'private-secret' } }, async () => {
        const disk = JSON.parse(await readFile(file, 'utf8'))
        expect(disk.entries.at(-1).status).toBe('uncertain')
        accepted.set(kind, { id: accepted.size + 1 })
        throw Error('Response lost after acceptance')
      }),
    ).rejects.toThrow('Response lost')
  }
  const resumed = await openFixtureJournal(file)
  expect(resumed.summary()).toEqual({ confirmed: 0, unconfirmed: 2 })
  const deleted = []
  await resumed.cleanup({
    reconcile: async ({ recovery }) => ({ resource: accepted.get(recovery.marker) }),
    remove: async ({ resource }) => {
      deleted.push(resource.id)
    },
  })
  expect(deleted).toEqual([1, 2])
  expect(resumed.summary()).toEqual({ confirmed: 2, unconfirmed: 0 })
  expect(JSON.stringify(resumed.summary())).not.toContain('private-secret')
})
it('saves each cleanup result and resumes interrupted deletion without losing uncertainty', async () => {
  const file = await journalFile()
  const journal = await openFixtureJournal(file)
  for (const id of [1, 2])
    await journal.write({ kind: 'message', recovery: { marker: id } }, async () => ({ id }))
  await expect(
    journal.cleanup({
      remove: async ({ resource }) => {
        if (resource.id === 2) throw Error('Interrupted')
      },
    }),
  ).rejects.toThrow('Interrupted')
  const resumed = await openFixtureJournal(file)
  expect(resumed.summary()).toEqual({ confirmed: 1, unconfirmed: 1 })
  const disk = JSON.parse(await readFile(file, 'utf8'))
  expect(disk.entries.map((e) => e.status)).toEqual(['cleaned', 'cleaning'])
  const deleted = []
  await resumed.cleanup({
    remove: async ({ resource }) => {
      deleted.push(resource.id)
    },
  })
  expect(deleted).toEqual([2])
  expect(resumed.summary()).toEqual({ confirmed: 2, unconfirmed: 0 })
})
it('keeps unresolved writes unconfirmed instead of assuming that a lost response means no resource', async () => {
  const file = await journalFile()
  const journal = await openFixtureJournal(file)
  await expect(
    journal.write({ kind: 'account', recovery: { email: 'synthetic@example.test' } }, async () => {
      throw Error('Lost')
    }),
  ).rejects.toThrow()
  await journal.cleanup({
    reconcile: async () => null,
    remove: async () => {
      throw Error('Must not run')
    },
  })
  expect(journal.summary()).toEqual({ confirmed: 0, unconfirmed: 1 })
})
