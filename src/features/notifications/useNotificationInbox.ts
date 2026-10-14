import { computed, onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import { CancelledError, useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { clearRoomQueries, queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import { useActionCooldown } from '../../lib/rate-limit'
import type { Notification, Room } from '../../types'
import { mergeNotifications, validateNotificationPage } from './notification-feed'

export function useNotificationInbox(options: {
  userId: Readonly<Ref<number | undefined>>
  enabled: Readonly<Ref<boolean>>
}) {
  const unreadOnly = ref(false)
  const visible = ref(document.visibilityState === 'visible')
  const online = ref(navigator.onLine)
  const epoch = ref(0),
    verified = ref(-1)
  const acknowledged = reactive(new Map<number, Notification>())
  const pendingReads = reactive(new Set<number>())
  const actionError = ref('')
  const cooldown = useActionCooldown()
  const key = computed(() =>
    queryKeys.notificationFeed(options.userId.value || 0, unreadOnly.value),
  )
  const allowed = computed(
    () =>
      options.enabled.value &&
      !!options.userId.value &&
      !!readSession() &&
      visible.value &&
      online.value,
  )
  const automatic = computed(() => allowed.value && !cooldown.remaining.value)
  const roomQuery = useQuery({
    queryKey: queryKeys.rooms,
    queryFn: ({ signal }) => api.rooms(signal),
    enabled: false,
    retry: false,
  })
  const rooms = computed(() => roomQuery.data.value?.rooms || [])
  let navigationController: AbortController | undefined
  let ownedRemoval = false
  function resetVerification() {
    navigationController?.abort()
    navigationController = undefined
    pendingReads.clear()
    epoch.value++
    verified.value = -1
    actionError.value = ''
  }
  function cancel(oldKey: readonly unknown[], remove: boolean) {
    void queryClient.cancelQueries({ queryKey: oldKey, exact: true })
    if (remove) {
      ownedRemoval = true
      try {
        queryClient.removeQueries({ queryKey: oldKey, exact: true })
      } finally {
        ownedRemoval = false
      }
    }
  }
  watch(
    [key, allowed],
    ([nextKey], [oldKey]) => {
      resetVerification()
      cancel(oldKey, JSON.stringify(nextKey) !== JSON.stringify(oldKey))
    },
    { flush: 'sync' },
  )
  watch(
    options.userId,
    () => {
      acknowledged.clear()
      pendingReads.clear()
    },
    { flush: 'sync' },
  )
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !ownedRemoval &&
      event.type === 'removed' &&
      event.query.queryKey[0] === 'notifications' &&
      event.query.queryKey[1] === options.userId.value
    ) {
      resetVerification()
      acknowledged.clear()
      pendingReads.clear()
    }
  })
  onScopeDispose(unsubscribe)
  const feed = useInfiniteQuery(
    computed(() => ({
      queryKey: key.value,
      enabled: automatic.value,
      retry: false,
      staleTime: 0,
      initialPageParam: undefined as number | undefined,
      refetchInterval: automatic.value ? 5000 : false,
      getNextPageParam: (page: { next_before: number | null }) => page.next_before ?? undefined,
      queryFn: async ({
        signal,
        pageParam,
      }: {
        signal: AbortSignal
        pageParam: number | undefined
      }) => {
        if (!automatic.value) throw new CancelledError({ revert: true })
        const user = options.userId.value,
          filter = unreadOnly.value,
          capturedEpoch = epoch.value,
          capturedKey = key.value
        const instance = queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true })
        const current = () =>
          !signal.aborted &&
          allowed.value &&
          user === options.userId.value &&
          filter === unreadOnly.value &&
          capturedEpoch === epoch.value &&
          queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true }) === instance
        try {
          await queryClient.fetchQuery({
            queryKey: queryKeys.rooms,
            staleTime: 0,
            retry: false,
            queryFn: async ({ signal: roomSignal }) => {
              const value = await api.rooms(roomSignal)
              if (!current()) throw new CancelledError({ revert: true })
              return value
            },
          })
          if (!current()) throw new CancelledError({ revert: true })
          const page = await api.notifications(20, pageParam, filter, signal)
          if (!current()) throw new CancelledError({ revert: true })
          validateNotificationPage(page, pageParam)
          verified.value = capturedEpoch
          return page
        } catch (cause) {
          if (current()) cooldown.start(cause)
          throw cause
        }
      },
    })),
  )
  function recover() {
    if (!allowed.value || cooldown.remaining.value) return
    resetVerification()
    cancel(key.value, false)
    void feed.refetch()
  }
  useEventListener(document, 'visibilitychange', () => {
    visible.value = document.visibilityState === 'visible'
  })
  useEventListener(window, 'offline', () => {
    online.value = false
  })
  useEventListener(window, 'online', () => {
    online.value = true
    recover()
  })
  useEventListener(window, 'focus', recover)
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    ) {
      resetVerification()
      acknowledged.clear()
      pendingReads.clear()
      cancel(key.value, true)
      if (readSession() && allowed.value) recover()
    }
  })
  const rows = computed(() => {
    if (
      !allowed.value ||
      verified.value !== epoch.value ||
      feed.isFetching.value ||
      feed.error.value
    )
      return []
    const authorized = new Set(
      rooms.value.filter((room) => room.role !== null).map((room) => room.id),
    )
    return mergeNotifications(feed.data.value?.pages || [], [...acknowledged.values()]).filter(
      (row) => authorized.has(row.room_id) && (!unreadOnly.value || row.read_at === null),
    )
  })
  const readMutation = useMutation({
    mutationFn: api.readNotification,
    retry: false,
    networkMode: 'always',
  })
  async function markRead(id: number) {
    if (
      !allowed.value ||
      cooldown.remaining.value ||
      pendingReads.has(id) ||
      !rows.value.some((row) => row.id === id && row.read_at === null)
    )
      return
    const user = options.userId.value,
      capturedEpoch = epoch.value
    const current = () =>
      user === options.userId.value && capturedEpoch === epoch.value && allowed.value
    pendingReads.add(id)
    actionError.value = ''
    try {
      const result = await readMutation.mutateAsync(id)
      if (!current()) return
      validateNotificationPage({ notifications: [result], next_before: null })
      if (result.id !== id) throw new Error('Invalid notification acknowledgement.')
      acknowledged.set(id, result)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications(user!),
        refetchType: 'none',
      })
      await feed.refetch()
    } catch (cause) {
      if (current()) {
        cooldown.start(cause)
        actionError.value = errorMessage(cause)
        if (cause instanceof ApiError && cause.status === 404) {
          resetVerification()
          cancel(key.value, true)
          void feed.refetch()
        }
      }
    } finally {
      if (user === options.userId.value && capturedEpoch === epoch.value) pendingReads.delete(id)
    }
  }
  async function authorizeRoom(roomId: number): Promise<boolean> {
    if (!allowed.value || cooldown.remaining.value) return false
    const user = options.userId.value,
      capturedEpoch = epoch.value
    navigationController?.abort()
    const controller = new AbortController()
    navigationController = controller
    try {
      const room = await api.room(roomId, controller.signal)
      if (user !== options.userId.value || capturedEpoch !== epoch.value || !allowed.value)
        return false
      if (!room.role) {
        clearRoomQueries(roomId)
        return false
      }
      queryClient.setQueryData<Room>(queryKeys.room(roomId), room)
      return true
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        user === options.userId.value &&
        capturedEpoch === epoch.value
      ) {
        cooldown.start(cause)
        actionError.value = errorMessage(cause)
        if (cause instanceof ApiError && [403, 404].includes(cause.status)) clearRoomQueries(roomId)
      }
      return false
    } finally {
      if (navigationController === controller) navigationController = undefined
    }
  }
  async function loadMore() {
    if (
      automatic.value &&
      verified.value === epoch.value &&
      feed.hasNextPage.value &&
      !feed.isFetching.value
    )
      await feed.fetchNextPage()
  }
  async function retry() {
    if (automatic.value) {
      actionError.value = ''
      await feed.refetch()
    }
  }
  const error = computed(() =>
    cooldown.remaining.value
      ? `Retry in ${cooldown.remaining.value} seconds.`
      : actionError.value || (feed.error.value ? errorMessage(feed.error.value) : ''),
  )
  onScopeDispose(() => {
    navigationController?.abort()
    cancel(key.value, true)
  })
  return {
    unreadOnly,
    rows,
    rooms,
    loading: computed(() => allowed.value && (feed.isPending.value || feed.isFetching.value)),
    loadingMore: feed.isFetchingNextPage,
    hasMore: feed.hasNextPage,
    error,
    cooldownSeconds: cooldown.remaining,
    readingIds: computed(() => [...pendingReads]),
    loadMore,
    retry,
    markRead,
    authorizeRoom,
  }
}
