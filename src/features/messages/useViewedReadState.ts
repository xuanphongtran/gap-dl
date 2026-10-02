import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { ApiError, api, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown } from '../../lib/rate-limit'
import { readStateOptions, retainReadCursor } from './read-state'
import type { Message, ReadState } from '../../types'

export function useViewedReadState(
  roomId: Ref<number>,
  userId: Ref<number | undefined>,
  enabled: Ref<boolean>,
  list: Ref<HTMLElement | null>,
  messages: Ref<Message[]>,
  onAccessLost: (id: number) => void,
) {
  const state = useQuery(
    computed(() => ({
      ...readStateOptions(roomId.value, userId.value || 0),
      enabled: enabled.value && !!userId.value,
    })),
  )
  const writeError = ref('')
  const cooldown = useActionCooldown()
  const mutation = useMutation({
    mutationFn: ({ id, cursor, signal }: { id: number; cursor: number; signal: AbortSignal }) =>
      api.advanceReadState(id, cursor, signal),
  })
  let viewed = 0
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let writing = false
  let observer: ResizeObserver | undefined

  function active() {
    return (
      enabled.value &&
      !!userId.value &&
      document.visibilityState === 'visible' &&
      document.hasFocus()
    )
  }

  function cancelTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  function reset() {
    generation++
    cancelTimer()
    controller?.abort()
    controller = undefined
    writing = false
    viewed = 0
    writeError.value = ''
  }

  function schedule() {
    if (
      !active() ||
      writing ||
      timer ||
      writeError.value ||
      state.isError.value ||
      !state.data.value
    )
      return
    if (viewed <= state.data.value.last_read_message_id) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, 500)
  }

  async function flush() {
    if (!active() || writing || cooldown.remaining.value || !state.data.value) return
    const cursor = viewed
    if (cursor <= state.data.value.last_read_message_id) return
    const id = roomId.value
    const key = queryKeys.readState(id, userId.value!)
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true })
    const epoch = generation
    const abort = new AbortController()
    controller = abort
    writing = true
    writeError.value = ''
    try {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      if (epoch !== generation || abort.signal.aborted) return
      const result = await mutation.mutateAsync({ id, cursor, signal: abort.signal })
      if (
        epoch !== generation ||
        !enabled.value ||
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !== query
      )
        return
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      if (
        epoch !== generation ||
        abort.signal.aborted ||
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !== query
      )
        return
      queryClient.setQueryData<ReadState>(key, (current) => retainReadCursor(current, result))
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    } catch (cause) {
      if (
        epoch !== generation ||
        abort.signal.aborted ||
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !== query
      )
        return
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) onAccessLost(id)
      else {
        cooldown.start(cause)
        writeError.value = errorMessage(cause)
      }
    } finally {
      if (epoch === generation) {
        writing = false
        controller = undefined
        schedule()
      }
    }
  }

  function measure() {
    if (!active()) {
      cancelTimer()
      return
    }
    const element = list.value
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const top = Math.max(0, bounds.top)
    const bottom = Math.min(window.innerHeight, bounds.bottom)
    if (bounds.width <= 0 || bottom <= top) return
    for (const row of element.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const rect = row.getBoundingClientRect()
      // A row is viewed once its bottom is visible inside the conversation viewport.
      if (rect.width > 0 && rect.bottom > top && rect.bottom <= bottom && rect.top < bottom)
        viewed = Math.max(viewed, Number(row.dataset.messageId) || 0)
    }
    schedule()
  }

  async function retry() {
    if (cooldown.remaining.value) return
    if (state.isError.value) await state.refetch()
    writeError.value = ''
    measure()
  }

  watch(
    [roomId, userId, enabled],
    () => {
      reset()
      void nextTick(measure)
    },
    { flush: 'sync' },
  )
  watch([messages, state.data], () => void nextTick(measure), { flush: 'post' })
  watch(state.error, (cause) => {
    if (cause instanceof ApiError && [403, 404].includes(cause.status)) onAccessLost(roomId.value)
  })
  watch(
    list,
    (element) => {
      observer?.disconnect()
      if (element && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure)
        observer.observe(element)
      }
      void nextTick(measure)
    },
    { flush: 'post' },
  )

  onMounted(() => {
    document.addEventListener('visibilitychange', measure)
    window.addEventListener('focus', measure)
    window.addEventListener('blur', cancelTimer)
    window.addEventListener('resize', measure)
  })
  onUnmounted(() => {
    reset()
    observer?.disconnect()
    document.removeEventListener('visibilitychange', measure)
    window.removeEventListener('focus', measure)
    window.removeEventListener('blur', cancelTimer)
    window.removeEventListener('resize', measure)
  })

  return {
    measure,
    retry,
    error: computed(
      () => writeError.value || (state.error.value ? errorMessage(state.error.value) : ''),
    ),
    retryAfter: cooldown.remaining,
  }
}
