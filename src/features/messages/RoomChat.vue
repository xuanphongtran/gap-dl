<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import RoomMessageSearch from './RoomMessageSearch.vue'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelEmptyState from '../../components/base/PixelEmptyState.vue'
import PixelField from '../../components/base/PixelField.vue'
import MessageComposer from './MessageComposer.vue'
import MentionRecipientPicker from './MentionRecipientPicker.vue'
import { useMentionSend } from './useMentionSend'
import MessageRow from './MessageRow.vue'
import { invalidateRoomSearch } from './message-search'
import { useViewedReadState } from './useViewedReadState'
import { realtimeKey } from '../rooms/realtime-context'
import { api, ApiError, errorMessage } from '../../lib/api'
import { readSession } from '../../lib/session'
import { MAX_MESSAGE_BYTES, mergeMessages, messageContentBytes } from '../../lib/messages'
import { clearRoomQueries, queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown, useKeyedActionCooldown } from '../../lib/rate-limit'
import type { Message } from '../../types'

const realtime = inject(realtimeKey, undefined)
const realtimePaused = ref(false)
const searchOpen = ref(false)
const searchButton = ref<InstanceType<typeof PixelButton> | null>(null)
let searchScrollTop = 0
function openSearch() {
  if (!canReadPrivateData.value || !profile.value?.id) return
  searchScrollTop = listEl.value?.scrollTop || 0
  searchOpen.value = true
}
function closeSearch(restore = true) {
  if (!searchOpen.value) return
  const id = roomId.value,
    user = profile.value?.id
  searchOpen.value = false
  if (!restore) return
  restoringScroll = true
  void nextTick(() => {
    if (id === roomId.value && user === profile.value?.id && isMember.value && !searchOpen.value) {
      if (listEl.value) listEl.value.scrollTop = searchScrollTop
      const button = searchButton.value?.$el
      if (button instanceof HTMLElement) button.focus()
    }
    void nextTick(() => {
      restoringScroll = false
    })
  })
}
useEventListener(window, 'session:changed', (event: Event) => {
  if (!readSession() || (event instanceof CustomEvent && event.detail?.accountChanged === true))
    closeSearch(false)
})
const seenEpoch = ref(0)
let recoveringScrollTop = 0
let restoringScroll = false
const route = useRoute()
const router = useRouter()
const roomId = computed(() => Number(route.params.id))
const validRoom = computed(() => Number.isSafeInteger(roomId.value) && roomId.value > 0)
const accessLost = ref(false)
const canReadRoom = computed(() => validRoom.value && !accessLost.value)
const roomQuery = useQuery({
  queryKey: computed(() => queryKeys.room(roomId.value)),
  queryFn: ({ signal }) => api.room(roomId.value, signal),
  enabled: canReadRoom,
})
const isMember = computed(() => !!roomQuery.data.value?.role && !accessLost.value)
const canReadPrivateData = computed(
  () => canReadRoom.value && isMember.value && !realtimePaused.value,
)
const membersQuery = useQuery({
  queryKey: computed(() => queryKeys.members(roomId.value)),
  queryFn: ({ signal }) => api.members(roomId.value, signal),
  enabled: canReadPrivateData,
})
const profileQuery = useQuery({
  queryKey: queryKeys.profile,
  queryFn: ({ signal }) => api.profile(signal),
})
const latestQuery = useQuery({
  queryKey: computed(() => queryKeys.latestMessages(roomId.value)),
  queryFn: async ({ signal }) =>
    (await api.messages(roomId.value, 40, undefined, signal)).messages || [],
  enabled: canReadPrivateData,
  refetchInterval: 5000,
})
const historyQuery = useInfiniteQuery({
  queryKey: computed(() => queryKeys.messageHistory(roomId.value)),
  queryFn: async ({ pageParam, signal }) =>
    (await api.messages(roomId.value, 40, pageParam ?? undefined, signal)).messages || [],
  initialPageParam: null as number | null,
  getNextPageParam: (lastPage) =>
    lastPage.length === 40 ? Math.min(...lastPage.map((message) => message.id)) : undefined,
  enabled: canReadPrivateData,
  staleTime: Infinity,
})
const room = computed(() => (accessLost.value ? null : roomQuery.data.value || null))
const members = computed(() => (isMember.value ? membersQuery.data.value?.members || [] : []))
const profile = computed(() => profileQuery.data.value)
const seenMessages = new Map<number, Message[]>()
const messages = computed(() => {
  if (!isMember.value) return []
  void seenEpoch.value
  const history = historyQuery.data.value
    ? queryClient
        .getQueryData<{ pages: Message[][] }>(queryKeys.messageHistory(roomId.value))
        ?.pages.flat() || []
    : []
  const latest = latestQuery.data.value
    ? queryClient.getQueryData<Message[]>(queryKeys.latestMessages(roomId.value)) || []
    : []
  const merged = mergeMessages(seenMessages.get(roomId.value) || [], [...history, ...latest])
  seenMessages.set(roomId.value, merged)
  return merged
})
const loading = computed(
  () =>
    roomQuery.isPending.value ||
    (isMember.value && (historyQuery.isPending.value || membersQuery.isPending.value)),
)
const hasOlder = computed(() => historyQuery.hasNextPage.value)
const loadingOlder = computed(() => historyQuery.isFetchingNextPage.value)
const draft = ref('')
const draftByRoom = new Map<number, string>()
const showMembers = ref(false)
const inviteId = ref('')
const error = ref('')
const actionError = ref('')

