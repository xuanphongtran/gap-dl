<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage } from '../lib/api'
import { readSession } from '../lib/session'
import { useAuthStore } from '../stores/auth'
import { useRoomsStore } from '../stores/rooms'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const roomStore = useRoomsStore()
const roomName = ref('')
const visibility = ref<'public' | 'private'>('private')
const joinId = ref('')
const creating = ref(false)
const joining = ref(false)
const busy = ref(false)
const error = ref('')
const activeRoomId = computed(() => Number(route.params.id))
const hasDetail = computed(() => route.path !== '/app')

watch(
  () => auth.signedIn,
  (signedIn) => {
    if (!signedIn) router.replace('/login')
  },
)

onMounted(async () => {
  try {
    await Promise.all([auth.loadProfile(), roomStore.load()])
  } catch (cause) {
    if (!readSession()) {
      auth.logout()
      await router.replace('/login')
    } else error.value = errorMessage(cause)
  }
})

async function createRoom() {
  if (!roomName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const room = await roomStore.create(roomName.value.trim(), visibility.value)
    roomName.value = ''
    creating.value = false
    await router.push(`/app/rooms/${room.id}`)
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function joinRoom() {
  const id = Number(joinId.value)
  if (!Number.isSafeInteger(id) || id <= 0 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await roomStore.join(id)
    joinId.value = ''
    joining.value = false
    await router.push(`/app/rooms/${id}`)
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function respond(id: number, action: 'accept' | 'decline') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await roomStore.respond(id, action)
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function logout() {
  auth.logout()
  await router.replace('/login')
}

function toggleCreate() {
  creating.value = !creating.value
  joining.value = false
}

function toggleJoin() {
  joining.value = !joining.value
  creating.value = false
}
</script>

<template>
  <div class="app-layout" :class="{ 'has-detail': hasDetail }">
    <aside class="sidebar" aria-label="Chat room navigation">
      <div class="sidebar-top">
        <RouterLink class="brand-mark small" to="/app"
          >G<span>O</span>GO<span class="brand-cursor">_</span>DL</RouterLink
        >
        <div class="workspace-label"><span class="status-dot"></span> WORKSPACE / ONLINE</div>
      </div>

      <div class="sidebar-scroll">
        <div class="section-heading">
          <span>CHAT ROOMS</span
          ><span class="count">{{ roomStore.rooms.length.toString().padStart(2, '0') }}</span>
        </div>
        <p v-if="roomStore.loading" class="sidebar-note">Loading rooms...</p>
        <p v-else-if="!roomStore.rooms.length" class="sidebar-note">
          No rooms yet. Create your first room.
        </p>
        <nav class="room-list" aria-label="Room list">
          <RouterLink
            v-for="room in roomStore.rooms"
            :key="room.id"
            :to="`/app/rooms/${room.id}`"
            class="room-link"
            :class="{ active: activeRoomId === room.id }"
          >
            <span class="room-glyph">{{ room.visibility === 'private' ? '◆' : '#' }}</span>
            <span class="room-name">{{ room.name }}</span>
            <span class="room-arrow">›</span>
          </RouterLink>
        </nav>
        <button class="pixel-button primary full sidebar-action" @click="toggleCreate">
          ＋ CREATE ROOM
        </button>
        <form v-if="creating" class="sidebar-form pixel-panel" @submit.prevent="createRoom">
          <label class="field"
            ><span>Room name</span
            ><input v-model="roomName" maxlength="80" required placeholder="Room name"
          /></label>
          <label class="field"
            ><span>Visibility</span
            ><select v-model="visibility">
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select></label
          >
          <button class="pixel-button full" :disabled="busy">CREATE</button>
        </form>
        <button class="text-button sidebar-secondary" @click="toggleJoin">
          ↳ Join with a room ID
        </button>
        <form v-if="joining" class="sidebar-form pixel-panel" @submit.prevent="joinRoom">
          <label class="field"
            ><span>Public room ID</span
            ><input v-model="joinId" type="number" min="1" required placeholder="For example: 42"
          /></label>
          <button class="pixel-button full" :disabled="busy">JOIN ROOM</button>
        </form>

        <div class="section-heading invitations-title">
          <span>INVITATIONS</span
          ><span class="count">{{ roomStore.invitations.length.toString().padStart(2, '0') }}</span>
        </div>
        <p v-if="!roomStore.invitations.length" class="sidebar-note">No pending invitations.</p>
        <div v-for="invitation in roomStore.invitations" :key="invitation.id" class="invite-card">
          <strong>{{ invitation.room_name }}</strong>
          <span class="muted">Room #{{ invitation.room_id }}</span>
          <div class="invite-actions">
            <button :disabled="busy" @click="respond(invitation.id, 'accept')">ACCEPT</button>
            <button :disabled="busy" @click="respond(invitation.id, 'decline')">DECLINE</button>
          </div>
        </div>
        <p v-if="error" class="alert error sidebar-error" role="alert">{{ error }}</p>
      </div>

      <div class="sidebar-footer">
        <RouterLink class="profile-link" to="/app/settings">
          <span class="pixel-avatar">{{
            auth.profile?.username?.slice(0, 1).toUpperCase() || '?'
          }}</span>
          <span class="profile-copy"
            ><strong>{{ auth.profile?.username || 'Loading...' }}</strong
            ><small>View profile</small></span
          >
          <span>⚙</span>
        </RouterLink>
        <button class="text-button logout-button" @click="logout">↪ Sign out</button>
      </div>
    </aside>
    <div class="content-pane">
      <RouterView />
    </div>
  </div>
</template>
