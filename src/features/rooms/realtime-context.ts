import type { InjectionKey, Ref } from 'vue'
import type { Message } from '../../types'

export type RealtimeStatus = 'connecting' | 'connected' | 'recovering' | 'offline' | 'fallback'
export interface RealtimeRoom {
  id: number
  userId: number
  messages: () => Message[]
  setPaused: (paused: boolean) => void
  applyRecovered: (messages: Message[]) => void
  reset: () => void
  onAccessLost: () => void
}
export interface RealtimeContext {
  status: Readonly<Ref<RealtimeStatus>>
  gapRoomId: Readonly<Ref<number | null>>
  registerRoom: (room: RealtimeRoom) => () => void
  retry: () => void
  reloadConversation: () => Promise<void>
}
export const realtimeKey: InjectionKey<RealtimeContext> = Symbol('workspace-realtime')
