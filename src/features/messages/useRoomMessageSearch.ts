import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useInfiniteQuery, type InfiniteData } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { queryClient, queryKeys } from '../../lib/query'
import { useActionCooldown } from '../../lib/rate-limit'
import type { Message, SearchMessagesResponse } from '../../types'
import { mergeSearchResults, normalizeSearchQuery, validateSearchPage } from './message-search'

type ReadonlyRef<T> = Readonly<Ref<T>>
interface SearchOptions {
  roomId: ReadonlyRef<number>
  userId: ReadonlyRef<number | undefined>
  open: ReadonlyRef<boolean>
  enabled: ReadonlyRef<boolean>
  knownMessages: ReadonlyRef<Message[]>
  onAccessLost: (id: number) => void
}

export function useRoomMessageSearch(options: SearchOptions) {
  const input = ref('')
  const submitted = ref('')
  const validationError = ref('')
  const visible = ref(document.visibilityState === 'visible')
  const generation = ref(0)
  const verified = ref(-1)
  const cooldown = useActionCooldown()
  const key = computed(() =>
    queryKeys.searchMessages(options.roomId.value, options.userId.value || 0, submitted.value),
  )
  const allowed = computed(
    () =>
      options.open.value &&
      options.enabled.value &&
      !!options.userId.value &&
      visible.value &&
      !!submitted.value,
  )

  function cancelKey(oldKey: readonly unknown[], remove: boolean) {
    void queryClient.cancelQueries({ queryKey: oldKey, exact: true })
    if (remove) queryClient.removeQueries({ queryKey: oldKey, exact: true })
    else void queryClient.invalidateQueries({ queryKey: oldKey, exact: true, refetchType: 'none' })
  }
  watch(
    [options.roomId, options.userId, options.open],
    (_values, previous) => {
      const oldKey = queryKeys.searchMessages(previous[0], previous[1] || 0, submitted.value)
      generation.value++
      verified.value = -1
      input.value = ''
      validationError.value = ''
      submitted.value = ''
      cancelKey(oldKey, true)
    },
    { flush: 'sync' },
  )
  watch(
    [key, allowed],
    ([nextKey], [previousKey]) => {
      generation.value++
      verified.value = -1
      cancelKey(previousKey, JSON.stringify(nextKey) !== JSON.stringify(previousKey))
    },
    { flush: 'sync' },
  )
  useEventListener(document, 'visibilitychange', () => {
    visible.value = document.visibilityState === 'visible'
  })

  const query = useInfiniteQuery(
    computed(() => ({
      queryKey: key.value,
      enabled: allowed.value,
      initialPageParam: undefined as number | undefined,
      staleTime: 0,
      retry: false,
      refetchInterval: allowed.value ? 5000 : false,
      queryFn: async ({
        signal,
        pageParam,
      }: {
        signal: AbortSignal
        pageParam: number | undefined
      }) => {
        const id = options.roomId.value,
          user = options.userId.value,
          text = submitted.value,
          epoch = generation.value
        const capturedKey = queryKeys.searchMessages(id, user || 0, text)
        const instance = queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true })
        const current = () =>
          !signal.aborted &&
          epoch === generation.value &&
          allowed.value &&
          id === options.roomId.value &&
          user === options.userId.value &&
          text === submitted.value &&
          instance === queryClient.getQueryCache().find({ queryKey: capturedKey, exact: true })
        try {
          const page = await api.searchMessages(id, text, 20, pageParam, signal)
          signal.throwIfAborted()
          if (!current()) throw new DOMException('Search context changed.', 'AbortError')
          validateSearchPage(page, id, pageParam)
          verified.value = epoch
          return page
        } catch (cause) {
          if (current()) {
            if (cause instanceof ApiError && [403, 404].includes(cause.status))
              options.onAccessLost(id)
            else cooldown.start(cause)
          }
          throw cause
        }
      },
      getNextPageParam: (page: SearchMessagesResponse) => page.next_before ?? undefined,
    })),
  )

  const state = computed(() => {
    // Subscribe to observer changes, but never render an observer's removed cache snapshot.
    void query.data.value
    void query.error.value
    void query.isFetching.value
    return queryClient.getQueryState<InfiniteData<SearchMessagesResponse>>(key.value)
  })
  const error = computed(() =>
    options.open.value && submitted.value && state.value?.error
      ? errorMessage(state.value.error)
      : '',
  )
  const pending = computed(
    () =>
      allowed.value &&
      !error.value &&
      ((query.isFetching.value && !query.isFetchingNextPage.value) ||
        verified.value !== generation.value),
  )
  const results = computed(() => {
    if (!allowed.value || pending.value || error.value || verified.value !== generation.value)
      return []
    return mergeSearchResults(state.value?.data?.pages || [], options.knownMessages.value)
  })
  const hasMore = computed(() => !!submitted.value && !error.value && !!query.hasNextPage.value)
  function submit() {
    const normalized = normalizeSearchQuery(input.value)
    validationError.value = normalized.error
    if (
      normalized.error ||
      !options.open.value ||
      !options.enabled.value ||
      cooldown.remaining.value
    )
      return
    if (submitted.value === normalized.query) {
      void retry()
      return
    }
    submitted.value = normalized.query
  }
  async function loadMore() {
    if (
      !allowed.value ||
      pending.value ||
      query.isFetching.value ||
      error.value ||
      cooldown.remaining.value ||
      !hasMore.value
    )
      return
    await query.fetchNextPage()
  }
  async function retry() {
    if (!allowed.value || cooldown.remaining.value || query.isFetching.value) return
    verified.value = -1
    await query.refetch()
  }
  function clear() {
    const oldKey = key.value
    generation.value++
    verified.value = -1
    input.value = ''
    validationError.value = ''
    submitted.value = ''
    cancelKey(oldKey, true)
  }
  onScopeDispose(clear)
  return {
    input,
    submitted: computed(() => submitted.value),
    validationError: computed(() => validationError.value),
    results,
    error,
    pending,
    loadingMore: computed(() => query.isFetchingNextPage.value),
    hasMore,
    retryAfter: cooldown.remaining,
    submit,
    loadMore,
    retry,
    clear,
  }
}
