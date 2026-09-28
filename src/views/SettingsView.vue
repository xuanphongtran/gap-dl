<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { api, errorMessage } from '../lib/api'
import { queryClient, queryKeys } from '../lib/query'
import { useAuthStore } from '../stores/auth'
import type { Profile } from '../types'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const avatarUrl = ref('')
const feedback = ref('')
const profileQuery = useQuery({
  queryKey: queryKeys.profile,
  queryFn: ({ signal }) => api.profile(signal),
})
const profile = computed(() => profileQuery.data.value)
const saveMutation = useMutation({
  mutationFn: (body: { username: string; avatar_url: string }) => api.updateProfile(body),
  onSuccess: (updated) => queryClient.setQueryData<Profile>(queryKeys.profile, updated),
})
const deleteMutation = useMutation({ mutationFn: api.deleteAccount })
const busy = computed(() => saveMutation.isPending.value || deleteMutation.isPending.value)

watch(
  profile,
  (value) => {
    if (!value) return
    username.value = value.username
    avatarUrl.value = value.avatar_url || ''
  },
  { immediate: true },
)
watch(profileQuery.error, (cause) => {
  if (cause) feedback.value = errorMessage(cause)
})

async function save() {
  if (busy.value || !username.value.trim()) return
  feedback.value = ''
  try {
    await saveMutation.mutateAsync({
      username: username.value.trim(),
      avatar_url: avatarUrl.value.trim(),
    })
    feedback.value = 'Profile saved.'
  } catch (cause) {
    feedback.value = errorMessage(cause)
  }
}

async function removeAccount() {
  if (!window.confirm('Permanently delete your account? This cannot be undone.')) return
  feedback.value = ''
  try {
    await deleteMutation.mutateAsync()
    auth.logout()
    await router.replace('/register')
  } catch (cause) {
    feedback.value = errorMessage(cause)
  }
}
</script>

<template>
  <main class="settings-page">
    <RouterLink to="/app" class="text-button">← Back to rooms</RouterLink>
    <p class="eyebrow">PLAYER SETTINGS / 001</p>
    <h1>Your profile</h1>
    <p class="muted">Update how you appear in chat rooms.</p>
    <section class="settings-card pixel-panel">
      <div class="settings-avatar pixel-avatar">
        {{ profile?.username?.slice(0, 1).toUpperCase() || '?' }}
      </div>
      <form class="stack-lg" @submit.prevent="save">
        <label class="field"><span>Display name</span><input v-model="username" required /></label
        ><label class="field"
          ><span>Avatar URL</span
          ><input
            v-model="avatarUrl"
            type="url"
            placeholder="https://example.com/avatar.png" /></label
        ><label class="field"
          ><span>Email</span><input :value="profile?.email || ''" readonly
        /></label>
        <p v-if="feedback" class="alert" role="status">{{ feedback }}</p>
        <button class="pixel-button primary" :disabled="busy">SAVE CHANGES</button>
      </form>
    </section>
    <section class="danger-zone">
      <h2>Danger zone</h2>
      <p class="muted">Account deletion follows the server's data retention rules.</p>
      <button class="pixel-button danger" :disabled="busy" @click="removeAccount">
        DELETE ACCOUNT
      </button>
    </section>
  </main>
</template>
