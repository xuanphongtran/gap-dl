import type { Message } from '../types'

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<number, Message>()
  for (const message of current) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
