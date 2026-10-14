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

// Stable exclusive cursors retain coverage when the newest page moves forward.
export async function refreshRetainedMessages(
  roomId: number,
  known: Message[],
  signal: AbortSignal,
): Promise<{ pages: Message[][]; pageParams: (number | null)[] }> {
  const pages: Message[][] = []
  const pageParams: (number | null)[] = []
  if (!known.length) return { pages, pageParams }
  const oldest = Math.min(...known.map((message) => message.id))
  const newest = Math.max(...known.map((message) => message.id))
  let before = newest < Number.MAX_SAFE_INTEGER ? newest + 1 : undefined
  while (true) {
    signal.throwIfAborted()
    const batch = (await api.messages(roomId, 40, before, signal)).messages || []
    signal.throwIfAborted()
    pages.push(batch)
    pageParams.push(before ?? null)
    const cursor = Math.min(...batch.map((message) => message.id))
    if (batch.length < 40 || cursor <= oldest) return { pages, pageParams }
    if (!Number.isSafeInteger(cursor) || cursor <= 0 || (before !== undefined && cursor >= before))
      throw new Error('Message history cursor did not advance.')
    before = cursor
  }
}
