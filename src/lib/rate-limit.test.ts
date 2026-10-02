import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { useActionCooldown } from './rate-limit'

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
