<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import { api, errorMessage } from '../lib/api'
import { queryClient, queryKeys } from '../lib/query'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const profileQuery = useQuery({
  queryKey: queryKeys.profile,
  queryFn: ({ signal }) => api.profile(signal),
})
const roomsQuery = useQuery({
  queryKey: queryKeys.rooms,
  queryFn: ({ signal }) => api.rooms(signal),
})
const invitationsQuery = useQuery({
  queryKey: queryKeys.invitations,
  queryFn: ({ signal }) => api.invitations(signal),
})
const profile = computed(() => profileQuery.data.value)
const rooms = computed(() => roomsQuery.data.value?.rooms || [])
const invitations = computed(() => invitationsQuery.data.value?.invitations || [])
const loadingRooms = computed(() => roomsQuery.isPending.value)
const roomName = ref('')
const visibility = ref<'public' | 'private'>('private')
const joinId = ref('')
const creating = ref(false)
const joining = ref(false)
const createMutation = useMutation({
  mutationFn: ({ name, visibility }: { name: string; visibility: 'public' | 'private' }) =>
    api.createRoom(name, visibility),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
})
const joinMutation = useMutation({
  mutationFn: (id: number) => api.joinRoom(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
})
const respondMutation = useMutation({
  mutationFn: ({ id, action }: { id: number; action: 'accept' | 'decline' }) =>
    api.respondInvitation(id, action),
  onSuccess: () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
    ]),
})
const busy = computed(
  () =>
    createMutation.isPending.value ||
    joinMutation.isPending.value ||
    respondMutation.isPending.value,
)
const error = ref('')
const activeRoomId = computed(() => Number(route.params.id))
const hasDetail = computed(() => route.path !== '/app')

watch(
  () => auth.signedIn,
  (signedIn) => {
    if (!signedIn) router.replace('/login')
  },
)

watch(
  [profileQuery.error, roomsQuery.error, invitationsQuery.error],
  ([profileError, roomsError, invitationsError]) => {
    const cause = profileError || roomsError || invitationsError
    if (cause) error.value = errorMessage(cause)
  },
)

async function createRoom() {
  if (!roomName.value.trim() || busy.value) return
  error.value = ''
  try {
    const room = await createMutation.mutateAsync({
      name: roomName.value.trim(),
      visibility: visibility.value,
    })
    roomName.value = ''
    creating.value = false
    await router.push(`/app/rooms/${room.id}`)
  } catch (cause) {
    error.value = errorMessage(cause)
  }
}

async function joinRoom() {
  const id = Number(joinId.value)
  if (!Number.isSafeInteger(id) || id <= 0 || busy.value) return
  error.value = ''
  try {
    await joinMutation.mutateAsync(id)
    joinId.value = ''
    joining.value = false
    await router.push(`/app/rooms/${id}`)
  } catch (cause) {
    error.value = errorMessage(cause)
  }
}

async function respond(id: number, action: 'accept' | 'decline') {
  if (busy.value) return
  error.value = ''
  try {
    await respondMutation.mutateAsync({ id, action })
  } catch (cause) {
    error.value = errorMessage(cause)
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
          ><span class="count">{{ rooms.length.toString().padStart(2, '0') }}</span>
        </div>
        <p v-if="loadingRooms" class="sidebar-note">Loading rooms...</p>
        <p v-else-if="!rooms.length" class="sidebar-note">No rooms yet. Create your first room.</p>
        <nav class="room-list" aria-label="Room list">
          <RouterLink
            v-for="room in rooms"
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
          ><span class="count">{{ invitations.length.toString().padStart(2, '0') }}</span>
        </div>
        <p v-if="!invitations.length" class="sidebar-note">No pending invitations.</p>
        <div v-for="invitation in invitations" :key="invitation.id" class="invite-card">
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
            profile?.username?.slice(0, 1).toUpperCase() || '?'
          }}</span>
          <span class="profile-copy"
            ><strong>{{ profile?.username || 'Loading...' }}</strong
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
