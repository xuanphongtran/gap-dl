import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { CancelledError, useMutation, useQuery } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import { useKeyedActionCooldown } from '../../lib/rate-limit'
import type { NotificationPreferences, RoomNotificationPreferences } from '../../types'

export function useNotificationPreferences(options: {
  userId: Readonly<Ref<number | undefined>>
  roomId?: Readonly<Ref<number>>
  enabled: Readonly<Ref<boolean>>
  onAccessLost?: (roomId: number) => void
}) {
  const epoch = ref(0),
    verified = ref(-1),
    pending = shallowRef<object>(),
    saveError = ref('')
  const readCooldown = useKeyedActionCooldown(),
    saveCooldown = useKeyedActionCooldown()
  const key = computed(() =>
    options.roomId
      ? queryKeys.roomNotificationPreferences(options.roomId.value, options.userId.value || 0)
      : queryKeys.notificationPreferences(options.userId.value || 0),
  )
  const cooldownKey = computed(() => JSON.stringify(key.value))
  const allowed = computed(() => options.enabled.value && !!options.userId.value && !!readSession())
  const automatic = computed(
    () => allowed.value && !readCooldown.remaining(cooldownKey.value) && !pending.value,
  )
  function cancel(oldKey: readonly unknown[]) {
    void queryClient.cancelQueries({ queryKey: oldKey, exact: true })
  }
  function reset() {
    epoch.value++
    verified.value = -1
    pending.value = undefined
    saveError.value = ''
  }
  watch(
    [key, allowed],
    (_next, [oldKey]) => {
      reset()
      cancel(oldKey)
      void queryClient.invalidateQueries({ queryKey: key.value, exact: true, refetchType: 'none' })
    },
    { flush: 'sync' },
  )
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    ) {
      reset()
      cancel(key.value)
      queryClient.removeQueries({ queryKey: key.value, exact: true })
    }
  })
  function bool(response: NotificationPreferences | RoomNotificationPreferences): boolean {
    const value = options.roomId
      ? (response as RoomNotificationPreferences).muted
      : (response as NotificationPreferences).mentions_enabled
    if (typeof value !== 'boolean') throw new Error('Invalid notification preferences.')
    return value
  }
  const query = useQuery(
    computed(() => ({
      queryKey: key.value,
      enabled: automatic.value,
      retry: false,
      staleTime: 10_000,
      refetchOnMount: 'always',
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (!automatic.value) throw new CancelledError({ revert: true })
        const user = options.userId.value,
          room = options.roomId?.value,
          capturedEpoch = epoch.value,
          capturedKey = key.value
        const instance = queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true })
        const current = () =>
          !signal.aborted &&
          allowed.value &&
          user === options.userId.value &&
          room === options.roomId?.value &&
          capturedEpoch === epoch.value &&
          queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true }) === instance
        try {
          const response =
            room !== undefined
              ? await api.roomNotificationPreferences(room, signal)
              : await api.notificationPreferences(signal)
          if (!current()) throw new CancelledError({ revert: true })
          bool(response)
          verified.value = capturedEpoch
          return response
        } catch (cause) {
          if (current()) {
            readCooldown.start(cooldownKey.value, cause)
            if (
              room !== undefined &&
              cause instanceof ApiError &&
              [403, 404].includes(cause.status)
            )
              options.onAccessLost?.(room)
          }
          throw cause
        }
      },
    })),
  )
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async ({
      room,
      value,
    }: {
      room?: number
      value: boolean
    }): Promise<NotificationPreferences | RoomNotificationPreferences> =>
      room !== undefined
        ? api.updateRoomNotificationPreferences(room, value)
        : api.updateNotificationPreferences(value),
  })
  async function save(value: boolean) {
    if (
      !allowed.value ||
      pending.value ||
      saveCooldown.remaining(cooldownKey.value) ||
      readCooldown.remaining(cooldownKey.value)
    )
      return
    const user = options.userId.value,
      room = options.roomId?.value,
      capturedEpoch = epoch.value,
      capturedKey = key.value,
      identity = {}
    pending.value = identity
    saveError.value = ''
    cancel(capturedKey)
    const current = () =>
      user === options.userId.value &&
      room === options.roomId?.value &&
      capturedEpoch === epoch.value &&
      allowed.value &&
      pending.value === identity
    try {
      const response = await mutation.mutateAsync({ room, value })
      if (!current()) return
      bool(response)
      queryClient.setQueryData(capturedKey, response)
      verified.value = capturedEpoch
    } catch (cause) {
      if (current()) {
        saveCooldown.start(cooldownKey.value, cause)
        saveError.value = errorMessage(cause)
        if (room !== undefined && cause instanceof ApiError && [403, 404].includes(cause.status))
          options.onAccessLost?.(room)
      }
    } finally {
      if (current()) pending.value = undefined
    }
  }
  async function retry() {
    if (automatic.value) await query.refetch()
  }
  useEventListener(window, 'focus', () => {
    if (automatic.value) {
      verified.value = -1
      void query.refetch()
    }
  })
  const value = computed(() =>
    allowed.value && verified.value === epoch.value && query.data.value
      ? bool(query.data.value)
      : undefined,
  )
  const cooldownSeconds = computed(() =>
    Math.max(readCooldown.remaining(cooldownKey.value), saveCooldown.remaining(cooldownKey.value)),
  )
  const error = computed(() =>
    cooldownSeconds.value
      ? `Retry in ${cooldownSeconds.value} seconds.`
      : saveError.value || (query.error.value ? errorMessage(query.error.value) : ''),
  )
  onScopeDispose(() => {
    cancel(key.value)
    epoch.value++
  })
  return {
    value,
    loading: query.isFetching,
    saving: computed(() => !!pending.value),
    error,
    cooldownSeconds,
    save,
    retry,
  }
}