const editCooldowns = useKeyedActionCooldown()
const deleteCooldowns = useKeyedActionCooldown()
const editingMessageId = ref<number | null>(null)
const editDraft = ref('')
const editRevision = ref(0)
const editError = ref('')
const editConflict = ref<Message | null>(null)
const inviteCooldown = useActionCooldown()
const memberCooldowns = useKeyedActionCooldown()
const lastMemberCooldownKey = ref('')
const leaveCooldown = useActionCooldown()
const joinCooldown = useActionCooldown()
const joinError = ref('')
const listEl = ref<HTMLElement | null>(null)
const readState = useViewedReadState(
  roomId,
  computed(() => profile.value?.id),
  computed(() => canReadPrivateData.value && !searchOpen.value),
  listEl,
  messages,
  loseRoomAccess,
)
const canManage = computed(() => room.value?.role === 'owner' || room.value?.role === 'moderator')
const queryError = computed(
  () =>
    roomQuery.error.value ||
    membersQuery.error.value ||
    historyQuery.error.value ||
    latestQuery.error.value,
)
const visibleError = computed(
  () =>
    error.value ||
    (validRoom.value ? queryError.value && errorMessage(queryError.value) : 'Invalid room ID.'),
)

watch(
  roomId,
  (id, oldId) => {
    closeSearch(false)
    if (oldId) draftByRoom.set(oldId, draft.value)
    draft.value = draftByRoom.get(id) || ''
    error.value = ''
    actionError.value = ''
    lastMemberCooldownKey.value = ''
    joinError.value = ''
    accessLost.value = false
    realtimePaused.value = false
    closeEditor()
  },
  { flush: 'sync' },
)

watch([() => profile.value?.id, isMember], () => closeSearch(false), { flush: 'sync' })

watch(
  [roomId, () => profile.value?.id, isMember],
  ([id, userId, member], _previous, onCleanup) => {
    if (!realtime || !member || !userId) return
    const unregister = realtime.registerRoom({
      id,
      userId,
      messages: () => messages.value,
      setPaused: (paused) => {
        if (id !== roomId.value) return
        if (paused && !realtimePaused.value) recoveringScrollTop = listEl.value?.scrollTop || 0
        const resume = !paused && realtimePaused.value
        realtimePaused.value = paused
        if (resume) restoringScroll = true
        if (resume)
          void nextTick(() => {
            if (id === roomId.value && listEl.value) listEl.value.scrollTop = recoveringScrollTop
            void nextTick(() => {
              restoringScroll = false
            })
          })
      },
      applyRecovered: (incoming) => {
        if (id !== roomId.value) return
        seenMessages.set(id, mergeMessages(seenMessages.get(id) || [], incoming))
        seenEpoch.value++
      },
      reset: () => {
        seenMessages.delete(id)
        seenEpoch.value++
        closeEditor()
      },
      onAccessLost: () => loseRoomAccess(id),
    })
    onCleanup(unregister)
  },
  { immediate: true, flush: 'sync' },
)
onUnmounted(() => {
  realtimePaused.value = false
})

