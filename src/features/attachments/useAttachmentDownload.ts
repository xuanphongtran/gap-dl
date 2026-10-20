import { onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import type { Message } from '../../types'
import { safeMessageAttachments } from './attachment-metadata'
type ReadRef<T> = Readonly<Ref<T>>
interface Feedback {
  pending: boolean
  error: string
  deadline: number
  unavailable: boolean
}
export function useAttachmentDownload(options: {
  message: ReadRef<Message>
  userId: ReadRef<number | undefined>
  enabled: ReadRef<boolean>
  onAccessLost?: (id: number) => void
}) {
  const feedback = reactive(new Map<number, Feedback>()),
    requests = new Map<
      number,
      {
        id: number
        message: Pick<Message, 'id' | 'room_id' | 'revision'>
        user: number
        captured: number
        controller: AbortController
      }
    >(),
    now = ref(Date.now())
  let sequence = 0,
    epoch = 0,
    disposed = false
  const state = (id: number) => {
    if (!feedback.has(id))
      feedback.set(id, { pending: false, error: '', deadline: 0, unavailable: false })
    return feedback.get(id)!
  }
  function reset() {
    epoch++
    for (const request of requests.values()) request.controller.abort()
    requests.clear()
    feedback.clear()
  }
  watch(
    () => [
      options.userId.value,
      options.enabled.value,
      options.message.value.room_id,
      options.message.value.id,
      options.message.value.revision,
      options.message.value.deleted_at,
      JSON.stringify(safeMessageAttachments(options.message.value).map((a) => a.id)),
    ],
    reset,
    { flush: 'sync' },
  )
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    )
      reset()
  })
  useEventListener(window, 'room:access-lost', (event: Event) => {
    if ((event as CustomEvent<{ roomId: number }>).detail.roomId === options.message.value.room_id)
      reset()
  })
  onScopeDispose(() => {
    disposed = true
    reset()
  })
  useIntervalFn(() => {
    now.value = Date.now()
  }, 250)
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (attemptId: number) => {
      const context = requests.get(attemptId)
      if (!context) return
      const { id, message, user, captured, controller } = context
      const s = state(id)
      const current = () =>
        !disposed &&
        !controller.signal.aborted &&
        captured === epoch &&
        options.enabled.value &&
        user === options.userId.value &&
        !!readSession() &&
        options.message.value.id === message.id &&
        options.message.value.room_id === message.room_id &&
        options.message.value.revision === message.revision &&
        safeMessageAttachments(options.message.value).some((a) => a.id === id)
      try {
        if (!current()) return
        const ticket = await api.attachmentDownload(
          message.room_id,
          message.id,
          id,
          controller.signal,
        )
        if (!current()) return
        const url = new URL(ticket.download_url)
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          !Number.isFinite(Date.parse(ticket.expires_at)) ||
          Date.parse(ticket.expires_at) <= Date.now()
        )
          throw new Error('Invalid download ticket')
        const anchor = document.createElement('a')
        anchor.href = url.toString()
        anchor.rel = 'noreferrer noopener'
        anchor.referrerPolicy = 'no-referrer'
        anchor.target = '_blank'
        document.body.append(anchor)
        try {
          anchor.click()
        } finally {
          anchor.remove()
        }
      } catch (cause) {
        if (!current()) return
        const safe = new ApiError(
          cause instanceof ApiError ? cause.status : 0,
          'Download unavailable.',
          cause instanceof ApiError ? cause.requestId : undefined,
          cause instanceof ApiError ? cause.retryAfterSeconds : undefined,
        )
        s.error = errorMessage(safe)
        if (safe.status === 429 && safe.retryAfterSeconds)
          s.deadline = Math.max(s.deadline, Date.now() + safe.retryAfterSeconds * 1000)
        if ([403, 404].includes(safe.status)) {
          s.unavailable = true
          for (const key of [
            queryKeys.latestMessages(message.room_id),
            queryKeys.messageHistory(message.room_id),
            queryKeys.messageSearch(message.room_id),
          ])
            void queryClient.invalidateQueries({ queryKey: key })
          try {
            const room = await api.room(message.room_id, controller.signal)
            if (current() && !room.role) options.onAccessLost?.(message.room_id)
          } catch (roomError) {
            if (current() && roomError instanceof ApiError && [403, 404].includes(roomError.status))
              options.onAccessLost?.(message.room_id)
          }
        }
      } finally {
        s.pending = false
        if (requests.get(attemptId) === context) requests.delete(attemptId)
      }
    },
  })
  async function download(id: number) {
    const s = state(id)
    if (
      disposed ||
      !options.enabled.value ||
      !options.userId.value ||
      !readSession() ||
      s.pending ||
      s.unavailable ||
      Date.now() < s.deadline ||
      !safeMessageAttachments(options.message.value).some((a) => a.id === id)
    )
      return
    s.pending = true
    s.error = ''
    const attemptId = ++sequence
    const message = options.message.value
    requests.set(attemptId, {
      id,
      user: options.userId.value!,
      message: { id: message.id, room_id: message.room_id, revision: message.revision },
      captured: epoch,
      controller: new AbortController(),
    })
    await mutation.mutateAsync(attemptId)
  }
  return {
    download,
    pending: (id: number) => feedback.get(id)?.pending || false,
    error: (id: number) => feedback.get(id)?.error || '',
    unavailable: (id: number) => feedback.get(id)?.unavailable || false,
    cooldownSeconds: (id: number) =>
      Math.max(0, Math.ceil(((feedback.get(id)?.deadline || 0) - now.value) / 1000)),
  }
}
