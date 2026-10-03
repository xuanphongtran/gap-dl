import { request } from './http'
import type { Invitation, Message, Profile, ReadState, Room, RoomMember, TokenPair } from '../types'

export { ApiError, errorMessage, request } from './http'

export const api = {
  login: (email: string, password: string) =>
    request<TokenPair>('/api/v1/auth/login', { method: 'POST', data: { email, password } }, false),
  register: (email: string, username: string, password: string) =>
    request<TokenPair>(
      '/api/v1/auth/register',
      { method: 'POST', data: { email, username, password } },
      false,
    ),
  profile: (signal?: AbortSignal) => request<Profile>('/api/v1/users/me', { signal }),
  updateProfile: (body: { username?: string; avatar_url?: string }) =>
    request<Profile>('/api/v1/users/me', { method: 'PATCH', data: body }),
  deleteAccount: () => request<void>('/api/v1/users/me', { method: 'DELETE' }),
  rooms: (signal?: AbortSignal) => request<{ rooms: Room[] }>('/api/v1/rooms', { signal }),
  room: (id: number, signal?: AbortSignal) => request<Room>(`/api/v1/rooms/${id}`, { signal }),
  createRoom: (name: string, visibility: 'public' | 'private') =>
    request<Room>('/api/v1/rooms', { method: 'POST', data: { name, visibility } }),
  joinRoom: (id: number) =>
    request<{ message: string }>(`/api/v1/rooms/${id}/join`, { method: 'POST' }),
  leaveRoom: (id: number) => request<void>(`/api/v1/rooms/${id}/membership`, { method: 'DELETE' }),
  messages: (id: number, limit = 40, before?: number, signal?: AbortSignal) =>
    request<{ messages: Message[] }>(`/api/v1/rooms/${id}/messages`, {
      params: { limit, ...(before !== undefined ? { before } : {}) },
      signal,
    }),
  sendMessage: (id: number, content: string) =>
    request<Message>(`/api/v1/rooms/${id}/messages`, { method: 'POST', data: { content } }),
  editMessage: (roomId: number, messageId: number, content: string, revision: number) =>
    request<Message>(`/api/v1/rooms/${roomId}/messages/${messageId}`, {
      method: 'PATCH',
      data: { content, revision },
    }),
  deleteMessage: (roomId: number, messageId: number) =>
    request<Message>(`/api/v1/rooms/${roomId}/messages/${messageId}`, { method: 'DELETE' }),
  readState: (id: number, signal?: AbortSignal) =>
    request<ReadState>(`/api/v1/rooms/${id}/read-state`, { signal }),
  advanceReadState: (id: number, messageId: number, signal?: AbortSignal) =>
    request<ReadState>(`/api/v1/rooms/${id}/read-state`, {
      method: 'PUT',
      data: { last_read_message_id: messageId },
      signal,
    }),
  members: (id: number, signal?: AbortSignal) =>
    request<{ members: RoomMember[] }>(`/api/v1/rooms/${id}/members`, { signal }),
  invite: (id: number, userId: number) =>
    request<Invitation>(`/api/v1/rooms/${id}/invitations`, {
      method: 'POST',
      data: { user_id: userId },
    }),
  invitations: (signal?: AbortSignal) =>
    request<{ invitations: Invitation[] }>('/api/v1/users/me/invitations', {
      params: { status: 'pending' },
      signal,
    }),
  respondInvitation: (id: number, action: 'accept' | 'decline') =>
    request<Invitation>(`/api/v1/invitations/${id}/${action}`, { method: 'POST' }),
  changeRole: (roomId: number, userId: number, role: 'moderator' | 'member') =>
    request<void>(`/api/v1/rooms/${roomId}/members/${userId}`, {
      method: 'PATCH',
      data: { role },
    }),
  removeMember: (roomId: number, userId: number) =>
    request<void>(`/api/v1/rooms/${roomId}/members/${userId}`, { method: 'DELETE' }),
  transferOwnership: (roomId: number, userId: number) =>
    request<void>(`/api/v1/rooms/${roomId}/ownership`, {
      method: 'POST',
      data: { user_id: userId },
    }),
}
