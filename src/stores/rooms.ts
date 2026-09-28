import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../lib/api'
import type { Invitation, Room } from '../types'

export const useRoomsStore = defineStore('rooms', () => {
  const rooms = ref<Room[]>([])
  const invitations = ref<Invitation[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [roomData, invitationData] = await Promise.all([api.rooms(), api.invitations()])
      rooms.value = roomData.rooms || []
      invitations.value = invitationData.invitations || []
    } finally {
      loading.value = false
    }
  }

  async function create(name: string, visibility: 'public' | 'private'): Promise<Room> {
    const room = await api.createRoom(name, visibility)
    await load()
    return room
  }

  async function join(id: number): Promise<void> {
    await api.joinRoom(id)
    await load()
  }

  async function respond(id: number, action: 'accept' | 'decline'): Promise<void> {
    await api.respondInvitation(id, action)
    await load()
  }

  return { rooms, invitations, loading, load, create, join, respond }
})
