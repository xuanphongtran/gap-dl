import type { RoomRole, RoomPresence } from '../types'

export type RealtimeEvent =
  | {
      type: 'message' | 'message_updated' | 'message_deleted'
      roomId: number
      payload: { id: number; revision: number }
    }
  | { type: 'presence_snapshot'; roomId: number; payload: RoomPresence }
  | { type: 'presence'; roomId: number; payload: { user_id: number; online: boolean } }
  | {
      type: 'typing_started' | 'typing_stopped'
      roomId: number
      payload: { user_id: number; expires_at: string | null }
    }
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

export type RoomActivityEvent = Extract<
  RealtimeEvent,
  { type: 'presence_snapshot' | 'presence' | 'typing_started' | 'typing_stopped' }
>
export interface RoomTypingCommand {
  type: 'typing_started' | 'typing_stopped'
  room_id: string
}
const activityTypes = ['presence_snapshot', 'presence', 'typing_started', 'typing_stopped']

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
const date = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
export function parseRoomPresence(value: unknown, id: number): RoomPresence | null {
  if (!record(value) || !positive(id) || value.room_id !== String(id)) return null
  const ids = (a: unknown): a is number[] =>
    Array.isArray(a) && a.every(positive) && new Set(a).size === a.length
  if (!ids(value.online_user_ids) || !ids(value.typing_user_ids)) return null
  if (
    !value.typing_user_ids.every(
      (id) => value.online_user_ids instanceof Array && value.online_user_ids.includes(id),
    )
  )
    return null
  return {
    room_id: String(id),
    online_user_ids: [...value.online_user_ids].sort((a, b) => a - b),
    typing_user_ids: [...value.typing_user_ids].sort((a, b) => a - b),
  }
}
function validMessage(p: unknown, id: number, type: string): p is { id: number; revision: number } {
  if (
    !record(p) ||
    !positive(p.id) ||
    p.room_id !== id ||
    !(p.user_id === null || positive(p.user_id)) ||
    typeof p.username !== 'string' ||
    typeof p.content !== 'string' ||
    !date(p.created_at) ||
    !positive(p.revision) ||
    !(p.edited_at === null || date(p.edited_at)) ||
    !(p.deleted_at === null || date(p.deleted_at)) ||
    !Array.isArray(p.mention_user_ids) ||
    !p.mention_user_ids.every(positive) ||
    !Array.isArray(p.attachments) ||
    p.attachments.length > 5
  )
    return false
  const seen = new Set<number>()
  for (const a of p.attachments) {
    if (
      !record(a) ||
      !positive(a.id) ||
      seen.has(a.id) ||
      a.verified !== true ||
      typeof a.filename !== 'string' ||
      !a.filename.trim() ||
      !['image/png', 'image/jpeg', 'text/plain'].includes(String(a.content_type)) ||
      !positive(a.size_bytes) ||
      a.size_bytes > 10485760 ||
      typeof a.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(a.sha256)
    )
      return false
    seen.add(a.id)
  }
  if (p.deleted_at !== null && (p.content !== '' || p.attachments.length !== 0)) return false
  if (type === 'message_deleted' && p.deleted_at === null) return false
  return true
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
      'not_joined',
      'authorization_pending',
      'rate_limited',
    ]
    return record(p) &&
      typeof p.code === 'string' &&
      codes.includes(p.code) &&
      typeof p.message === 'string'
      ? { type: 'error', roomId: id, payload: { code: p.code } }
      : null
  }
  if (id === null) return null
  if (
    value.type === 'message' ||
    value.type === 'message_updated' ||
    value.type === 'message_deleted'
  )
    return validMessage(p, id, value.type)
      ? { type: value.type, roomId: id, payload: { id: p.id, revision: p.revision } }
      : null
  if (value.type === 'presence_snapshot') {
    const parsed = parseRoomPresence(p, id)
    return parsed ? { type: 'presence_snapshot', roomId: id, payload: parsed } : null
  }
  if (value.type === 'presence')
    return record(p) && positive(p.user_id) && typeof p.online === 'boolean'
      ? { type: 'presence', roomId: id, payload: { user_id: p.user_id, online: p.online } }
      : null
  if (value.type === 'typing_started' || value.type === 'typing_stopped') {
    if (!record(p) || !positive(p.user_id)) return null
    if (value.type === 'typing_started' ? !date(p.expires_at) : p.expires_at !== null) return null
    return {
      type: value.type,
      roomId: id,
      payload: { user_id: p.user_id, expires_at: p.expires_at as string | null },
    }
  }
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
  invalidActivityRooms?: number[]
} {
  const events: RealtimeEvent[] = []
  let malformed = false
  const invalidActivityRooms = new Set<number>()
  if (typeof frame !== 'string') return { events, malformed: true }
  for (const line of frame.split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      const parsed = event(value)
      if (parsed) events.push(parsed)
      else if (
        record(value) &&
        activityTypes.includes(String(value.type)) &&
        roomId(value.room_id) !== null
      )
        invalidActivityRooms.add(roomId(value.room_id)!)
      else malformed = true
    } catch {
      malformed = true
    }
  }
  return {
    events,
    malformed,
    ...(invalidActivityRooms.size ? { invalidActivityRooms: [...invalidActivityRooms] } : {}),
  }
}
