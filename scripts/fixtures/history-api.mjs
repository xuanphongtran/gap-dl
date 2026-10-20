import { startRecoveryApi } from './recovery-api.mjs'
export async function startHistoryApi({ messageCount }) {
  if (![40, 1000].includes(messageCount)) throw Error('Unsupported history fixture size')
  const fixture = await startRecoveryApi({ messageCount })
  return { origin: fixture.origin, snapshot: fixture.snapshot, close: fixture.close }
}
