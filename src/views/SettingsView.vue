<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, errorMessage } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const avatarUrl = ref('')
const busy = ref(false)
const feedback = ref('')

onMounted(async () => {
  if (!auth.profile) await auth.loadProfile().catch(() => undefined)
  username.value = auth.profile?.username || ''
  avatarUrl.value = auth.profile?.avatar_url || ''
})

async function save() {
  if (busy.value || !username.value.trim()) return
  busy.value = true
  feedback.value = ''
  try {
    auth.profile = await api.updateProfile({
      username: username.value.trim(),
      avatar_url: avatarUrl.value.trim(),
    })
    feedback.value = 'Profile saved.'
  } catch (cause) {
    feedback.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function removeAccount() {
  if (!window.confirm('Permanently delete your account? This cannot be undone.')) return
  busy.value = true
  feedback.value = ''
  try {
    await api.deleteAccount()
    auth.logout()
    await router.replace('/register')
  } catch (cause) {
    feedback.value = errorMessage(cause)
  } finally {
    busy.value = false
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
        {{ auth.profile?.username?.slice(0, 1).toUpperCase() || '?' }}
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
          ><span>Email</span><input :value="auth.profile?.email || ''" readonly
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
