import type { Notification, NotificationFeed } from '../../types'

const positive = (id: number) => Number.isSafeInteger(id) && id > 0
const timestamp = (value: string) => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function validateNotificationPage(page: NotificationFeed, before?: number): void {
  if (!page || !Array.isArray(page.notifications) || (before !== undefined && !positive(before)))
    throw new Error('Invalid notification page.')
  for (const row of page.notifications) {
    if (
      !row ||
      !positive(row.id) ||
      !positive(row.room_id) ||
      !positive(row.message_id) ||
      typeof row.kind !== 'string' ||
      !timestamp(row.created_at) ||
      (row.read_at !== null && !timestamp(row.read_at)) ||
      !['available', 'deleted'].includes(row.availability) ||
      (before !== undefined && row.id >= before)
    )
      throw new Error('Invalid notification page.')
  }
  if (
    page.next_before !== null &&
    (!positive(page.next_before) ||
      !page.notifications.length ||
      (before !== undefined && page.next_before >= before) ||
      page.next_before > Math.min(...page.notifications.map((n) => n.id)))
  )
    throw new Error('Invalid notification cursor.')
}

export function mergeNotifications(
  pages: NotificationFeed[],
  acknowledged: Notification[],
): Notification[] {
  const rows = new Map<number, Notification>()
  for (const row of [...pages.flatMap((page) => page.notifications), ...acknowledged]) {
    const old = rows.get(row.id)
    rows.set(row.id, {
      ...row,
      read_at: old?.read_at ?? row.read_at,
      availability: old?.availability === 'deleted' ? 'deleted' : row.availability,
    })
  }
  const present = new Set(pages.flatMap((page) => page.notifications.map((row) => row.id)))
  return [...rows.values()].filter((row) => present.has(row.id)).sort((a, b) => b.id - a.id)
}
