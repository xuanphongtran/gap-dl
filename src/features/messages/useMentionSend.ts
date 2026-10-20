import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { useEventListener, useIntervalFn, useTimestamp } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { MAX_MESSAGE_BYTES, messageContentBytes } from '../../lib/messages'
import { queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import { useActionCooldown } from '../../lib/rate-limit'
import type { AttachmentSummary, Message, Room, RoomMember } from '../../types'

type ReadRef<T> = Readonly<Ref<T>>
interface Options {
  roomId: ReadRef<number>
  userId: ReadRef<number | undefined>
  enabled: ReadRef<boolean>
  members: ReadRef<RoomMember[]>
  draft: Ref<string>
  attachments?: ReadRef<AttachmentSummary[]>
  attachmentsBlocked?: ReadRef<boolean>
  onIntentCreated?: (roomId: number, ids: number[]) => void
  onIntentSettled?: (
    roomId: number,
    ids: number[],
    outcome: 'sent' | 'editable' | 'discarded',
  ) => void
  onSuccess: (roomId: number, message: Message) => void
  onAccessLost: (roomId: number) => void
}
interface Intent {
  roomId: number
  userId: number
  content: string
  ids: number[]
  attachments: AttachmentSummary[]
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
    mutationFn: (intent: Intent) => {
      if (
        intent.epoch !== intentEpoch ||
        intent.userId !== options.userId.value ||
        intents.get(intent.roomId) !== intent ||
        !readSession()
      )
        throw new ApiError(0, 'Send cancelled after the session or room access changed.')
      return api.sendMessage(
        intent.roomId,
        intent.content,
        intent.key
          ? {
              mentionUserIds: intent.ids,
              attachmentIds: intent.attachments.map((a) => a.id),
              idempotencyKey: intent.key,
            }
          : undefined,
      )
    },
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
      selectedIds.value = current.value ? [...current.value.ids] : []
      if (current.value) options.draft.value = current.value.content
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
    const intent = current.value
    if (intent)
      options.onIntentSettled?.(
        intent.roomId,
        intent.attachments.map((a) => a.id),
        'discarded',
      )
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
      options.onIntentSettled?.(
        intent.roomId,
        intent.attachments.map((a) => a.id),
        'sent',
      )
      options.onSuccess(intent.roomId, message)
      if (isCurrent) {
        options.draft.value = ''
        selectedIds.value = []
        error.value = ''
      }
    } catch (cause) {
      if (!active()) return
      if (cause instanceof ApiError && cause.status === 404 && intent.attachments.length) {
        try {
          const room = await api.room(intent.roomId)
          if (!active()) return
          if (room.role) {
            if (!intent.uncertain) {
              intents.delete(intent.roomId)
              options.onIntentSettled?.(
                intent.roomId,
                intent.attachments.map((a) => a.id),
                'editable',
              )
            }
            intent.error =
              'One or more files are unavailable. Review the conversation and remove unavailable files before sending again.'
            if (intent.roomId === options.roomId.value) error.value = intent.error
            return
          }
        } catch (checkError) {
          if (!active()) return
          if (!(checkError instanceof ApiError && [403, 404].includes(checkError.status))) {
            intent.uncertain = true
            intent.error =
              'Could not confirm room access. Check access before retrying this pending send.'
            if (intent.roomId === options.roomId.value) error.value = intent.error
            return
          }
        }
      }
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        intents.delete(intent.roomId)
        if (intent.roomId === options.roomId.value) options.onAccessLost(intent.roomId)
        return
      }
      const definite = cause instanceof ApiError && [400, 413, 429].includes(cause.status)
      if ((definite && !intent.uncertain) || !intent.key) {
        intents.delete(intent.roomId)
        options.onIntentSettled?.(
          intent.roomId,
          intent.attachments.map((a) => a.id),
          'editable',
        )
      } else intent.uncertain = true
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
      cooldown.remaining.value ||
      options.attachmentsBlocked?.value
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
    const attachments = [
      ...new Map((options.attachments?.value || []).map((a) => [a.id, a])).values(),
    ]
      .sort((a, b) => a.id - b.id)
      .map((a) => ({ ...a }))
    if (
      attachments.length > 5 ||
      attachments.some((a) => !Number.isSafeInteger(a.id) || a.id <= 0 || a.verified !== true)
    ) {
      error.value = 'Choose up to five ready files.'
      return
    }
    try {
      options.onIntentCreated?.(
        options.roomId.value,
        attachments.map((a) => a.id),
      )
    } catch {
      error.value = 'Files must be ready and unexpired before sending.'
      return
    }
    intentUser = options.userId.value
    intents.set(options.roomId.value, {
      roomId: options.roomId.value,
      userId: options.userId.value,
      content,
      ids,
      attachments,
      ...(ids.length || attachments.length ? { key: crypto.randomUUID() } : {}),
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
    pendingAttachments: computed(() => current.value?.attachments || []),
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
