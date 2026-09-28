<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import { api, errorMessage } from '../lib/api'
import { mergeMessages } from '../lib/messages'
import { queryClient, queryKeys } from '../lib/query'
import type { Message } from '../types'

const route = useRoute()
const router = useRouter()
const roomId = computed(() => Number(route.params.id))
const validRoom = computed(() => Number.isSafeInteger(roomId.value) && roomId.value > 0)
const roomQuery = useQuery({
  queryKey: computed(() => queryKeys.room(roomId.value)),
  queryFn: ({ signal }) => api.room(roomId.value, signal),
  enabled: validRoom,
})
const membersQuery = useQuery({
  queryKey: computed(() => queryKeys.members(roomId.value)),
  queryFn: ({ signal }) => api.members(roomId.value, signal),
  enabled: validRoom,
})
const profileQuery = useQuery({
  queryKey: queryKeys.profile,
  queryFn: ({ signal }) => api.profile(signal),
})
const latestQuery = useQuery({
  queryKey: computed(() => queryKeys.latestMessages(roomId.value)),
  queryFn: async ({ signal }) =>
    (await api.messages(roomId.value, 40, undefined, signal)).messages || [],
  enabled: validRoom,
  refetchInterval: 5000,
})
const historyQuery = useInfiniteQuery({
  queryKey: computed(() => queryKeys.messageHistory(roomId.value)),
  queryFn: async ({ pageParam, signal }) =>
    (await api.messages(roomId.value, 40, pageParam ?? undefined, signal)).messages || [],
  initialPageParam: null as number | null,
  getNextPageParam: (lastPage) =>
    lastPage.length === 40 ? Math.min(...lastPage.map((message) => message.id)) : undefined,
  enabled: validRoom,
  staleTime: Infinity,
})
const room = computed(() => roomQuery.data.value || null)
const members = computed(() => membersQuery.data.value?.members || [])
const profile = computed(() => profileQuery.data.value)
const messages = computed(() => {
  const history = historyQuery.data.value?.pages.flat() || []
  return mergeMessages(history, latestQuery.data.value || [])
})
const loading = computed(
  () => roomQuery.isPending.value || historyQuery.isPending.value || membersQuery.isPending.value,
)
const hasOlder = computed(() => historyQuery.hasNextPage.value)
const loadingOlder = computed(() => historyQuery.isFetchingNextPage.value)
const draft = ref('')
const draftByRoom = new Map<number, string>()
const showMembers = ref(false)
const inviteId = ref('')
const error = ref('')
const actionError = ref('')
const listEl = ref<HTMLElement | null>(null)
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

watch(roomId, (id, oldId) => {
  if (oldId) draftByRoom.set(oldId, draft.value)
  draft.value = draftByRoom.get(id) || ''
  error.value = ''
  actionError.value = ''
})

watch(messages, (_next, previous) => {
  const element = listEl.value
  const nearBottom =
    !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120
  if (nearBottom || !previous.length) scrollBottom()
})

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
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

const sendMutation = useMutation({
  mutationFn: ({ id, content }: { id: number; content: string }) => api.sendMessage(id, content),
})
const sending = computed(() => sendMutation.isPending.value)
async function send() {
  const content = draft.value.trim()
  if (!content || sending.value || !room.value) return
  error.value = ''
  const id = roomId.value
  try {
    const message = await sendMutation.mutateAsync({ id, content })
    queryClient.setQueryData<Message[]>(queryKeys.latestMessages(id), (current) =>
      mergeMessages(current || [], [message]),
    )
    if (id !== roomId.value) return
    draft.value = ''
    scrollBottom()
  } catch (cause) {
    if (id === roomId.value) error.value = errorMessage(cause)
  }
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
  if (!Number.isSafeInteger(userId) || userId <= 0 || actionBusy.value) return
  actionError.value = ''
  const id = roomId.value
  try {
    await inviteMutation.mutateAsync({ id, userId })
    if (id !== roomId.value) return
    inviteId.value = ''
    actionError.value = 'Invitation sent.'
  } catch (cause) {
    if (id === roomId.value) actionError.value = errorMessage(cause)
  }
}

async function memberAction(userId: number, action: 'remove' | 'moderator' | 'member' | 'owner') {
  if (actionBusy.value) return
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
    if (id === roomId.value) actionError.value = errorMessage(cause)
  }
}

