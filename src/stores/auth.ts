import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../lib/api'
import { clearSession, readSession, saveSession } from '../lib/session'
import type { Profile } from '../types'

export const useAuthStore = defineStore('auth', () => {
  const profile = ref<Profile | null>(null)
  const signedIn = ref(Boolean(readSession()))

  async function login(email: string, password: string): Promise<void> {
    saveSession(await api.login(email, password))
    signedIn.value = true
    await loadProfile()
  }

  async function register(email: string, username: string, password: string): Promise<void> {
    saveSession(await api.register(email, username, password))
    signedIn.value = true
    await loadProfile()
  }

  async function loadProfile(): Promise<void> {
    try {
      profile.value = await api.profile()
      signedIn.value = true
    } catch (error) {
      if (!readSession()) logout()
      throw error
    }
  }

  function logout(): void {
    clearSession()
    profile.value = null
    signedIn.value = false
  }

  window.addEventListener('session:changed', () => {
    signedIn.value = Boolean(readSession())
  })

  return { profile, signedIn, login, register, loadProfile, logout }
})
