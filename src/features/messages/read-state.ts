import { api } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import type { ReadState } from '../../types'

export function retainReadCursor(current: ReadState | undefined, next: ReadState): ReadState {
  return current && current.last_read_message_id > next.last_read_message_id ? current : next
}

export function readStateOptions(roomId: number, userId: number) {
  const queryKey = queryKeys.readState(roomId, userId)
  return {
    queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const result = await api.readState(roomId, signal)
      return retainReadCursor(queryClient.getQueryData<ReadState>(queryKey), result)
    },
    refetchInterval: 5000,
  }
}
