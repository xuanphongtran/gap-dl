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
  activity: Readonly<Ref<RoomActivityState>>
  typingInput: (hasText: boolean) => void
  stopTyping: () => void
  status: Readonly<Ref<RealtimeStatus>>
  gapRoomId: Readonly<Ref<number | null>>
  registerRoom: (room: RealtimeRoom) => () => void
  retry: () => void
  reloadConversation: () => Promise<void>
}
export const realtimeKey: InjectionKey<RealtimeContext> = Symbol('workspace-realtime')

export interface RoomActivityScope {
  roomId: number
  userId: number
  connectionEpoch: number
  roomEpoch: number
}
export interface RoomActivityState {
  roomId: number | null
  phase: 'unknown' | 'ready' | 'unavailable'
  onlineUserIds: readonly number[]
  typingUserIds: readonly number[]
}
