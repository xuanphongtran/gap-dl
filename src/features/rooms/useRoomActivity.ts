import { onScopeDispose, readonly, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import { api, ApiError } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import {
  parseRoomPresence,
  type RoomActivityEvent,
  type RoomTypingCommand,
} from '../../lib/realtime'
import type { RoomActivityScope, RoomActivityState } from './realtime-context'

const START_INTERVAL = 2000
const IDLE = 1500
const TTL = 5000

export function useRoomActivity(options: {
  isCurrent: (scope: RoomActivityScope) => boolean
  send: (scope: RoomActivityScope, command: RoomTypingCommand) => boolean
}) {
  const state = shallowRef<RoomActivityState>({
    roomId: null,
    phase: 'unknown',
    onlineUserIds: [],
    typingUserIds: [],
  })
  let scope: RoomActivityScope | undefined
  let generation = 0
  let version = 0
  let confirmed = false
  let online = new Set<number>()
  const deadlines = new Map<number, number>()
  let expiry: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let refreshStart: ReturnType<typeof setTimeout> | undefined
  let typing = false
  let lastInput = -Infinity
  let lastStart = -Infinity
  let transportKey = ''
  let nextRead = 0
  let blockedUntil = 0
  let pending: Promise<void> | undefined
  let controller: AbortController | undefined
  const current = (s = scope) => !!s && s === scope && options.isCurrent(s)
  const visible = () => document.visibilityState !== 'hidden'
  function publish(phase: RoomActivityState['phase'] = state.value.phase) {
    clearTimeout(expiry)
    const now = Date.now()
    for (const [id, until] of deadlines) if (until <= now || !online.has(id)) deadlines.delete(id)
    state.value = {
      roomId: scope?.roomId ?? null,
      phase,
      onlineUserIds: [...online].sort((a, b) => a - b),
      typingUserIds: [...deadlines.keys()].sort((a, b) => a - b),
    }
    if (deadlines.size)
      expiry = setTimeout(
        () => {
          if (current()) {
            version++
            publish()
          }
        },
        Math.max(1, Math.min(...deadlines.values()) - now),
      )
  }
  function command(type: RoomTypingCommand['type']) {
    return (
      !!scope &&
      current() &&
      (type === 'typing_stopped' || visible()) &&
      options.send(scope, { type, room_id: String(scope.roomId) })
    )
  }
  function stop() {
    clearTimeout(idle)
    clearTimeout(refreshStart)
    idle = undefined
    refreshStart = undefined
    lastInput = -Infinity
    if (typing) command('typing_stopped')
    typing = false
  }
  function pause() {
    stop()
    generation++
    version++
    confirmed = false
    controller?.abort()
    controller = undefined
    pending = undefined
    clearTimeout(expiry)
    online.clear()
    deadlines.clear()
    scope = undefined
    publish('unknown')
  }
  function activate(s: RoomActivityScope) {
    pause()
    const key = `${s.userId}:${s.connectionEpoch}`
    if (key !== transportKey) {
      lastStart = -Infinity
      nextRead = 0
      blockedUntil = 0
      transportKey = key
    }
    scope = s
    publish('unknown')
  }
  function receive(s: RoomActivityScope, event: RoomActivityEvent) {
    if (!current(s) || event.roomId !== s.roomId || !visible()) return
    version++
    if (event.type === 'presence_snapshot') {
      const snapshot = parseRoomPresence(event.payload, s.roomId)
      if (!snapshot) {
        invalidate(s)
        return
      }
      confirmed = true
      online = new Set(snapshot.online_user_ids)
      deadlines.clear()
      for (const id of snapshot.typing_user_ids) deadlines.set(id, Date.now() + TTL)
      publish('ready')
      return
    }
    if (!confirmed) return
    if (event.type === 'presence') {
      if (event.payload.online) online.add(event.payload.user_id)
      else {
        online.delete(event.payload.user_id)
        deadlines.delete(event.payload.user_id)
      }
    } else if (event.type === 'typing_stopped') deadlines.delete(event.payload.user_id)
    else if (online.has(event.payload.user_id))
      deadlines.set(
        event.payload.user_id,
        Math.min(Date.now() + TTL, Date.parse(event.payload.expires_at!)),
      )
    publish()
  }
  function start() {
    refreshStart = undefined
    if (
      !current() ||
      !confirmed ||
      state.value.phase !== 'ready' ||
      !visible() ||
      Date.now() - lastInput >= IDLE ||
      Date.now() < blockedUntil
    )
      return
    if (Date.now() - lastStart < START_INTERVAL) {
      refreshStart = setTimeout(start, START_INTERVAL - (Date.now() - lastStart))
      return
    }
    // Attempted writes are never buffered or automatically replayed after failure.
    lastStart = Date.now()
    if (command('typing_started')) {
      typing = true
      refreshStart = setTimeout(start, START_INTERVAL)
    }
  }
  function input(hasText: boolean) {
    if (!hasText) {
      stop()
      return
    }
    if (
      !current() ||
      !confirmed ||
      state.value.phase !== 'ready' ||
      !visible() ||
      Date.now() < blockedUntil
    )
      return
    lastInput = Date.now()
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE)
    if (!refreshStart) start()
  }
  function invalidate(s: RoomActivityScope) {
    if (!current(s)) return
    stop()
    version++
    online.clear()
    deadlines.clear()
    publish('unavailable')
    void refresh()
  }
  function refresh(): Promise<void> {
    if (!current() || !visible()) return Promise.resolve()
    if (pending) return pending
    if (Date.now() < Math.max(nextRead, blockedUntil)) return Promise.resolve()
    const s = scope!,
      g = generation,
      v = version
    const abort = new AbortController()
    controller = abort
    nextRead = Date.now() + START_INTERVAL
    const valid = () => current(s) && g === generation && !abort.signal.aborted
    pending = (async () => {
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.presence(s.roomId, s.userId),
          queryFn: async ({ signal }) => {
            const result = await api.presence(s.roomId, AbortSignal.any([signal, abort.signal]))
            const safe = parseRoomPresence(result, s.roomId)
            if (!safe) throw new Error('Invalid room activity')
            return safe
          },
          staleTime: 0,
          retry: false,
        })
        if (!valid() || v !== version || !confirmed) return
        const snapshot = parseRoomPresence(data, s.roomId)
        if (!snapshot) throw new Error('Invalid room activity')
        online = new Set(snapshot.online_user_ids)
        deadlines.clear()
        for (const id of snapshot.typing_user_ids) deadlines.set(id, Date.now() + TTL)
        version++
        publish('ready')
      } catch (error) {
        if (!valid()) return
        if (error instanceof ApiError && error.status === 429)
          blockedUntil =
            Date.now() + Math.max(START_INTERVAL, (error.retryAfterSeconds ?? 2) * 1000)
        if (v === version) {
          stop()
          online.clear()
          deadlines.clear()
          publish('unavailable')
        }
      } finally {
        if (g === generation) {
          pending = undefined
          controller = undefined
        }
      }
    })()
    return pending
  }
  useEventListener(document, 'visibilitychange', () => {
    if (!visible()) pause()
  })
  onScopeDispose(pause)
  return { state: readonly(state), activate, pause, receive, invalidate, input, stop, refresh }
}
