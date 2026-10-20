import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import { useEventListener, useWebSocket } from '@vueuse/core'
import type { InfiniteData } from '@tanstack/vue-query'
import { api, ApiError } from '../../lib/api'
import { apiBaseURL } from '../../lib/http'
import { mergeMessages } from '../../lib/messages'
import { clearRoomQueries, queryClient, queryKeys } from '../../lib/query'
import { parseRealtimeFrame, websocketURL, type RealtimeEvent } from '../../lib/realtime'
import { readSession } from '../../lib/session'
import { invalidateRoomSearch } from '../messages/message-search'
import { retainReadCursor } from '../messages/read-state'
import { recoverMessageGap, refreshRetainedMessages } from '../messages/recoverMessageGap'
import type { Message, ReadState } from '../../types'
import { useRoomActivity } from './useRoomActivity'
import type {
  RoomActivityScope,
  RealtimeContext,
  RealtimeRoom,
  RealtimeStatus,
} from './realtime-context'

export function useWorkspaceRealtime(): RealtimeContext {
  const status = ref<RealtimeStatus>('connecting')
  const gapRoomId = ref<number | null>(null)
  const url = shallowRef<string>()
  const synchronizedAnchors = new Map<number, number>()
  let active: RealtimeRoom | undefined
  let generation = 0
  let roomGeneration = 0
  let connectionEpoch = 0
  let activityScope: RoomActivityScope | undefined
  let authorized = false
  let lastActivityRepair = -Infinity
  let disposed = false
  let intentionalClose = false
  let attempts = 0
  let joined: number | undefined
  let socketToken: string | undefined
  let userId: number | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined
  let connectController: AbortController | undefined
  let recoveryController: AbortController | undefined
  let queuedRecovery = false
  let queuedSuspend = false

  const activity = useRoomActivity({
    isCurrent: currentActivity,
    send: (scope, command) => currentActivity(scope) && socket.send(JSON.stringify(command), false),
  })
  function currentActivity(scope: RoomActivityScope) {
    return (
      !disposed &&
      scope === activityScope &&
      scope.connectionEpoch === connectionEpoch &&
      scope.roomEpoch === roomGeneration &&
      active?.id === scope.roomId &&
      active.userId === scope.userId &&
      userId === scope.userId &&
      authorized &&
      joined === scope.roomId &&
      socket.status.value === 'OPEN' &&
      !!socket.ws.value &&
      currentSocket(socket.ws.value)
    )
  }
  function pauseActivity() {
    activity.pause()
    activityScope = undefined
  }
  function joinActivity() {
    if (
      !active ||
      !authorized ||
      !socket.ws.value ||
      !currentSocket(socket.ws.value) ||
      socket.status.value !== 'OPEN' ||
      document.visibilityState === 'hidden'
    )
      return
    activityScope = {
      roomId: active.id,
      userId: active.userId,
      connectionEpoch,
      roomEpoch: roomGeneration,
    }
    activity.activate(activityScope)
    if (socket.send(JSON.stringify({ type: 'join', room_id: String(active.id) }), false))
      joined = active.id
    else pauseActivity()
  }
  const socket = useWebSocket(url, {
    immediate: false,
    autoConnect: false,
    autoReconnect: false,
    onConnected(ws) {
      if (!currentSocket(ws)) return
      connectionEpoch++
      lastActivityRepair = -Infinity
      pauseActivity()
      attempts = 0
      joined = undefined
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms })
      void queryClient.invalidateQueries({ queryKey: queryKeys.invitations })
      if (active) void recover(true)
      else status.value = 'connected'
    },
    onDisconnected(ws) {
      if (!currentSocket(ws) || intentionalClose) return
      pauseActivity()
      authorized = false
      joined = undefined
      active?.setPaused(true)
      recoveryController?.abort()
      recoveryController = undefined
      scheduleRetry()
      // REST remains useful even when the realtime transport is unavailable.
      if (active && navigator.onLine) void recover(true)
    },
    onMessage(ws, frame) {
      if (currentSocket(ws)) handleFrame(frame.data)
    },
  })

  function currentSocket(ws: WebSocket) {
    return !disposed && ws === socket.ws.value && socketToken === readSession()?.access_token
  }
  function closeSocket() {
    pauseActivity()
    authorized = false
    intentionalClose = true
    socket.close()
    socket.data.value = null
    intentionalClose = false
    joined = undefined
  }
  function cancelWork() {
    clearTimeout(retryTimer)
    clearTimeout(eventTimer)
    retryTimer = undefined
    eventTimer = undefined
    connectController?.abort()
    recoveryController?.abort()
    connectController = undefined
    recoveryController = undefined
    queuedRecovery = false
    queuedSuspend = false
  }
  function scheduleRetry() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (disposed || !readSession()) return
    if (!navigator.onLine) {
      status.value = 'offline'
      return
    }
    status.value = 'fallback'
    if (attempts >= 5) return
    const delay = Math.min(30000, 1000 * 2 ** attempts * (1 + Math.random() * 0.25))
    attempts++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void connect()
    }, delay)
  }
  async function connect() {
    if (disposed || !readSession()) return
    if (!navigator.onLine) {
      status.value = 'offline'
      return
    }
    const epoch = generation
    connectController?.abort()
    const controller = new AbortController()
    connectController = controller
    status.value = 'connecting'
    try {
      const profile = await api.profile(controller.signal)
      if (epoch !== generation || disposed || controller.signal.aborted) return
      userId = profile.id
      if (active && active.userId !== userId) {
        const previous = active
        synchronizedAnchors.clear()
        active = undefined
        roomGeneration++
        previous.setPaused(true)
        clearRoomQueries(previous.id)
        previous.onAccessLost()
      }
      queryClient.setQueryData(queryKeys.profile, profile)
      socketToken = readSession()?.access_token
      if (!socketToken) return
      url.value = websocketURL(apiBaseURL, socketToken)
      closeSocket()
      socket.open()
    } catch {
      if (epoch === generation && !disposed && !controller.signal.aborted) scheduleRetry()
    } finally {
      if (connectController === controller) connectController = undefined
    }
  }
  function revoke(id: number) {
    if (active?.id === id) {
      pauseActivity()
      authorized = false
    }
    synchronizedAnchors.delete(id)
    if (joined === id) {
      socket.send(JSON.stringify({ type: 'leave', room_id: String(id) }), false)
      joined = undefined
    }
    if (active?.id === id) {
      const room = active
      active = undefined
      roomGeneration++
      recoveryController?.abort()
      recoveryController = undefined
      clearTimeout(eventTimer)
      eventTimer = undefined
      queuedRecovery = false
      room.setPaused(true)
      clearRoomQueries(id)
      gapRoomId.value = null
      room.onAccessLost()
    } else clearRoomQueries(id)
    status.value = socket.status.value === 'OPEN' ? 'connected' : 'fallback'
  }
  function revokedEvent(event: RealtimeEvent): boolean {
    return (
      (event.type === 'membership_changed' &&
        event.payload.user_id === userId &&
        ['left', 'removed'].includes(event.payload.action)) ||
      (event.type === 'error' && ['forbidden', 'membership_revoked'].includes(event.payload.code))
    )
  }
  function enqueueRecovery(suspend: boolean) {
    queuedSuspend ||= suspend
    if (suspend) {
      pauseActivity()
      authorized = false
      active?.setPaused(true)
    }
    if (eventTimer) return
    eventTimer = setTimeout(() => {
      eventTimer = undefined
      const pause = queuedSuspend
      queuedSuspend = false
      void recover(pause)
    }, 100)
  }
  function handleFrame(frame: unknown) {
    const parsed = parseRealtimeFrame(frame)
    const revoked = new Set<number>()
    // Revocation takes precedence over all data in the same server batch.
    for (const event of parsed.events) {
      if (revokedEvent(event) && event.roomId !== null) {
        revoked.add(event.roomId)
        revoke(event.roomId)
      }
    }
    if (parsed.malformed && active) enqueueRecovery(true)
    if (activityScope && parsed.invalidActivityRooms?.includes(activityScope.roomId))
      activity.invalidate(activityScope)
    for (const event of parsed.events) {
      if (event.roomId !== null && revoked.has(event.roomId)) continue
      if (
        ['presence_snapshot', 'presence', 'typing_started', 'typing_stopped'].includes(event.type)
      ) {
        if (
          activityScope &&
          event.roomId === active?.id &&
          (event.type === 'presence_snapshot' ||
            event.type === 'presence' ||
            event.type === 'typing_started' ||
            event.type === 'typing_stopped')
        )
          activity.receive(activityScope, event)
        continue
      }
      if (
        event.type === 'error' &&
        ['not_joined', 'authorization_pending', 'rate_limited'].includes(event.payload.code)
      ) {
        if (event.roomId === active?.id && activityScope) {
          activity.stop()
          if (
            event.payload.code === 'not_joined' &&
            activity.state.value.phase === 'ready' &&
            Date.now() - lastActivityRepair >= 2000
          ) {
            lastActivityRepair = Date.now()
            joinActivity()
          } else if (event.payload.code === 'authorization_pending')
            activity.activate(activityScope)
        }
        continue
      }
      if (event.type === 'invitation') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.invitations })
        void queryClient.invalidateQueries({ queryKey: queryKeys.rooms })
      } else if (event.type === 'membership_changed') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.rooms })
        if (event.roomId === active?.id) enqueueRecovery(true)
      } else if (
        (event.type === 'message_updated' || event.type === 'message_deleted') &&
        event.roomId === active?.id
      ) {
        enqueueRecovery(true)
      } else if (event.type === 'message' && event.roomId === active?.id) {
        enqueueRecovery(false)
      } else if (event.type === 'unknown' && event.roomId === active?.id) {
        enqueueRecovery(false)
      } else if (event.type === 'error' && !revokedEvent(event)) {
        if (event.roomId === null || event.roomId === active?.id) enqueueRecovery(true)
      }
    }
  }
  async function recover(suspend: boolean, reset = false) {
    const room = active
    if (
      !room ||
      disposed ||
      !readSession() ||
      !navigator.onLine ||
      (gapRoomId.value === room.id && !reset)
    )
      return
    if (recoveryController) {
      queuedRecovery = true
      queuedSuspend ||= suspend
      return
    }
    const epoch = generation,
      roomEpoch = roomGeneration
    const controller = new AbortController()
    recoveryController = controller
    const valid = () =>
      !disposed &&
      !controller.signal.aborted &&
      generation === epoch &&
      roomGeneration === roomEpoch &&
      active === room
    const known = room.messages().slice()
    const anchor = synchronizedAnchors.get(room.id)
    // A polled newest page is not proof that the disconnect gap was bridged.
    const baseline = anchor === undefined ? known : known.filter((message) => message.id <= anchor)
    if (suspend) {
      pauseActivity()
      authorized = false
      room.setPaused(true)
      status.value = 'recovering'
    }
    try {
      await queryClient.cancelQueries({
        queryKey: queryKeys.room(room.id),
        predicate: (query) =>
          !['notification-preferences', 'presence'].includes(String(query.queryKey[2])),
      })
      if (!valid()) return
      const authorizedRoom = await api.room(room.id, controller.signal)
      if (!valid()) return
      if (!authorizedRoom.role) {
        revoke(room.id)
        return
      }
      const history = queryClient.getQueryData<InfiniteData<Message[], number | null>>(
        queryKeys.messageHistory(room.id),
      )
      const retained = mergeMessages(known, history?.pages.flat() || [])
      const [result, members, readState, refreshedHistory] = await Promise.all([
        recoverMessageGap(room.id, reset ? [] : baseline, controller.signal),
        api.members(room.id, controller.signal),
        api.readState(room.id, controller.signal),
        suspend && !reset
          ? refreshRetainedMessages(room.id, retained, controller.signal)
          : Promise.resolve(undefined),
      ])
      if (!valid()) return
      if (result.gap) {
        pauseActivity()
        authorized = false
        gapRoomId.value = room.id
        room.setPaused(true)
        status.value = 'fallback'
        return
      }
      const merged = mergeMessages(reset ? [] : known, [
        ...result.messages,
        ...(refreshedHistory?.pages.flat() || []),
      ])
      synchronizedAnchors.set(room.id, Math.max(0, ...result.messages.map((message) => message.id)))
      queryClient.setQueryData(queryKeys.room(room.id), authorizedRoom)
      queryClient.setQueryData(queryKeys.members(room.id), members)
      queryClient.setQueryData<ReadState>(queryKeys.readState(room.id, room.userId), (current) =>
        retainReadCursor(current, readState),
      )
      queryClient.setQueryData(queryKeys.latestMessages(room.id), merged.slice(-40))
      if (history && refreshedHistory)
        queryClient.setQueryData(queryKeys.messageHistory(room.id), refreshedHistory)
      else if (!history)
        queryClient.setQueryData<InfiniteData<Message[], number | null>>(
          queryKeys.messageHistory(room.id),
          {
            pages: [merged.slice(-40).reverse()],
            pageParams: [null],
          },
        )
      void invalidateRoomSearch(room.id)
      room.applyRecovered(merged)
      gapRoomId.value = null
      room.setPaused(false)
      authorized = true
      if (suspend || joined !== room.id) joinActivity()
      status.value = socket.status.value === 'OPEN' ? 'connected' : 'fallback'
    } catch (cause) {
      if (!valid()) return
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) revoke(room.id)
      else {
        pauseActivity()
        authorized = false
        room.setPaused(true)
        status.value = navigator.onLine ? 'fallback' : 'offline'
      }
    } finally {
      if (recoveryController === controller) {
        recoveryController = undefined
        if (queuedRecovery && valid()) {
          queuedRecovery = false
          enqueueRecovery(queuedSuspend)
        }
      }
    }
  }
  function registerRoom(room: RealtimeRoom) {
    pauseActivity()
    authorized = false
    if (joined !== undefined)
      socket.send(JSON.stringify({ type: 'leave', room_id: String(joined) }), false)
    joined = undefined
    roomGeneration++
    recoveryController?.abort()
    recoveryController = undefined
    clearTimeout(eventTimer)
    eventTimer = undefined
    queuedRecovery = false
    gapRoomId.value = null
    active = room
    room.setPaused(true)
    if (socket.status.value === 'OPEN') void recover(true)
    else if (['fallback', 'recovering'].includes(status.value) && navigator.onLine)
      void recover(true)
    return () => {
      if (active !== room) return
      pauseActivity()
      authorized = false
      if (joined === room.id)
        socket.send(JSON.stringify({ type: 'leave', room_id: String(room.id) }), false)
      active = undefined
      joined = undefined
      roomGeneration++
      recoveryController?.abort()
      recoveryController = undefined
      clearTimeout(eventTimer)
      eventTimer = undefined
      queuedRecovery = false
      gapRoomId.value = null
    }
  }
  function sessionChanged(event: Event) {
    pauseActivity()
    generation++
    cancelWork()
    closeSocket()
    active?.setPaused(true)
    userId = undefined
    const next = readSession()
    if (!next || (event instanceof CustomEvent && event.detail?.accountChanged === true)) {
      synchronizedAnchors.clear()
      const previous = active
      active = undefined
      queryClient.clear()
      previous?.onAccessLost()
      roomGeneration++
      gapRoomId.value = null
    }
    attempts = 0
    if (next) void connect()
    else status.value = 'fallback'
  }
  function retry() {
    attempts = 0
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (socket.status.value === 'OPEN') void recover(true)
    else void connect()
  }
  async function reloadConversation() {
    if (!active) return
    active.setPaused(true)
    queryClient.removeQueries({ queryKey: queryKeys.latestMessages(active.id), exact: true })
    queryClient.removeQueries({ queryKey: queryKeys.messageHistory(active.id), exact: true })
    active.reset()
    await recover(true, true)
  }
  useEventListener(window, 'session:changed', sessionChanged)
  useEventListener(window, 'offline', () => {
    closeSocket()
    cancelWork()
    active?.setPaused(true)
    status.value = 'offline'
  })
  useEventListener(window, 'online', () => {
    attempts = 0
    void connect()
  })
  useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseActivity()
    if (document.visibilityState === 'visible' && active) void recover(true)
  })
  onScopeDispose(() => {
    pauseActivity()
    disposed = true
    generation++
    cancelWork()
    closeSocket()
    active = undefined
  })
  void connect()
  return {
    activity: activity.state,
    typingInput: activity.input,
    stopTyping: activity.stop,
    status: readonly(status),
    gapRoomId: readonly(gapRoomId),
    registerRoom,
    retry,
    reloadConversation,
  }
}
