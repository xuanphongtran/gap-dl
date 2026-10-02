import { computed, onScopeDispose, reactive, ref } from 'vue'
import { ApiError } from './http'

export function useActionCooldown() {
  const endsAt = ref(0)
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function start(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 429 || !error.retryAfterSeconds) return
    now.value = Date.now()
    endsAt.value = now.value + error.retryAfterSeconds * 1000
    stop()
    timer = setInterval(() => {
      now.value = Date.now()
      if (now.value >= endsAt.value) stop()
    }, 1000)
  }

  const remaining = computed(() => Math.max(0, Math.ceil((endsAt.value - now.value) / 1000)))
  onScopeDispose(stop)
  return { remaining, start }
}

export function useKeyedActionCooldown() {
  const deadlines = reactive(new Map<string, number>())
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  function remaining(key: string): number {
    return Math.max(0, Math.ceil(((deadlines.get(key) || 0) - now.value) / 1000))
  }

  function start(key: string, error: unknown): void {
    if (!(error instanceof ApiError) || error.status !== 429 || !error.retryAfterSeconds) return
    now.value = Date.now()
    deadlines.set(key, now.value + error.retryAfterSeconds * 1000)
    if (timer) return
    timer = setInterval(() => {
      now.value = Date.now()
      for (const [action, deadline] of deadlines) {
        if (deadline <= now.value) deadlines.delete(action)
      }
      if (!deadlines.size && timer) {
        clearInterval(timer)
        timer = undefined
      }
    }, 1000)
  }

  onScopeDispose(() => {
    if (timer) clearInterval(timer)
  })
  return { remaining, start }
}
