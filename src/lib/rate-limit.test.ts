import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { useActionCooldown, useKeyedActionCooldown } from './rate-limit'

afterEach(() => vi.useRealTimers())

it('disables one action until the bounded retry delay expires', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
  const scope = effectScope()
  const cooldown = scope.run(useActionCooldown)!
  cooldown.start(new ApiError(429, 'limited', undefined, 5))
  expect(cooldown.remaining.value).toBe(5)
  vi.advanceTimersByTime(2000)
  expect(cooldown.remaining.value).toBe(3)
  vi.advanceTimersByTime(3000)
  expect(cooldown.remaining.value).toBe(0)
  scope.stop()
})

it('keeps a limited invitation response independent from other actions', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
  const scope = effectScope()
  const cooldowns = scope.run(useKeyedActionCooldown)!
  cooldowns.start('12:accept', new ApiError(429, 'limited', undefined, 3))
  expect(cooldowns.remaining('12:accept')).toBe(3)
  expect(cooldowns.remaining('12:decline')).toBe(0)
  expect(cooldowns.remaining('13:accept')).toBe(0)
  vi.advanceTimersByTime(3000)
  expect(cooldowns.remaining('12:accept')).toBe(0)
  scope.stop()
})
