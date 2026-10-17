import { computed, onScopeDispose, readonly, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { Query } from '@tanstack/vue-query'
import { ApiError, errorMessage } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown } from '../../lib/rate-limit'
import { readSession } from '../../lib/session'

const keys = [queryKeys.profile, queryKeys.rooms, queryKeys.invitations]

export function useWorkspaceRecovery() {
  const pending = ref(false)
  const failure = ref('')
  const readError = ref('')
  const cooldown = useActionCooldown()
  const epoch = ref(0)
  const cooldownEpoch = ref(-1)
  const observed = new WeakSet<object>()
  let owned: Query[] = []
  let cooldownEndsAt = 0
  const cooldownSeconds = computed(() =>
    cooldownEpoch.value === epoch.value ? cooldown.remaining.value : 0,
  )

  function current() {
    return keys.flatMap((key) => {
      const query = queryClient.getQueryCache().find({ queryKey: key, exact: true })
      return query?.isActive() ? [query] : []
    })
  }
  function update() {
    const errors = readSession()
      ? current().flatMap((q) => (q.state.error ? [q.state.error] : []))
      : []
    readError.value = errors.length ? errorMessage(errors[0]) : ''
    if (!errors.length) failure.value = ''
    for (const error of errors) {
      if (observed.has(error)) continue
      observed.add(error)
      if (
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfterSeconds &&
        Date.now() + error.retryAfterSeconds * 1000 > cooldownEndsAt
      ) {
        cooldownEndsAt = Date.now() + error.retryAfterSeconds * 1000
        cooldown.start(error)
        cooldownEpoch.value = epoch.value
      }
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(update)
  function reset() {
    epoch.value++
    cooldownEndsAt = 0
    pending.value = false
    failure.value = ''
    readError.value = ''
    for (const query of owned)
      if (queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true }) === query)
        void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true })
    owned = []
  }
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    )
      reset()
  })
  onScopeDispose(() => {
    unsubscribe()
    reset()
  })
  update()

  async function retry() {
    if (!readSession() || pending.value || cooldownSeconds.value) return
    const generation = epoch.value
    const queries = current()
    owned = queries
    pending.value = true
    failure.value = ''
    const results = await Promise.allSettled(
      queries.map((query) =>
        queryClient.refetchQueries(
          { queryKey: query.queryKey, exact: true, type: 'active' },
          { throwOnError: true, cancelRefetch: false },
        ),
      ),
    )
    if (generation !== epoch.value) return
    const rejected = results.find((r) => r.status === 'rejected')
    if (rejected?.status === 'rejected') failure.value = errorMessage(rejected.reason)
    pending.value = false
    owned = []
    update()
  }
  return {
    pending: readonly(pending),
    cooldownSeconds,
    error: computed(() => readError.value || failure.value),
    retry,
  }
}
