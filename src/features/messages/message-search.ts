import { messageContentBytes, mergeMessages } from '../../lib/messages'
import type { Message, SearchMessagesResponse } from '../../types'

export function normalizeSearchQuery(input: string): { query: string; error: string } {
  const query = input.trim()
  return {
    query,
    error: !query
      ? 'Enter text to search.'
      : messageContentBytes(query) > 256
        ? 'Search text must be 256 UTF-8 bytes or fewer.'
        : '',
  }
}

export function validateSearchPage(
  page: SearchMessagesResponse,
  roomId: number,
  before?: number,
): void {
  const invalid = () => {
    throw new Error('Search returned an invalid page.')
  }
  if (!page || !Array.isArray(page.messages)) invalid()
  for (const message of page.messages) {
    if (
      !Number.isSafeInteger(message.id) ||
      message.id <= 0 ||
      message.room_id !== roomId ||
      (before !== undefined && message.id >= before)
    )
      invalid()
  }
  const cursor = page.next_before
  if (
    cursor !== null &&
    (!Number.isSafeInteger(cursor) ||
      cursor <= 0 ||
      !page.messages.length ||
      (before !== undefined && cursor >= before) ||
      cursor > Math.min(...page.messages.map((m) => m.id)))
  )
    invalid()
}

export function mergeSearchResults(pages: SearchMessagesResponse[], known: Message[]): Message[] {
  const canonical = new Map(known.map((message) => [message.id, message]))
  return mergeMessages(
    [],
    pages.flatMap((page) => page.messages),
  )
    .filter((message) => {
      const current = canonical.get(message.id)
      return (
        !message.deleted_at &&
        !current?.deleted_at &&
        (!current || current.revision <= message.revision)
      )
    })
    .reverse()
}
