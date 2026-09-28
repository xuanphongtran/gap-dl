<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, errorMessage } from '../lib/api'
import { mergeMessages } from '../lib/messages'
import { useAuthStore } from '../stores/auth'
import { useRoomsStore } from '../stores/rooms'
import type { Message, Room, RoomMember } from '../types'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const roomStore = useRoomsStore()
const roomId = computed(() => Number(route.params.id))
const room = ref<Room | null>(null)
const messages = ref<Message[]>([])
const members = ref<RoomMember[]>([])
const draft = ref('')
const draftByRoom = new Map<number, string>()
const loading = ref(true)
const loadingOlder = ref(false)
const hasOlder = ref(true)
const sending = ref(false)
const syncing = ref(false)
const showMembers = ref(false)
const inviteId = ref('')
const actionBusy = ref(false)
const error = ref('')
const actionError = ref('')
const listEl = ref<HTMLElement | null>(null)
const roomController = ref<AbortController | null>(null)
const canManage = computed(() => room.value?.role === 'owner' || room.value?.role === 'moderator')

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

watch(
  roomId,
  (id, oldId, onCleanup) => {
    if (oldId) draftByRoom.set(oldId, draft.value)
    draft.value = draftByRoom.get(id) || ''
    room.value = null
    messages.value = []
    members.value = []
    loading.value = true
    hasOlder.value = true
    error.value = ''
    const controller = new AbortController()
    roomController.value = controller
    let active = true
    let timer: ReturnType<typeof setInterval> | undefined
    let visibilityHandler: (() => void) | undefined
    onCleanup(() => {
      active = false
      controller.abort()
      if (timer) clearInterval(timer)
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
    })

    if (!Number.isSafeInteger(id) || id <= 0) {
      error.value = 'Invalid room ID.'
      loading.value = false
      return
    }
    Promise.all([
      api.room(id, controller.signal),
      api.messages(id, 40, undefined, controller.signal),
      api.members(id, controller.signal),
    ])
      .then(([roomData, messageData, memberData]) => {
        if (!active) return
        room.value = roomData
        messages.value = mergeMessages([], messageData.messages || [])
        members.value = memberData.members || []
        hasOlder.value = (messageData.messages || []).length >= 40
        loading.value = false
        scrollBottom()
        const syncLatest = async () => {
          if (!active || document.hidden || syncing.value) return
          syncing.value = true
          try {
            const latest = await api.messages(id, 40, undefined, controller.signal)
            if (!active) return
            const atBottom = listEl.value
              ? listEl.value.scrollHeight - listEl.value.scrollTop - listEl.value.clientHeight < 120
              : true
            messages.value = mergeMessages(messages.value, latest.messages || [])
            if (atBottom) scrollBottom()
          } catch {
            /* Keep visible messages; next cycle retries. */
          } finally {
            syncing.value = false
          }
        }
        timer = setInterval(syncLatest, 5000)
        visibilityHandler = () => {
          if (!document.hidden) void syncLatest()
        }
        document.addEventListener('visibilitychange', visibilityHandler)
      })
      .catch((cause: unknown) => {
        if (!active) return
        loading.value = false
        error.value = errorMessage(cause)
      })
  },
  { immediate: true },
)

async function loadOlder() {
  if (!hasOlder.value || loadingOlder.value || !messages.value.length) return
  loadingOlder.value = true
  error.value = ''
  const id = roomId.value
  const before = messages.value[0]?.id
  const previousHeight = listEl.value?.scrollHeight || 0
  const previousTop = listEl.value?.scrollTop || 0
  try {
    const result = await api.messages(id, 40, before, roomController.value?.signal)
    if (id !== roomId.value) return
    messages.value = mergeMessages(messages.value, result.messages || [])
    hasOlder.value = (result.messages || []).length >= 40
    await nextTick()
    if (listEl.value)
      listEl.value.scrollTop = listEl.value.scrollHeight - previousHeight + previousTop
  } catch (cause) {
    if (id !== roomId.value || roomController.value?.signal.aborted) return
    error.value = errorMessage(cause)
  } finally {
    loadingOlder.value = false
  }
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  error.value = ''
  const id = roomId.value
  try {
    const message = await api.sendMessage(id, content)
    if (id !== roomId.value) return
    messages.value = mergeMessages(messages.value, [message])
    draft.value = ''
    scrollBottom()
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    sending.value = false
  }
}

async function invite() {
  const userId = Number(inviteId.value)
  if (!Number.isSafeInteger(userId) || userId <= 0 || actionBusy.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await api.invite(roomId.value, userId)
    inviteId.value = ''
    actionError.value = 'Invitation sent.'
  } catch (cause) {
    actionError.value = errorMessage(cause)
  } finally {
    actionBusy.value = false
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
  actionBusy.value = true
  actionError.value = ''
  try {
    if (action === 'remove') await api.removeMember(roomId.value, userId)
    else if (action === 'owner') await api.transferOwnership(roomId.value, userId)
    else await api.changeRole(roomId.value, userId, action)
    const [newMembers, newRoom] = await Promise.all([
      api.members(roomId.value),
      api.room(roomId.value),
    ])
    members.value = newMembers.members || []
    room.value = newRoom
    await roomStore.load()
  } catch (cause) {
    actionError.value = errorMessage(cause)
  } finally {
    actionBusy.value = false
  }
}

async function leave() {
  if (!window.confirm('Leave this room?')) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await api.leaveRoom(roomId.value)
    await roomStore.load()
    await router.push('/app')
  } catch (cause) {
    actionError.value = errorMessage(cause)
  } finally {
    actionBusy.value = false
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
          <div v-else-if="!messages.length && !error" class="message-state">
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
            <article class="message-row" :class="{ mine: message.user_id === auth.profile?.id }">
              <span class="pixel-avatar message-avatar">{{
                message.username.slice(0, 1).toUpperCase()
              }}</span>
              <div class="message-content">
                <div class="message-meta">
                  <strong>{{
                    message.user_id === auth.profile?.id ? 'You' : message.username
                  }}</strong
                  ><time :datetime="message.created_at">{{ formatTime(message.created_at) }}</time>
                </div>
                <p>{{ message.content }}</p>
              </div>
            </article>
          </div>
        </div>
        <div class="composer-wrap">
          <p v-if="error" class="alert error" role="alert">{{ error }}</p>
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
                member.user_id !== auth.profile?.id &&
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
