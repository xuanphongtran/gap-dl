import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../lib/api'
import { clearSession, readSession, saveSession } from '../lib/session'
import { queryClient } from '../lib/query'

export const useAuthStore = defineStore('auth', () => {
  const signedIn = ref(Boolean(readSession()))

  async function login(email: string, password: string): Promise<void> {
    const pair = await api.login(email, password)
    queryClient.clear()
    saveSession(pair)
    signedIn.value = true
  }

  async function register(email: string, username: string, password: string): Promise<void> {
    const pair = await api.register(email, username, password)
    queryClient.clear()
    saveSession(pair)
    signedIn.value = true
  }

  function logout(): void {
    clearSession()
    queryClient.clear()
    signedIn.value = false
  }

  window.addEventListener('session:changed', () => {
    signedIn.value = Boolean(readSession())
  })

  return { signedIn, login, register, logout }
})
