import { QueryClient } from '@tanstack/vue-query'
import { ApiError } from './http'
import { readSession } from './session'
import type { Room } from '../types'

export const queryKeys = {
  profile: ['profile'] as const,
  rooms: ['rooms'] as const,
  invitations: ['invitations'] as const,
  room: (id: number) => ['room', id] as const,
  members: (id: number) => ['room', id, 'members'] as const,
  latestMessages: (id: number) => ['room', id, 'latest-messages'] as const,
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
