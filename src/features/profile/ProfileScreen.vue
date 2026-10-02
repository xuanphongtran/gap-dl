<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelField from '../../components/base/PixelField.vue'
import PixelPanel from '../../components/base/PixelPanel.vue'
import { api, ApiError, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown } from '../../lib/rate-limit'
import { useAuthStore } from '../../stores/auth'
import type { Profile } from '../../types'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const avatarUrl = ref('')
const feedback = ref('')
const feedbackTone = ref<'info' | 'error'>('info')
const deleteFeedback = ref('')
const ownershipConflict = ref(false)
const saveCooldown = useActionCooldown()
const deleteCooldown = useActionCooldown()
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
  if (cause) {
    feedbackTone.value = 'error'
    feedback.value = errorMessage(cause)
  }
})

async function save() {
  if (busy.value || !username.value.trim() || saveCooldown.remaining.value) return
  feedback.value = ''
  try {
    await saveMutation.mutateAsync({
      username: username.value.trim(),
      avatar_url: avatarUrl.value.trim(),
    })
    feedbackTone.value = 'info'
    feedback.value = 'Profile saved.'
  } catch (cause) {
    saveCooldown.start(cause)
    feedbackTone.value = 'error'
    feedback.value = errorMessage(cause)
  }
}

async function removeAccount() {
  if (busy.value || deleteCooldown.remaining.value) return
  if (!window.confirm('Permanently delete your account? This cannot be undone.')) return
  deleteFeedback.value = ''
  ownershipConflict.value = false
  try {
    await deleteMutation.mutateAsync()
    auth.logout()
    await router.replace('/register')
  } catch (cause) {
    deleteCooldown.start(cause)
    ownershipConflict.value = cause instanceof ApiError && cause.status === 409
    deleteFeedback.value = errorMessage(cause)
  }
}
</script>

<template>
  <main class="settings-page">
    <RouterLink to="/app" class="text-button">← Back to rooms</RouterLink>
    <p class="eyebrow">PLAYER SETTINGS / 001</p>
    <h1>Your profile</h1>
    <p class="muted">Update how you appear in chat rooms.</p>
    <PixelPanel as="section" class="settings-card">
      <PixelAvatar class="settings-avatar" :name="profile?.username" />
      <form class="stack-lg" @submit.prevent="save">
        <PixelField v-model="username" label="Display name" minlength="3" maxlength="50" required />
        <PixelField
          v-model="avatarUrl"
          label="Avatar URL"
          type="url"
          placeholder="https://example.com/avatar.png"
        />
        <PixelField label="Email" :model-value="profile?.email || ''" readonly />
        <PixelAlert v-if="feedback" :tone="feedbackTone">{{ feedback }}</PixelAlert>
        <PixelButton
          variant="primary"
          type="submit"
          :disabled="busy || !!saveCooldown.remaining.value"
        >
          {{
            saveCooldown.remaining.value
              ? `RETRY IN ${saveCooldown.remaining.value}s`
              : 'SAVE CHANGES'
          }}
        </PixelButton>
      </form>
    </PixelPanel>
    <section class="danger-zone">
      <h2>Danger zone</h2>
      <p class="muted">Account deletion follows the server's data retention rules.</p>
      <PixelAlert v-if="deleteFeedback" tone="error">{{ deleteFeedback }}</PixelAlert>
      <RouterLink v-if="ownershipConflict" to="/app" class="text-button">
        Manage room ownership →
      </RouterLink>
      <PixelButton
        variant="danger"
        :disabled="busy || !!deleteCooldown.remaining.value"
        @click="removeAccount"
      >
        {{
          deleteCooldown.remaining.value
            ? `RETRY IN ${deleteCooldown.remaining.value}s`
            : 'DELETE ACCOUNT'
        }}
      </PixelButton>
    </section>
  </main>
</template>