function closeEditor() {
  editingMessageId.value = null
  editDraft.value = ''
  editRevision.value = 0
  editError.value = ''
  editConflict.value = null
}

function openEditor(message: Message) {
  if (!isMember.value || message.deleted_at || message.user_id !== profile.value?.id) return
  editingMessageId.value = message.id
  editDraft.value = message.content
  editRevision.value = message.revision
  editError.value = ''
  editConflict.value = null
}

function loseRoomAccess(id: number) {
  if (id !== roomId.value || accessLost.value) return
  accessLost.value = true
  closeSearch(false)
  draft.value = ''
  draftByRoom.delete(id)
  seenMessages.delete(id)
  closeEditor()
  mentionSend.discard()
  clearRoomQueries(id)
  void router.replace('/app')
}

watch(queryError, (cause) => {
  if (cause instanceof ApiError && [403, 404].includes(cause.status)) loseRoomAccess(roomId.value)
})

watch(messages, (_next, previous) => {
  if (realtimePaused.value || restoringScroll) return
  const editing = _next.find((message) => message.id === editingMessageId.value)
  if (editing?.deleted_at && !editConflict.value) editConflict.value = editing
  if (searchOpen.value) return
  if (previous.length && _next.at(-1)?.id === previous.at(-1)?.id) return
  const element = listEl.value
  const nearBottom =
    !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120
  if (nearBottom || !previous.length) scrollBottom()
})

