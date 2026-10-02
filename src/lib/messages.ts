import type { Message } from '../types'

export const MAX_MESSAGE_BYTES = 4000

export function messageContentBytes(content: string): number {
  return new TextEncoder().encode(content.trim()).length
}

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<number, Message>()
  for (const message of current)
    byId.set(message.id, message.deleted_at ? { ...message, content: '' } : message)
  for (const message of incoming) {
    const previous = byId.get(message.id)
    if (previous?.deleted_at && !message.deleted_at) continue
    if (
      !previous ||
      message.revision > previous.revision ||
      (message.revision === previous.revision &&
        (!previous.deleted_at || !!message.deleted_at) &&
        (previous.user_id !== null || message.user_id === null))
    )
      byId.set(message.id, {
        ...message,
        user_id: previous?.user_id === null ? null : message.user_id,
        content: message.deleted_at ? '' : message.content,
      })
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
