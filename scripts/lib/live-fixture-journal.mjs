import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

// Private recovery data: keep this file outside the repo and never copy it into a report.
// Use sequential writes/cleanup with one owner per journal file.
export async function openFixtureJournal(file) {
  let state
  try {
    state = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    state = { entries: [] }
  }
  const save = async () => {
    const temporary = file + '.' + randomUUID()
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
  }
  return {
    async write(intent, send) {
      const entry = { ...intent, status: 'uncertain' }
      state.entries.push(entry)
      await save()
      const resource = await send()
      if (!resource) throw Error('Missing resource identity; reconcile the uncertain write')
      entry.resource = resource
      entry.status = 'created'
      await save()
      return resource
    },
    async cleanup({ reconcile = async () => null, remove }) {
      for (const entry of state.entries) {
        if (entry.status === 'cleaned') continue
        if (!entry.resource) {
          const result = await reconcile(entry)
          if (!result?.resource) continue
          entry.resource = result.resource
          entry.status = 'created'
          await save()
        }
        entry.status = 'cleaning'
        await save()
        // The adapter must confirm deletion or already-absent state; retry after interruption is safe.
        await remove(entry)
        entry.status = 'cleaned'
        await save()
      }
    },
    summary() {
      const confirmed = state.entries.filter((e) => e.status === 'cleaned').length
      return { confirmed, unconfirmed: state.entries.length - confirmed }
    },
  }
}