function scrollBottom() {
  if (searchOpen.value) return
  nextTick(() => {
    if (listEl.value && !realtimePaused.value && !searchOpen.value)
      listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function loadOlder() {
  if (!hasOlder.value || loadingOlder.value) return
  error.value = ''
  const id = roomId.value
  const previousHeight = listEl.value?.scrollHeight || 0
  const previousTop = listEl.value?.scrollTop || 0
  try {
    await historyQuery.fetchNextPage()
    if (id !== roomId.value) return
    await nextTick()
    if (listEl.value)
      listEl.value.scrollTop = listEl.value.scrollHeight - previousHeight + previousTop
  } catch (cause) {
    if (id === roomId.value) error.value = errorMessage(cause)
  }
}

const editMutation = useMutation({
  mutationFn: ({
    roomId,
    messageId,
    content,
    revision,
  }: {
    roomId: number
    messageId: number
    content: string
    revision: number
  }) => api.editMessage(roomId, messageId, content, revision),
})
const deleteMutation = useMutation({
  mutationFn: ({ roomId, messageId }: { roomId: number; messageId: number }) =>
    api.deleteMessage(roomId, messageId),
})

function applyMessageResult(id: number, message: Message) {
  if (id !== roomId.value || !isMember.value) return
  queryClient.setQueryData<Message[]>(queryKeys.latestMessages(id), (current) =>
    mergeMessages(current || [], [message]),
  )
  void invalidateRoomSearch(id)
  void queryClient.invalidateQueries({ queryKey: queryKeys.messageHistory(id), exact: true })
}

async function saveEdit() {
  const messageId = editingMessageId.value
  const content = editDraft.value.trim()
  const id = roomId.value
  const cooldownKey = `${id}:${messageId}:edit`
  if (
    messageId === null ||
    !isMember.value ||
    realtimePaused.value ||
    editMutation.isPending.value ||
    editCooldowns.remaining(cooldownKey) ||
    editConflict.value?.deleted_at ||
    !content
  )
    return
  if (messageContentBytes(content) > MAX_MESSAGE_BYTES) {
    editError.value = 'Message exceeds the 4000-byte UTF-8 limit.'
    return
  }
  editError.value = ''
  try {
    const updated = await editMutation.mutateAsync({
      roomId: id,
      messageId,
      content,
      revision: editRevision.value,
    })
    applyMessageResult(id, updated)
    if (id === roomId.value && editingMessageId.value === messageId) closeEditor()
  } catch (cause) {
    editCooldowns.start(cooldownKey, cause)
    if (id !== roomId.value || editingMessageId.value !== messageId) return
    if (cause instanceof ApiError && cause.status === 409) {
      const [latest, history] = await Promise.all([latestQuery.refetch(), historyQuery.refetch()])
      const fresh = mergeMessages(
        [],
        [...(latest.data || []), ...(history.data?.pages.flat() || [])],
      ).find((message) => message.id === messageId)
      if (fresh) {
        editConflict.value = fresh
        editRevision.value = fresh.revision
      } else editError.value = 'Could not load the current message. Keep this draft and try again.'
    } else {
      editError.value = errorMessage(cause)
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) void roomQuery.refetch()
    }
  }
}

async function deleteMessage(message: Message) {
  const id = roomId.value
  const cooldownKey = `${id}:${message.id}:delete`
  if (
    !isMember.value ||
    realtimePaused.value ||
    message.deleted_at ||
    deleteMutation.isPending.value ||
    deleteCooldowns.remaining(cooldownKey) ||
    !(message.user_id === profile.value?.id || canManage.value) ||
    !window.confirm('Delete this message?')
  )
    return
  error.value = ''
  try {
    const deleted = await deleteMutation.mutateAsync({ roomId: id, messageId: message.id })
    applyMessageResult(id, deleted)
    if (id === roomId.value && editingMessageId.value === message.id) closeEditor()
  } catch (cause) {
    deleteCooldowns.start(cooldownKey, cause)
    if (id === roomId.value) error.value = errorMessage(cause)
    if (cause instanceof ApiError && [403, 404].includes(cause.status)) void roomQuery.refetch()
  }
}
const joinMutation = useMutation({
  mutationFn: (id: number) => api.joinRoom(id),
  onSuccess: (_result, id) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.room(id), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
    ]),
})
async function joinPublicRoom() {
  if (joinMutation.isPending.value || joinCooldown.remaining.value) return
  const id = roomId.value
  joinError.value = ''
  try {
    await joinMutation.mutateAsync(id)
  } catch (cause) {
    joinCooldown.start(cause)
    if (id === roomId.value) joinError.value = errorMessage(cause)
  }
}
const mentionSend = useMentionSend({
  roomId,
  userId: computed(() => profile.value?.id),
  enabled: canReadPrivateData,
  members,
  draft,
  onAccessLost: loseRoomAccess,
  onSuccess: (id, message) => {
    applyMessageResult(id, message)
    draftByRoom.delete(id)
    if (id === roomId.value) scrollBottom()
  },
})
const sending = mentionSend.sending
async function send() {
  await mentionSend.send()
}
function discardPendingSend() {
  if (
    window.confirm(
      'The original message may already have been accepted. Discard this pending send?',
    )
  )
    mentionSend.discard()
}

const inviteMutation = useMutation({
  mutationFn: ({ id, userId }: { id: number; userId: number }) => api.invite(id, userId),
})
const memberMutation = useMutation({
  mutationFn: ({
    id,
    userId,
    action,
  }: {
    id: number
    userId: number
    action: 'remove' | 'moderator' | 'member' | 'owner'
  }) => {
    if (action === 'remove') return api.removeMember(id, userId)
    if (action === 'owner') return api.transferOwnership(id, userId)
    return api.changeRole(id, userId, action)
  },
  onSuccess: (_result, { id }) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.members(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.room(id), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
    ]),
})
const leaveMutation = useMutation({
  mutationFn: (id: number) => api.leaveRoom(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
})
const actionBusy = computed(
  () =>
    inviteMutation.isPending.value ||
    memberMutation.isPending.value ||
    leaveMutation.isPending.value,
)

async function invite() {
  const userId = Number(inviteId.value)
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    actionBusy.value ||
    inviteCooldown.remaining.value
  )
    return
  actionError.value = ''
  const id = roomId.value
  try {
    await inviteMutation.mutateAsync({ id, userId })
    if (id !== roomId.value) return
    inviteId.value = ''
    actionError.value = 'Invitation sent.'
  } catch (cause) {
    inviteCooldown.start(cause)
    if (id === roomId.value) actionError.value = errorMessage(cause)
  }
}

