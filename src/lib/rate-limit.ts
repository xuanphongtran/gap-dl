import { computed, onScopeDispose, ref } from 'vue'
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
