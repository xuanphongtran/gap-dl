import { api } from '../../lib/api'
import { mergeMessages } from '../../lib/messages'
import type { Message } from '../../types'

export async function recoverMessageGap(
  roomId: number,
  known: Message[],
  signal: AbortSignal,
): Promise<{ messages: Message[]; gap: boolean }> {
  const knownIds = new Set(known.map((message) => message.id))
  let messages = known
  let before: number | undefined
  for (let page = 0; page <= 10; page++) {
    signal.throwIfAborted()
    const batch = (await api.messages(roomId, 40, before, signal)).messages || []
    signal.throwIfAborted()
    messages = mergeMessages(messages, batch)
    if (!known.length || batch.some((message) => knownIds.has(message.id)) || batch.length < 40)
      return { messages, gap: false }
    const cursor = Math.min(...batch.map((message) => message.id))
    if (!Number.isSafeInteger(cursor) || cursor <= 0 || (before !== undefined && cursor >= before))
      return { messages, gap: true }
    before = cursor
  }
  return { messages, gap: true }
}
