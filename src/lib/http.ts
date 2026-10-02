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
    public requestId?: string,
    public retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function retryAfterSeconds(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) ? Math.min(seconds, 86_400) : undefined
}

function responseHeader(headers: object, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return typeof entry?.[1] === 'string' ? entry[1] : undefined
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
  return new ApiError(
    error.response.status,
    message,
    responseHeader(error.response.headers, 'x-request-id'),
    retryAfterSeconds(responseHeader(error.response.headers, 'retry-after')),
  )
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
    if (!['GET', 'HEAD'].includes((config.method || 'get').toUpperCase()))
      throw new ApiError(401, 'Session refreshed. Please retry this action.')
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
    const reference =
      error.requestId && /^[A-Za-z0-9._-]{1,128}$/.test(error.requestId)
        ? ` Reference: ${error.requestId}.`
        : ''
    if (error.status === 400) return `Check the information and try again.${reference}`
    if (error.status === 401)
      return error.message === 'Session refreshed. Please retry this action.'
        ? error.message
        : `Sign in again or check your credentials.${reference}`
    if (error.status === 403) return `You do not have permission for this action.${reference}`
    if (error.status === 413) return `The request body is too large.${reference}`
    if (error.status === 429)
      return error.retryAfterSeconds
        ? `Too many requests. Try again in ${error.retryAfterSeconds} seconds.${reference}`
        : `Too many requests. Please try again later.${reference}`
    if ([500, 502, 503, 504].includes(error.status))
      return `The server is temporarily unavailable. Please try again.${reference}`
    if (error.status === 404)
      return `This resource is unavailable or you no longer have access.${reference}`
    if (error.status === 409)
      return /ownership|owning rooms|owner transfer|transfer ownership/i.test(error.message)
        ? `Transfer room ownership before leaving or deleting your account.${reference}`
        : `This action conflicts with the current state.${reference}`
    return `The request could not be completed. Please try again.${reference}`
  }
  return 'Could not connect to the server. Please try again.'
}