async function leave() {
  if (!window.confirm('Leave this room?') || actionBusy.value) return
  actionError.value = ''
  const id = roomId.value
  try {
    await leaveMutation.mutateAsync(id)
    await router.push('/app')
    queryClient.removeQueries({ queryKey: queryKeys.room(id) })
  } catch (cause) {
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
          <span class="header-separator">·</span> {{ members.length }} members
        </p>
      </div>
      <button
        class="pixel-button header-action"
        :aria-expanded="showMembers"
        @click="showMembers = !showMembers"
      >
        ☷ <span>MEMBERS</span>
      </button>
    </header>

    <div class="chat-body">
      <section class="conversation" aria-label="Room messages">
        <div ref="listEl" class="message-list" role="log" aria-live="polite">
          <div v-if="loading" class="message-state">Loading conversation...</div>
          <div v-else-if="!messages.length && !visibleError" class="message-state">
            <span class="state-icon">✦</span><strong>No messages yet</strong
            ><span>Say hello to get started!</span>
          </div>
          <button
            v-if="hasOlder && messages.length"
            class="load-older"
            :disabled="loadingOlder"
            @click="loadOlder"
          >
            {{ loadingOlder ? 'LOADING...' : '↑ LOAD OLDER MESSAGES' }}
          </button>
          <div v-for="(message, index) in messages" :key="message.id">
            <div
              v-if="
                index === 0 ||
                formatDate(messages[index - 1]!.created_at) !== formatDate(message.created_at)
              "
              class="date-divider"
            >
              <span>{{ formatDate(message.created_at) }}</span>
            </div>
            <article class="message-row" :class="{ mine: message.user_id === profile?.id }">
              <span class="pixel-avatar message-avatar">{{
                message.username.slice(0, 1).toUpperCase()
              }}</span>
              <div class="message-content">
                <div class="message-meta">
                  <strong>{{ message.user_id === profile?.id ? 'You' : message.username }}</strong
                  ><time :datetime="message.created_at">{{ formatTime(message.created_at) }}</time>
                </div>
                <p>{{ message.content }}</p>
              </div>
            </article>
          </div>
        </div>
        <div class="composer-wrap">
          <p v-if="visibleError" class="alert error" role="alert">{{ visibleError }}</p>
          <form class="composer" @submit.prevent="send">
            <label class="sr-only" for="message-input">Message content</label
            ><textarea
              id="message-input"
              v-model="draft"
              rows="1"
              placeholder="Write a message..."
              :disabled="!room || sending"
              @keydown.enter.exact.prevent="send"
            ></textarea
            ><button
              class="pixel-button primary send-button"
              type="submit"
              :disabled="!draft.trim() || !room || sending"
              :aria-label="sending ? 'Sending' : 'Send message'"
            >
              {{ sending ? '...' : '➤' }}
            </button>
          </form>
          <div class="composer-hint">
            <span>ENTER TO SEND · SHIFT + ENTER FOR NEW LINE</span><span>HTTP SYNC / 5S</span>
          </div>
        </div>
      </section>

      <aside v-if="showMembers" class="members-panel" aria-label="Room members">
        <div class="panel-heading">
          <span>MEMBERS</span
          ><button class="icon-button" aria-label="Close member list" @click="showMembers = false">
            ×
          </button>
        </div>
        <p class="muted panel-subtitle">{{ members.length }} people in this room</p>
        <div class="member-list">
          <div v-for="member in members" :key="member.user_id" class="member-row">
            <span class="pixel-avatar">{{ member.username.slice(0, 1).toUpperCase() }}</span>
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
                  :disabled="actionBusy"
                  @click="memberAction(member.user_id, 'moderator')"
                >
                  Make moderator</button
                ><button
                  v-if="room?.role === 'owner' && member.role === 'moderator'"
                  :disabled="actionBusy"
                  @click="memberAction(member.user_id, 'member')"
                >
                  Make member</button
                ><button
                  v-if="room?.role === 'owner'"
                  :disabled="actionBusy"
                  @click="memberAction(member.user_id, 'owner')"
                >
                  Transfer ownership</button
                ><button
                  v-if="room?.role === 'owner' || member.role === 'member'"
                  :disabled="actionBusy"
                  @click="memberAction(member.user_id, 'remove')"
                >
                  Remove from room
                </button>
              </div>
            </details>
          </div>
        </div>
        <form v-if="canManage" class="invite-form" @submit.prevent="invite">
          <label class="field"
            ><span>INVITE BY USER ID</span
            ><input
              v-model="inviteId"
              type="number"
              min="1"
              required
              placeholder="Enter a user ID" /></label
          ><button class="pixel-button full" :disabled="actionBusy">＋ SEND INVITE</button>
        </form>
        <p v-if="actionError" class="panel-feedback" role="status">{{ actionError }}</p>
        <button class="text-button leave-button" :disabled="actionBusy" @click="leave">
          ↪ Leave room
        </button>
      </aside>
    </div>
  </main>
</template>
