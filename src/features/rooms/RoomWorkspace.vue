<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelField from '../../components/base/PixelField.vue'
import PixelPanel from '../../components/base/PixelPanel.vue'
import RoomUnreadBadge from './RoomUnreadBadge.vue'
import { api, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown, useKeyedActionCooldown } from '../../lib/rate-limit'
import { useAuthStore } from '../../stores/auth'

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
const createCooldown = useActionCooldown()
const joinCooldown = useActionCooldown()
const invitationCooldowns = useKeyedActionCooldown()
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
  if (!roomName.value.trim() || busy.value || createCooldown.remaining.value) return
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
    createCooldown.start(cause)
    error.value = errorMessage(cause)
  }
}

async function joinRoom() {
  const id = Number(joinId.value)
  if (!Number.isSafeInteger(id) || id <= 0 || busy.value || joinCooldown.remaining.value) return
  error.value = ''
  try {
    await joinMutation.mutateAsync(id)
    joinId.value = ''
    joining.value = false
    await router.push(`/app/rooms/${id}`)
  } catch (cause) {
    joinCooldown.start(cause)
    error.value = errorMessage(cause)
  }
}

async function respond(id: number, action: 'accept' | 'decline') {
  const key = `${id}:${action}`
  if (busy.value || invitationCooldowns.remaining(key)) return
  error.value = ''
  try {
    await respondMutation.mutateAsync({ id, action })
  } catch (cause) {
    invitationCooldowns.start(key, cause)
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
            <RoomUnreadBadge v-if="room.role && profile" :room-id="room.id" :user-id="profile.id" />
            <span class="room-arrow">›</span>
          </RouterLink>
        </nav>
        <PixelButton variant="primary" full class="sidebar-action" @click="toggleCreate">
          ＋ CREATE ROOM
        </PixelButton>
        <PixelPanel v-if="creating" as="form" class="sidebar-form" @submit.prevent="createRoom">
          <PixelField
            v-model="roomName"
            label="Room name"
            maxlength="100"
            required
            placeholder="Room name"
          />
          <PixelField v-model="visibility" as="select" label="Visibility">
            <option value="private">Private</option>
            <option value="public">Public</option>
          </PixelField>
          <PixelButton full type="submit" :disabled="busy || !!createCooldown.remaining.value">
            {{
              createCooldown.remaining.value
                ? `RETRY IN ${createCooldown.remaining.value}s`
                : 'CREATE'
            }}
          </PixelButton>
        </PixelPanel>
        <button class="text-button sidebar-secondary" @click="toggleJoin">
          ↳ Join with a room ID
        </button>
        <PixelPanel v-if="joining" as="form" class="sidebar-form" @submit.prevent="joinRoom">
          <PixelField
            v-model="joinId"
            label="Public room ID"
            type="number"
            min="1"
            required
            placeholder="For example: 42"
          />
          <PixelButton full type="submit" :disabled="busy || !!joinCooldown.remaining.value">
            {{
              joinCooldown.remaining.value
                ? `RETRY IN ${joinCooldown.remaining.value}s`
                : 'JOIN ROOM'
            }}
          </PixelButton>
        </PixelPanel>

        <div class="section-heading invitations-title">
          <span>INVITATIONS</span
          ><span class="count">{{ invitations.length.toString().padStart(2, '0') }}</span>
        </div>
        <p v-if="!invitations.length" class="sidebar-note">No pending invitations.</p>
        <div v-for="invitation in invitations" :key="invitation.id" class="invite-card">
          <strong>{{ invitation.room_name }}</strong>
          <span class="muted">Room #{{ invitation.room_id }}</span>
          <div class="invite-actions">
            <button
              :disabled="busy || !!invitationCooldowns.remaining(`${invitation.id}:accept`)"
              @click="respond(invitation.id, 'accept')"
            >
              {{
                invitationCooldowns.remaining(`${invitation.id}:accept`)
                  ? `RETRY IN ${invitationCooldowns.remaining(`${invitation.id}:accept`)}s`
                  : 'ACCEPT'
              }}
            </button>
            <button
              :disabled="busy || !!invitationCooldowns.remaining(`${invitation.id}:decline`)"
              @click="respond(invitation.id, 'decline')"
            >
              {{
                invitationCooldowns.remaining(`${invitation.id}:decline`)
                  ? `RETRY IN ${invitationCooldowns.remaining(`${invitation.id}:decline`)}s`
                  : 'DECLINE'
              }}
            </button>
          </div>
        </div>
        <PixelAlert v-if="error" tone="error" class="sidebar-error">{{ error }}</PixelAlert>
      </div>

      <div class="sidebar-footer">
        <RouterLink class="profile-link" to="/app/settings">
          <PixelAvatar :name="profile?.username" />
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
