import axios, {
  AxiosHeaders,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { clearSession, readSession, saveSession } from './session'
import type { TokenPair } from '../types'

const baseURL = (import.meta.env.VITE_API_BASE_URL || 'https://gogo-dl.onrender.com').replace(
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

interface AuthConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
  _accessToken?: string
}

function normalizeError(error: unknown): unknown {
  if (error instanceof ApiError || !axios.isAxiosError(error) || !error.response) return error
  const data: unknown = error.response.data
  const message =
    data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Request failed (${error.response.status})`
  return new ApiError(error.response.status, message)
}

export const publicHttp = axios.create({ baseURL, timeout: 30_000 })
export const http = axios.create({ baseURL, timeout: 30_000 })

publicHttp.interceptors.response.use(undefined, (error: unknown) =>
  Promise.reject(normalizeError(error)),
)

http.interceptors.request.use(
  (config) => {
    const authConfig = config as AuthConfig
    const token = readSession()?.access_token
    authConfig._accessToken = token
    config.headers = AxiosHeaders.from(config.headers)
    if (token) config.headers.set('Authorization', `Bearer ${token}`)
    else config.headers.delete('Authorization')
    return config
  },
  undefined,
  { synchronous: true },
)

let refreshPromise: Promise<TokenPair> | null = null

async function refreshToken(): Promise<TokenPair> {
  if (!refreshPromise) {
    const token = readSession()?.refresh_token
    if (!token) throw new ApiError(401, 'Your session has expired.')
    refreshPromise = publicHttp
      .post<TokenPair>('/api/v1/auth/refresh', { refresh_token: token })
      .then(({ data }) => {
        if (readSession()?.refresh_token !== token)
          throw new ApiError(401, 'Your session has changed.')
        saveSession(data)
        return data
      })
      .catch((error: unknown) => {
        if (readSession()?.refresh_token === token) clearSession()
        throw normalizeError(error)
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

http.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error)) return Promise.reject(error)
  const config = error.config as AuthConfig | undefined
  if (error.response?.status !== 401 || !config || config.signal?.aborted) {
    return Promise.reject(normalizeError(error))
  }
  if (config._retried) {
    if (readSession()?.access_token === config._accessToken) clearSession()
    return Promise.reject(normalizeError(error))
  }
  const session = readSession()
  if (!session?.refresh_token) return Promise.reject(normalizeError(error))
  config._retried = true
  try {
    const token =
      session.access_token !== config._accessToken
        ? session.access_token
        : (await refreshToken()).access_token
    config.headers.set('Authorization', `Bearer ${token}`)
    return await http.request(config)
  } catch (cause) {
    return Promise.reject(normalizeError(cause))
  }
})

export async function request<T>(
  path: string,
  config: AxiosRequestConfig = {},
  authenticated = true,
): Promise<T> {
  const response = await (authenticated ? http : publicHttp).request<T>({ ...config, url: path })
  return response.status === 204 ? (undefined as T) : response.data
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return 'This message is too long.'
    if (error.status === 429) return 'Too many requests. Please try again later.'
    return error.message
  }
  return 'Could not connect to the server. Please try again.'
}
