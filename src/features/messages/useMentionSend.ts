import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { useEventListener, useIntervalFn, useTimestamp } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { MAX_MESSAGE_BYTES, messageContentBytes } from '../../lib/messages'
import { queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import { useActionCooldown } from '../../lib/rate-limit'
import type { Message, Room, RoomMember } from '../../types'

type ReadRef<T> = Readonly<Ref<T>>
interface Options {
  roomId: ReadRef<number>
  userId: ReadRef<number | undefined>
  enabled: ReadRef<boolean>
  members: ReadRef<RoomMember[]>
  draft: Ref<string>
  onSuccess: (roomId: number, message: Message) => void
  onAccessLost: (roomId: number) => void
}
interface Intent {
  roomId: number
  userId: number
  content: string
  ids: number[]
  key?: string
  createdAt: number
  epoch: number
  pending: boolean
  uncertain: boolean
  error: string
}

const intents = reactive(new Map<number, Intent>())
let intentEpoch = 0
let intentUser: number | undefined
function clearIntents() {
  intentEpoch++
  intentUser = undefined
  intents.clear()
}
window.addEventListener('session:changed', (event: Event) => {
  if (!readSession() || (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged)
    clearIntents()
})
window.addEventListener('room:access-lost', (event: Event) => {
  intents.delete((event as CustomEvent<{ roomId: number }>).detail.roomId)
})

export function useMentionSend(options: Options) {
  const selectedIds = ref<number[]>([])
  const error = ref('')
  const cooldown = useActionCooldown()
  const now = useTimestamp({ scheduler: (callback) => useIntervalFn(callback, 1000) })
  const current = computed(() => intents.get(options.roomId.value))
  const sending = computed(() => current.value?.pending || false)
  const locked = computed(() => !!current.value?.key)
  const expired = computed(() => !!current.value && now.value - current.value.createdAt >= 86400000)
  if (current.value) {
    options.draft.value = current.value.content
    selectedIds.value = [...current.value.ids]
  }
  const mutation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (intent: Intent) =>
      api.sendMessage(
        intent.roomId,
        intent.content,
        intent.key ? { mentionUserIds: intent.ids, idempotencyKey: intent.key } : undefined,
      ),
  })
  function reset() {
    clearIntents()
    selectedIds.value = []
    error.value = ''
  }
  watch(
    options.userId,
    (user) => {
      if (user && user !== intentUser) {
        reset()
        intentUser = user
      }
    },
    { flush: 'sync', immediate: true },
  )
  watch(
    options.roomId,
    () => {
      selectedIds.value = []
      error.value = current.value?.error || ''
    },
    { flush: 'sync' },
  )
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    )
      reset()
  })
  function discard() {
    intents.delete(options.roomId.value)
    selectedIds.value = []
    error.value = ''
  }
  async function execute(intent: Intent) {
    if (intent.pending || !options.enabled.value || cooldown.remaining.value) return
    if (Date.now() - intent.createdAt >= 86400000) {
      error.value = 'Retry expired. Check the conversation before sending again.'
      return
    }
    intent.pending = true
    error.value = ''
    const active = () =>
      intent.epoch === intentEpoch &&
      intent.userId === options.userId.value &&
      intents.get(intent.roomId) === intent
    try {
      const message = await mutation.mutateAsync(intent)
      if (!active()) return
      const isCurrent = intent.roomId === options.roomId.value
      const authorized = isCurrent
        ? options.enabled.value
        : !!queryClient.getQueryData<Room>(queryKeys.room(intent.roomId))?.role
      if (!authorized) {
        if (!intent.key) intents.delete(intent.roomId)
        else {
          intent.uncertain = true
          intent.error = 'Verify room access before retrying this pending send.'
          if (isCurrent) error.value = intent.error
        }
        return
      }
      intents.delete(intent.roomId)
      options.onSuccess(intent.roomId, message)
      if (isCurrent) {
        options.draft.value = ''
        selectedIds.value = []
        error.value = ''
      }
    } catch (cause) {
      if (!active()) return
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        intents.delete(intent.roomId)
        if (intent.roomId === options.roomId.value) options.onAccessLost(intent.roomId)
        return
      }
      const definite = cause instanceof ApiError && [400, 413, 429].includes(cause.status)
      if ((definite && !intent.uncertain) || !intent.key) intents.delete(intent.roomId)
      else intent.uncertain = true
      intent.error =
        cause instanceof ApiError && cause.status === 409
          ? 'Retry key conflicts. Check the conversation before discarding this pending send.'
          : errorMessage(cause)
      if (intent.roomId === options.roomId.value) {
        cooldown.start(cause)
        error.value = intent.error
      }
    } finally {
      intent.pending = false
    }
  }
  async function send() {
    if (
      current.value ||
      !options.enabled.value ||
      !options.userId.value ||
      cooldown.remaining.value
    )
      return
    const content = options.draft.value.trim()
    if (!content || messageContentBytes(content) > MAX_MESSAGE_BYTES) {
      error.value = 'Message must contain 1 to 4000 UTF-8 bytes after trimming.'
      return
    }
    const ids = [...new Set(selectedIds.value)].sort((a, b) => a - b)
    if (
      ids.some(
        (id) =>
          !Number.isSafeInteger(id) ||
          id === options.userId.value ||
          !options.members.value.some(
            (m) => m.user_id === id && m.room_id === options.roomId.value,
          ),
      )
    ) {
      error.value = 'Selected recipients are no longer room members. Review your selection.'
      return
    }
    intentUser = options.userId.value
    intents.set(options.roomId.value, {
      roomId: options.roomId.value,
      userId: options.userId.value,
      content,
      ids,
      ...(ids.length ? { key: crypto.randomUUID() } : {}),
      createdAt: Date.now(),
      epoch: intentEpoch,
      pending: false,
      uncertain: false,
      error: '',
    })
    await execute(intents.get(options.roomId.value)!)
  }
  async function retry() {
    const intent = current.value
    if (intent) await execute(intent)
  }
  return {
    selectedIds,
    sending,
    locked,
    error,
    cooldownSeconds: cooldown.remaining,
    expired,
    send,
    retry,
    discard,
  }
}
