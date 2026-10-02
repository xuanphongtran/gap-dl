// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { bindSessionCache, clearRoomQueries, queryClient, queryKeys } from './query'
import { clearSession, saveSession } from './session'

afterEach(() => {
  queryClient.clear()
  sessionStorage.clear()
})

describe('room membership cache cleanup', () => {
  it('removes all room-scoped data and the room-list entry', () => {
    queryClient.setQueryData(queryKeys.rooms, {
      rooms: [
        { id: 7, name: 'Private', visibility: 'private' },
        { id: 8, name: 'Other', visibility: 'private' },
      ],
    })
    queryClient.setQueryData(queryKeys.room(7), { id: 7, name: 'Private' })
    queryClient.setQueryData(queryKeys.members(7), { members: [{ user_id: 1 }] })
    queryClient.setQueryData(queryKeys.latestMessages(7), [{ id: 99, content: 'Secret' }])
    queryClient.setQueryData(queryKeys.messageHistory(7), { pages: [[{ id: 98 }]] })
    queryClient.setQueryData(queryKeys.room(8), { id: 8, name: 'Other' })

    clearRoomQueries(7)

    expect(queryClient.getQueryData(queryKeys.room(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.members(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.messageHistory(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.room(8))).toBeDefined()
    expect(queryClient.getQueryData<{ rooms: { id: number }[] }>(queryKeys.rooms)?.rooms).toEqual([
      { id: 8, name: 'Other', visibility: 'private' },
    ])
  })

  it('keeps a public room discoverable without retaining member data', () => {
    queryClient.setQueryData(queryKeys.rooms, {
      rooms: [{ id: 7, name: 'Public', visibility: 'public', role: 'member' }],
    })
    queryClient.setQueryData(queryKeys.latestMessages(7), [{ id: 9, content: 'Private' }])

    clearRoomQueries(7)

    expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.rooms)).toEqual({
      rooms: [{ id: 7, name: 'Public', visibility: 'public', role: null }],
    })
  })
})

it('clears private cache when final authentication failure clears the session', () => {
  const unbind = bindSessionCache()
  try {
    saveSession({ access_token: 'access', refresh_token: 'refresh', expires_at: 0 })
    queryClient.setQueryData(queryKeys.latestMessages(7), [{ id: 1, content: 'Private' }])
    clearSession()
    expect(queryClient.getQueryData(queryKeys.latestMessages(7))).toBeUndefined()
  } finally {
    unbind()
  }
})
