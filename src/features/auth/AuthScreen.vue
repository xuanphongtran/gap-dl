<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelField from '../../components/base/PixelField.vue'
import PixelPanel from '../../components/base/PixelPanel.vue'
import { errorMessage } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ mode: 'login' | 'register' }>()
const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const registering = computed(() => props.mode === 'register')

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (registering.value)
      await auth.register(email.value.trim(), username.value.trim(), password.value)
    else await auth.login(email.value.trim(), password.value)
    await router.push('/app')
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-art" aria-hidden="true">
      <div class="pixel-orbit orbit-one"></div>
      <div class="pixel-orbit orbit-two"></div>
      <div class="art-core">✦</div>
      <span class="art-star star-one">✦</span><span class="art-star star-two">✦</span
      ><span class="art-star star-three">✦</span>
    </div>
    <PixelPanel as="section" class="auth-card" aria-labelledby="auth-title">
      <div class="brand-mark">G<span>O</span>GO<span class="brand-cursor">_</span>DL</div>
      <p class="eyebrow">PIXEL CHAT // 001</p>
      <h1 id="auth-title">{{ registering ? 'Create account' : 'Welcome back' }}</h1>
      <p class="muted">
        {{
          registering
            ? 'Join the conversation in your own space.'
            : 'Sign in to continue your conversations.'
        }}
      </p>
      <form class="stack-lg" @submit.prevent="submit">
        <PixelField
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          required
          placeholder="you@example.com"
        />
        <PixelField
          v-if="registering"
          v-model="username"
          label="Display name"
          autocomplete="username"
          required
          placeholder="pixel_guest"
        />
        <PixelField
          v-model="password"
          label="Password"
          type="password"
          :autocomplete="registering ? 'new-password' : 'current-password'"
          required
          placeholder="••••••••"
        />
        <PixelAlert v-if="error" tone="error">{{ error }}</PixelAlert>
        <PixelButton variant="primary" full :loading="busy" type="submit">
          {{ busy ? 'PLEASE WAIT...' : registering ? 'CREATE ACCOUNT →' : 'SIGN IN →' }}
        </PixelButton>
      </form>
      <p class="auth-switch muted">
        {{ registering ? 'Already have an account?' : 'New here?' }}
        <RouterLink :to="registering ? '/login' : '/register'">{{
          registering ? 'Sign in' : 'Create an account'
        }}</RouterLink>
      </p>
    </PixelPanel>
  </main>
</template>