async function memberAction(userId: number, action: 'remove' | 'moderator' | 'member' | 'owner') {
  const key = `${roomId.value}:${userId}:${action}`
  if (actionBusy.value || memberCooldowns.remaining(key)) return
  if (
    !window.confirm(
      action === 'remove'
        ? 'Remove this member from the room?'
        : action === 'owner'
          ? 'Transfer room ownership?'
          : 'Change this member’s role?',
    )
  )
    return
  actionError.value = ''
  const id = roomId.value
  try {
    await memberMutation.mutateAsync({ id, userId, action })
  } catch (cause) {
    memberCooldowns.start(key, cause)
    lastMemberCooldownKey.value = key
    if (id === roomId.value) actionError.value = errorMessage(cause)
  }
}

async function leave() {
  if (!window.confirm('Leave this room?') || actionBusy.value || leaveCooldown.remaining.value)
    return
  actionError.value = ''
  const id = roomId.value
  try {
    await leaveMutation.mutateAsync(id)
    accessLost.value = true
    draft.value = ''
    draftByRoom.delete(id)
    seenMessages.delete(id)
    clearRoomQueries(id)
    await router.push('/app')
  } catch (cause) {
    leaveCooldown.start(cause)
    if (cause instanceof ApiError && cause.status === 404) {
      loseRoomAccess(id)
      return
    }
    actionError.value = errorMessage(cause)
  }
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(navigator.language || 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(navigator.language || 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
}
</script>

<template>
  <main class="chat-screen">
    <header class="chat-header">
      <RouterLink class="mobile-back" to="/app" aria-label="Back to room list">‹</RouterLink>
      <div class="channel-symbol">{{ room?.visibility === 'private' ? '◆' : '#' }}</div>
      <div class="chat-heading">
        <h1>{{ room?.name || (loading ? 'Loading...' : `Room #${roomId}`) }}</h1>
        <p>
          {{ room?.visibility === 'private' ? 'Private room' : 'Public room' }}
          <template v-if="isMember"
            ><span class="header-separator">·</span> {{ members.length }} members</template
          >
        </p>
      </div>
      <PixelButton
        ref="searchButton"
        v-if="isMember"
        class="header-action"
        aria-label="Search room messages"
        :aria-expanded="searchOpen"
        :disabled="!canReadPrivateData"
        @click="searchOpen ? closeSearch() : openSearch()"
        >⌕ <span>SEARCH</span></PixelButton
      >
      <PixelButton
        v-if="isMember"
        class="header-action"
        :aria-expanded="showMembers"
        @click="showMembers = !showMembers"
      >
        ☷ <span>MEMBERS</span>
      </PixelButton>
    </header>

    <div class="chat-body">
      <PixelEmptyState
        v-if="room && !isMember && room.visibility === 'public'"
        class="public-join-state"
      >
        <span class="state-icon">#</span>
        <strong>Public room</strong>
        <span>Join this room to read and send messages.</span>
        <PixelButton
          variant="primary"
          :disabled="joinMutation.isPending.value || !!joinCooldown.remaining.value"
          @click="joinPublicRoom"
        >
          {{
            joinCooldown.remaining.value ? `RETRY IN ${joinCooldown.remaining.value}s` : 'JOIN ROOM'
          }}
        </PixelButton>
        <PixelAlert v-if="joinError" tone="error">{{ joinError }}</PixelAlert>
      </PixelEmptyState>
      <section v-else class="conversation" aria-label="Room messages">
        <RoomMessageSearch
          v-if="searchOpen"
          :key="`${roomId}:${profile?.id}`"
          :room-id="roomId"
          :user-id="profile?.id"
          :enabled="canReadPrivateData"
          :known-messages="messages"
          @close="closeSearch()"
          @access-lost="loseRoomAccess"
        />
        <div
          v-show="!searchOpen"
          ref="listEl"
          class="message-list"
          role="log"
          aria-live="polite"
          @scroll="readState.measure"
        >
          <PixelEmptyState v-if="realtimePaused" class="message-state">
            <span v-if="realtime?.gapRoomId.value === roomId"
              >Some conversation history needs to be reloaded.</span
            >
            <span v-else-if="realtime?.status.value === 'offline'"
              >Offline. Reconnect to restore this conversation.</span
            >
            <span v-else>Checking conversation access and updates…</span>
            <PixelButton
              v-if="realtime?.gapRoomId.value === roomId"
              @click="realtime.reloadConversation"
              >RELOAD CONVERSATION</PixelButton
            >
            <PixelButton v-else-if="realtime?.status.value === 'fallback'" @click="realtime.retry"
              >RETRY</PixelButton
            >
          </PixelEmptyState>
          <PixelEmptyState v-else-if="loading" class="message-state"
            >Loading conversation...</PixelEmptyState
          >
          <PixelEmptyState v-else-if="!messages.length && !visibleError" class="message-state">
            <span class="state-icon">✦</span><strong>No messages yet</strong
            ><span>Say hello to get started!</span>
          </PixelEmptyState>
          <button
            v-if="!realtimePaused && hasOlder && messages.length"
            class="load-older"
            :disabled="loadingOlder"
            @click="loadOlder"
          >
            {{ loadingOlder ? 'LOADING...' : '↑ LOAD OLDER MESSAGES' }}
          </button>
          <div
            v-for="(message, index) in realtimePaused ? [] : messages"
            :key="message.id"
            :data-message-id="message.id"
          >
            <div
              v-if="
                index === 0 ||
                formatDate(messages[index - 1]!.created_at) !== formatDate(message.created_at)
              "
              class="date-divider"
            >
              <span>{{ formatDate(message.created_at) }}</span>
            </div>
            <MessageRow
              :message="message"
              :mine="message.user_id === profile?.id"
              :time="formatTime(message.created_at)"
              :can-edit="
                isMember &&
                message.user_id === profile?.id &&
                !message.deleted_at &&
                (editingMessageId === null || editingMessageId === message.id)
              "
              :can-delete="
                isMember && !message.deleted_at && (message.user_id === profile?.id || canManage)
              "
              :editing="editingMessageId === message.id"
              :edit-draft="editingMessageId === message.id ? editDraft : ''"
              :edit-error="editingMessageId === message.id ? editError : ''"
              :conflict="editingMessageId === message.id ? editConflict : null"
              :saving="editMutation.isPending.value && editingMessageId === message.id"
              :deleting="
                deleteMutation.isPending.value &&
                deleteMutation.variables.value?.messageId === message.id
              "
              :edit-cooldown="editCooldowns.remaining(`${roomId}:${message.id}:edit`)"
              :delete-cooldown="deleteCooldowns.remaining(`${roomId}:${message.id}:delete`)"
              @edit="openEditor(message)"
              @save="saveEdit"
              @cancel="closeEditor"
              @discard="closeEditor"
              @delete="deleteMessage(message)"
              @update:edit-draft="editDraft = $event"
            />
          </div>
        </div>
        <PixelAlert v-if="readState.error.value" tone="error">
          Read progress could not be saved. {{ readState.error.value }}
          <PixelButton :disabled="!!readState.retryAfter.value" @click="readState.retry">
            {{
              readState.retryAfter.value
                ? `RETRY IN ${readState.retryAfter.value}s`
                : 'RETRY READ STATE'
            }}
          </PixelButton>
        </PixelAlert>
        <MentionRecipientPicker
          v-if="profile?.id && isMember"
          v-model="mentionSend.selectedIds.value"
          :members="members"
          :user-id="profile.id"
          :disabled="!canReadPrivateData || sending || mentionSend.locked.value"
        />
        <PixelAlert v-if="mentionSend.locked.value && !sending" tone="info">
          {{
            mentionSend.expired.value
              ? 'Retry expired. Check the conversation before sending again.'
              : 'This send may already have been accepted. Retry uses the original recipients and message.'
          }}
          <PixelButton
            :disabled="
              !canReadPrivateData ||
              mentionSend.expired.value ||
              !!mentionSend.cooldownSeconds.value
            "
            @click="mentionSend.retry"
            >RETRY</PixelButton
          >
          <PixelButton @click="discardPendingSend">DISCARD PENDING SEND</PixelButton>
        </PixelAlert>
        <MessageComposer
          v-model="draft"
          :disabled="!isMember || realtimePaused"
          :sending="sending"
          :locked="mentionSend.locked.value"
          :cooldown-seconds="mentionSend.cooldownSeconds.value"
          :error="mentionSend.error.value || visibleError || ''"
          @send="send"
        />
      </section>

      <aside v-if="showMembers && isMember" class="members-panel" aria-label="Room members">
        <div class="panel-heading">
          <span>MEMBERS</span
          ><button class="icon-button" aria-label="Close member list" @click="showMembers = false">
            ×
          </button>
        </div>
        <p class="muted panel-subtitle">{{ members.length }} people in this room</p>
        <div class="member-list">
          <div v-for="member in members" :key="member.user_id" class="member-row">
            <PixelAvatar :name="member.username" />
            <div class="member-info">
              <strong>{{ member.username }}</strong
              ><small>{{ member.role }}</small>
            </div>
            <details
              v-if="
                canManage &&
                member.user_id !== profile?.id &&
                (room?.role === 'owner' || member.role === 'member')
              "
              class="member-menu"
            >
              <summary aria-label="Member options">⋮</summary>
              <div class="member-menu-content">
                <button
                  v-if="room?.role === 'owner' && member.role !== 'moderator'"
                  :disabled="
                    actionBusy ||
                    !!memberCooldowns.remaining(`${roomId}:${member.user_id}:moderator`)
                  "
                  @click="memberAction(member.user_id, 'moderator')"
                >
                  Make moderator</button
                ><button
                  v-if="room?.role === 'owner' && member.role === 'moderator'"
                  :disabled="
                    actionBusy || !!memberCooldowns.remaining(`${roomId}:${member.user_id}:member`)
                  "
                  @click="memberAction(member.user_id, 'member')"
                >
                  Make member</button
                ><button
                  v-if="room?.role === 'owner'"
                  :disabled="
                    actionBusy || !!memberCooldowns.remaining(`${roomId}:${member.user_id}:owner`)
                  "
                  @click="memberAction(member.user_id, 'owner')"
                >
                  Transfer ownership</button
                ><button
                  v-if="room?.role === 'owner' || member.role === 'member'"
                  :disabled="
                    actionBusy || !!memberCooldowns.remaining(`${roomId}:${member.user_id}:remove`)
                  "
                  @click="memberAction(member.user_id, 'remove')"
                >
                  Remove from room
                </button>
              </div>
            </details>
          </div>
        </div>
        <form v-if="canManage" class="invite-form" @submit.prevent="invite">
          <PixelField
            v-model="inviteId"
            label="INVITE BY USER ID"
            type="number"
            min="1"
            required
            placeholder="Enter a user ID"
          />
          <PixelButton
            full
            type="submit"
            :disabled="actionBusy || !!inviteCooldown.remaining.value"
          >
            {{
              inviteCooldown.remaining.value
                ? `RETRY IN ${inviteCooldown.remaining.value}s`
                : '＋ SEND INVITE'
            }}
          </PixelButton>
        </form>
        <p v-if="actionError" class="panel-feedback" role="status">{{ actionError }}</p>
        <p
          v-if="memberCooldowns.remaining(lastMemberCooldownKey)"
          class="panel-feedback"
          role="status"
        >
          This member action is available in
          {{ memberCooldowns.remaining(lastMemberCooldownKey) }} seconds.
        </p>
        <p v-if="room?.role === 'owner'" class="muted panel-subtitle">
          Transfer ownership before leaving this room.
        </p>
        <button
          class="text-button leave-button"
          :disabled="actionBusy || !!leaveCooldown.remaining.value || room?.role === 'owner'"
          @click="leave"
        >
          ↪ Leave room
        </button>
      </aside>
    </div>
  </main>
</template>
