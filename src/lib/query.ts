import { QueryClient } from '@tanstack/vue-query'
import { ApiError } from './http'
import { readSession } from './session'
import type { Room } from '../types'

export const queryKeys = {
  notifications: (userId: number) => ['notifications', userId] as const,
  notificationFeed: (userId: number, unreadOnly: boolean) =>
    ['notifications', userId, unreadOnly] as const,
  notificationPreferences: (userId: number) => ['notification-preferences', userId] as const,
  roomNotificationPreferences: (id: number, userId: number) =>
    ['room', id, 'notification-preferences', userId] as const,
  profile: ['profile'] as const,
  rooms: ['rooms'] as const,
  invitations: ['invitations'] as const,
  room: (id: number) => ['room', id] as const,
  members: (id: number) => ['room', id, 'members'] as const,
  latestMessages: (id: number) => ['room', id, 'latest-messages'] as const,
  messageSearch: (id: number) => ['room', id, 'message-search'] as const,
  searchMessages: (id: number, userId: number, query: string) =>
    ['room', id, 'message-search', userId, query] as const,
  messageHistory: (id: number) => ['room', id, 'message-history'] as const,
  readState: (id: number, userId: number) => ['room', id, 'read-state', userId] as const,
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [401, 403, 404, 409, 429].includes(error.status))
          return false
        return failureCount < 1
      },
    },
  },
})

export function clearRoomQueries(id: number): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('room:access-lost', { detail: { roomId: id } }))
  void queryClient.cancelQueries({ queryKey: ['notifications'] })
  queryClient.removeQueries({ queryKey: ['notifications'] })
  queryClient.removeQueries({ queryKey: queryKeys.room(id) })
  queryClient.setQueryData<{ rooms: Room[] }>(queryKeys.rooms, (current) =>
    current
      ? {
          rooms: current.rooms
            .filter((room) => room.id !== id || room.visibility === 'public')
            .map((room) =>
              room.id === id && room.visibility === 'public' ? { ...room, role: null } : room,
            ),
        }
      : undefined,
  )
  void queryClient.invalidateQueries({ queryKey: queryKeys.rooms })
}

export function bindSessionCache(): () => void {
  const onSessionChange = () => {
    if (!readSession()) queryClient.clear()
  }
  window.addEventListener('session:changed', onSessionChange)
  return () => window.removeEventListener('session:changed', onSessionChange)
}
