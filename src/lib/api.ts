import { clearSession, readSession, saveSession } from './session'
import type { Invitation, Message, Profile, Room, RoomMember, TokenPair } from '../types'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'https://gogo-dl.onrender.com').replace(
  /\/$/,
  '',
)

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let refreshPromise: Promise<TokenPair> | null = null
const REQUEST_TIMEOUT_MS = 30_000

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  return data as T
}

async function refresh(): Promise<TokenPair> {
  if (!refreshPromise) {
    const token = readSession()?.refresh_token
    if (!token) throw new ApiError(401, 'Your session has expired.')
    refreshPromise = fetchWithTimeout(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    })
      .then(parseResponse<TokenPair>)
      .then((pair) => {
        if (readSession()?.refresh_token !== token) {
          throw new ApiError(401, 'Your session has changed.')
        }
        saveSession(pair)
        return pair
      })
      .catch((error: unknown) => {
        if (readSession()?.refresh_token === token) clearSession()
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const send = (token?: string) => {
    const headers = new Headers(options.headers)
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetchWithTimeout(`${baseUrl}${path}`, {
      ...options,
      headers,
    })
  }
  const initialToken = authenticated ? readSession()?.access_token : undefined
  const response = await send(initialToken)
  if (
    response.status === 401 &&
    authenticated &&
    readSession()?.refresh_token &&
    !options.signal?.aborted
  ) {
    const currentToken = readSession()?.access_token
    const retryToken =
      currentToken && currentToken !== initialToken ? currentToken : (await refresh()).access_token
    const retried = await send(retryToken)
    if (retried.status === 401) clearSession()
    return parseResponse<T>(retried)
  }
  return parseResponse<T>(response)
}

const json = (body: object): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  login: (email: string, password: string) =>
    request<TokenPair>('/api/v1/auth/login', json({ email, password }), false),
  register: (email: string, username: string, password: string) =>
    request<TokenPair>('/api/v1/auth/register', json({ email, username, password }), false),
  profile: () => request<Profile>('/api/v1/users/me'),
  updateProfile: (body: { username?: string; avatar_url?: string }) =>
    request<Profile>('/api/v1/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: () => request<void>('/api/v1/users/me', { method: 'DELETE' }),
  rooms: () => request<{ rooms: Room[] }>('/api/v1/rooms'),
  room: (id: number, signal?: AbortSignal) => request<Room>(`/api/v1/rooms/${id}`, { signal }),
  createRoom: (name: string, visibility: 'public' | 'private') =>
    request<Room>('/api/v1/rooms', json({ name, visibility })),
  joinRoom: (id: number) =>
    request<{ message: string }>(`/api/v1/rooms/${id}/join`, { method: 'POST' }),
  leaveRoom: (id: number) => request<void>(`/api/v1/rooms/${id}/membership`, { method: 'DELETE' }),
  messages: (id: number, limit = 40, before?: number, signal?: AbortSignal) =>
    request<{ messages: Message[] }>(
      `/api/v1/rooms/${id}/messages?${new URLSearchParams({ limit: String(limit), ...(before ? { before: String(before) } : {}) })}`,
      { signal },
    ),
  sendMessage: (id: number, content: string) =>
    request<Message>(`/api/v1/rooms/${id}/messages`, json({ content })),
  members: (id: number, signal?: AbortSignal) =>
    request<{ members: RoomMember[] }>(`/api/v1/rooms/${id}/members`, { signal }),
  invite: (id: number, userId: number) =>
    request<Invitation>(`/api/v1/rooms/${id}/invitations`, json({ user_id: userId })),
  invitations: () =>
    request<{ invitations: Invitation[] }>('/api/v1/users/me/invitations?status=pending'),
  respondInvitation: (id: number, action: 'accept' | 'decline') =>
    request<Invitation>(`/api/v1/invitations/${id}/${action}`, { method: 'POST' }),
  changeRole: (roomId: number, userId: number, role: 'moderator' | 'member') =>
    request<void>(`/api/v1/rooms/${roomId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (roomId: number, userId: number) =>
    request<void>(`/api/v1/rooms/${roomId}/members/${userId}`, { method: 'DELETE' }),
  transferOwnership: (roomId: number, userId: number) =>
    request<void>(`/api/v1/rooms/${roomId}/ownership`, json({ user_id: userId })),
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return 'This message is too long.'
    if (error.status === 429) return 'Too many requests. Please try again later.'
    return error.message
  }
  return 'Could not connect to the server. Please try again.'
}
