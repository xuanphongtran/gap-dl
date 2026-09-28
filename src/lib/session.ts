import type { TokenPair } from '../types'

const key = 'gogo-dl-session'

export function readSession(): TokenPair | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const pair = value as Partial<TokenPair>
    return typeof pair.access_token === 'string' && typeof pair.refresh_token === 'string'
      ? (pair as TokenPair)
      : null
  } catch {
    return null
  }
}

export function saveSession(pair: TokenPair): void {
  sessionStorage.setItem(key, JSON.stringify(pair))
  window.dispatchEvent(new Event('session:changed'))
}

export function clearSession(): void {
  sessionStorage.removeItem(key)
  window.dispatchEvent(new Event('session:changed'))
}
