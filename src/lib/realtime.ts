import type { RoomRole } from '../types'

export type RealtimeEvent =
  | { type: 'message'; roomId: number; payload: { id: number } }
  | {
      type: 'membership_changed'
      roomId: number
      payload: {
        action: 'joined' | 'left' | 'removed' | 'role_changed' | 'ownership_transferred'
        user_id: number
        actor_user_id: number
        role: RoomRole
      }
    }
  | { type: 'invitation' | 'notification' | 'join' | 'leave'; roomId: number }
  | { type: 'error'; roomId: number | null; payload: { code: string } }
  | { type: 'unknown'; roomId: number | null }

export function websocketURL(apiBaseURL: string, accessToken: string): string {
  const url = new URL('/api/v1/ws', apiBaseURL)
  if (!['https:', 'http:'].includes(url.protocol) || !accessToken || url.username || url.password)
    throw new Error('Invalid realtime configuration')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', accessToken)
  return url.toString()
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function roomId(value: unknown): number | null {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && positive(Number(value))
    ? Number(value)
    : null
}
function event(value: unknown): RealtimeEvent | null {
  if (!record(value) || typeof value.type !== 'string') return null
  const id = roomId(value.room_id)
  const p = value.payload
  if (value.type === 'error') {
    if (value.room_id !== '' && id === null) return null
    const codes = [
      'invalid_command',
      'payload_too_large',
      'invalid_room_id',
      'forbidden',
      'authorization_failed',
      'authorization_unavailable',
      'unsupported_event',
      'membership_revoked',
    ]
    return record(p) &&
      typeof p.code === 'string' &&
      codes.includes(p.code) &&
      typeof p.message === 'string'
      ? { type: 'error', roomId: id, payload: { code: p.code } }
      : null
  }
  if (id === null) return null
  if (value.type === 'message')
    return record(p) &&
      positive(p.id) &&
      positive(p.user_id) &&
      typeof p.username === 'string' &&
      typeof p.content === 'string' &&
      typeof p.created_at === 'string' &&
      Number.isFinite(Date.parse(p.created_at))
      ? { type: 'message', roomId: id, payload: { id: p.id } }
      : null
  if (value.type === 'membership_changed') {
    if (
      !record(p) ||
      !positive(p.user_id) ||
      !positive(p.actor_user_id) ||
      typeof p.role !== 'string' ||
      typeof p.action !== 'string' ||
      !['owner', 'moderator', 'member'].includes(String(p.role)) ||
      !['joined', 'left', 'removed', 'role_changed', 'ownership_transferred'].includes(
        String(p.action),
      )
    )
      return null
    return {
      type: 'membership_changed',
      roomId: id,
      payload: p as Extract<RealtimeEvent, { type: 'membership_changed' }>['payload'],
    }
  }
  if (value.type === 'join' || value.type === 'leave')
    return record(p) && positive(p.user_id) && typeof p.client_id === 'string'
      ? { type: value.type, roomId: id }
      : null
  if (value.type === 'invitation')
    return record(p) &&
      positive(p.invitation_id) &&
      p.action === 'created' &&
      p.status === 'pending'
      ? { type: 'invitation', roomId: id }
      : null
  if (value.type === 'notification')
    return record(p) &&
      positive(p.id) &&
      p.kind === 'mention' &&
      p.room_id === id &&
      positive(p.message_id)
      ? { type: 'notification', roomId: id }
      : null
  return { type: 'unknown', roomId: id }
}

export function parseRealtimeFrame(frame: unknown): {
  events: RealtimeEvent[]
  malformed: boolean
} {
  const events: RealtimeEvent[] = []
  let malformed = false
  if (typeof frame !== 'string') return { events, malformed: true }
  for (const line of frame.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = event(JSON.parse(line))
      if (parsed) events.push(parsed)
      else malformed = true
    } catch {
      malformed = true
    }
  }
  return { events, malformed }
}
