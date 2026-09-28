import { QueryClient } from '@tanstack/vue-query'
import { ApiError } from './http'

export const queryKeys = {
  profile: ['profile'] as const,
  rooms: ['rooms'] as const,
  invitations: ['invitations'] as const,
  room: (id: number) => ['room', id] as const,
  members: (id: number) => ['room', id, 'members'] as const,
  latestMessages: (id: number) => ['room', id, 'latest-messages'] as const,
  messageHistory: (id: number) => ['room', id, 'message-history'] as const,
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
