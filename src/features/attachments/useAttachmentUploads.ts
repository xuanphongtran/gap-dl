import {
  computed,
  onScopeDispose,
  reactive,
  ref,
  shallowReactive,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import { CancelledError, useMutation, useQueries } from '@tanstack/vue-query'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { api, ApiError, errorMessage } from '../../lib/api'
import { uploadAttachmentBytes } from '../../lib/http'
import { queryClient, queryKeys } from '../../lib/query'
import { readSession } from '../../lib/session'
import type { AttachmentMetadata, AttachmentSummary, AttachmentUploadRequest } from '../../types'
import { hashAttachmentFile, validateAttachmentFile } from './attachment-file'

type ReadRef<T> = Readonly<Ref<T>>
export interface UploadRow {
  localId: string
  filename: string
  sizeBytes: number
  phase:
    | 'validating'
    | 'hashing'
    | 'reserving'
    | 'uploading'
    | 'completing'
    | 'processing'
    | 'ready'
    | 'failed'
  progress: number
  attachmentId?: number
  error: string
  cooldownSeconds: number
  inSend: boolean
}
interface Entry {
  row: UploadRow
  file?: File
  body?: AttachmentUploadRequest
  key: string
  room: number
  user: number
  epoch: number
  account: number
  controller: AbortController
  metadata?: AttachmentMetadata
  deadline: number
  observedMs: number
  stopped: boolean
  uncertain: boolean
}
export function useAttachmentUploads(options: {
  roomId: ReadRef<number>
  userId: ReadRef<number | undefined>
  enabled: ReadRef<boolean>
  onAccessLost: (id: number) => void
}) {
  const list = shallowRef<UploadRow[]>([]),
    selectionError = ref(''),
    now = ref(Date.now())
  const entries = new Map<string, Entry>()
  let epoch = 0,
    account = 0,
    disposed = false,
    queue = Promise.resolve(),
    lastTick = Date.now()
  const current = (e: Entry) =>
    !disposed &&
    e.epoch === epoch &&
    e.account === account &&
    e.user === options.userId.value &&
    e.room === options.roomId.value &&
    entries.get(e.row.localId) === e &&
    !!readSession()
  const allowed = (e: Entry) => current(e) && options.enabled.value
  const keyOf = (e: Entry) => queryKeys.attachment(e.room, e.user, e.row.attachmentId!)
  const foreground = ref(document.visibilityState !== 'hidden'),
    online = ref(navigator.onLine)
  const visible = () => foreground.value && online.value
  const cancellation = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (v: { room: number; user: number; id: number; account: number }) => {
      if (v.account !== account || v.user !== options.userId.value || !readSession()) return
      try {
        await api.cancelAttachment(v.room, v.id)
      } catch {
        /* Server expiry covers unconfirmed cancellation. */
      }
    },
  })
  function cancel(e: Entry) {
    if (
      e.row.attachmentId &&
      !e.row.inSend &&
      e.account === account &&
      e.user === options.userId.value &&
      readSession()
    )
      void cancellation.mutateAsync({
        room: e.room,
        user: e.user,
        id: e.row.attachmentId,
        account: e.account,
      })
  }
  function drop(e: Entry, cleanup: boolean) {
    entries.delete(e.row.localId)
    e.controller.abort()
    e.file = undefined
    if (e.row.attachmentId) {
      void queryClient.cancelQueries({ queryKey: keyOf(e), exact: true })
      queryClient.removeQueries({ queryKey: keyOf(e), exact: true })
    }
    list.value = list.value.filter((r) => r !== e.row)
    if (cleanup) cancel(e)
  }
  function reset(cleanup: boolean) {
    epoch++
    for (const e of [...entries.values()]) drop(e, cleanup)
    selectionError.value = ''
    lastTick = Date.now()
  }
  watch(options.roomId, () => reset(true), { flush: 'sync' })
  watch(
    options.userId,
    () => {
      account++
      reset(false)
    },
    { flush: 'sync' },
  )
  useEventListener(window, 'session:changed', (event: Event) => {
    if (
      !readSession() ||
      (event as CustomEvent<{ accountChanged?: boolean }>).detail?.accountChanged
    ) {
      account++
      reset(false)
    }
  })
  useEventListener(window, 'room:access-lost', (event: Event) => {
    if ((event as CustomEvent<{ roomId: number }>).detail.roomId === options.roomId.value)
      reset(false)
  })
  async function waitForAuthorization(e: Entry): Promise<boolean> {
    if (!current(e)) return false
    if (options.enabled.value) return true
    return new Promise((resolve) => {
      const signal = e.controller.signal
      const finish = () => {
        stop()
        signal.removeEventListener('abort', finish)
        resolve(allowed(e))
      }
      const stop = watch(
        options.enabled,
        (value) => {
          if (value) finish()
        },
        { flush: 'sync' },
      )
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || !current(e)) finish()
    })
  }
  function apply(e: Entry, data: AttachmentMetadata) {
    if (!current(e)) return
    if (
      data.id !== e.row.attachmentId ||
      typeof data.state !== 'string' ||
      typeof data.verified !== 'boolean'
    )
      throw new ApiError(0, 'Invalid attachment status.')
    e.metadata = data
    if (
      data.state === 'ready' &&
      data.verified &&
      data.expires_at &&
      Date.parse(data.expires_at) > Date.now()
    ) {
      e.row.phase = 'ready'
      e.row.error = ''
      e.file = undefined
      e.stopped = true
    } else if (
      ['rejected', 'cancelled', 'expired', 'deleted'].includes(data.state) ||
      data.state === 'ready'
    ) {
      e.row.phase = 'failed'
      e.row.error =
        'This file is unavailable, rejected or expired. Remove it and choose another file.'
      e.stopped = true
      e.file = undefined
    } else {
      e.row.phase = 'processing'
      e.row.error = [
        'processing',
        'scan_pending',
        'pending_scan',
        'scanning',
        'pending_upload',
        'uploaded',
        'processing_pending',
      ].includes(data.state)
        ? ''
        : 'Processing status is not recognized. Check status explicitly.'
    }
  }
  async function read(e: Entry, signal: AbortSignal) {
    if (!allowed(e) || !visible() || Date.now() < e.deadline)
      throw new CancelledError({ revert: true })
    const key = keyOf(e),
      instance = queryClient.getQueryCache().find({ queryKey: key, exact: true })
    try {
      const data = await api.attachment(e.room, e.row.attachmentId!, signal)
      if (
        !allowed(e) ||
        signal.aborted ||
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !== instance
      )
        throw new CancelledError({ revert: true })
      apply(e, data)
      return data
    } catch (cause) {
      if (cause instanceof CancelledError || !allowed(e) || signal.aborted)
        throw new CancelledError({ revert: true })
      if (cause instanceof ApiError && cause.status === 429 && cause.retryAfterSeconds)
        e.deadline = Math.max(e.deadline, Date.now() + cause.retryAfterSeconds * 1000)
      e.row.error = errorMessage(cause)
      // An owned-file 404 does not establish that room membership was revoked.
      throw new ApiError(
        cause instanceof ApiError ? cause.status : 0,
        'Attachment status unavailable.',
        cause instanceof ApiError ? cause.requestId : undefined,
        cause instanceof ApiError ? cause.retryAfterSeconds : undefined,
      )
    }
  }
  const queryOptions = (e: Entry) => ({
    queryKey: keyOf(e),
    queryFn: ({ signal }: { signal: AbortSignal }) => read(e, signal),
    retry: false as const,
    staleTime: 0,
  })
  useQueries({
    queries: computed(() =>
      list.value.flatMap((row) => {
        const e = entries.get(row.localId)
        return e?.row.attachmentId
          ? [
              {
                ...queryOptions(e),
                enabled:
                  allowed(e) &&
                  visible() &&
                  row.phase === 'processing' &&
                  !e.stopped &&
                  !row.inSend &&
                  now.value >= e.deadline,
                refetchInterval: 2000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
              },
            ]
          : []
      }),
    ),
  })
  async function check(localId: string, restartObservation = true) {
    const e = entries.get(localId)
    if (
      !e?.row.attachmentId ||
      !allowed(e) ||
      !visible() ||
      e.row.inSend ||
      Date.now() < e.deadline
    )
      return
    if (restartObservation) e.observedMs = 0
    e.stopped = false
    e.row.error = ''
    try {
      await queryClient.fetchQuery(queryOptions(e))
    } catch {
      /* Safe feedback is set at the read boundary. */
    }
  }
  function expired(e: Entry) {
    return !e.metadata?.expires_at || !(Date.parse(e.metadata.expires_at) > Date.now())
  }
  const action = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (localId: string) => {
      const e = entries.get(localId)
      if (!e || !(await waitForAuthorization(e))) return
      e.controller = new AbortController()
      e.row.error = ''
      try {
        if (!e.body) {
          if (!e.file) return
          e.row.phase = 'hashing'
          const sha256 = await hashAttachmentFile(e.file)
          if (!(await waitForAuthorization(e))) return
          const body = {
            filename: e.file.name,
            content_type: validateAttachmentFile(e.file).contentType,
            size_bytes: e.file.size,
            sha256,
          }
          if (
            [...entries.values()].some(
              (other) =>
                other !== e && other.body && JSON.stringify(other.body) === JSON.stringify(body),
            )
          ) {
            selectionError.value = 'This file is already selected.'
            drop(e, false)
            return
          }
          e.body = body
        }
        if (e.row.attachmentId) {
          await check(localId)
          if (!allowed(e) || e.row.phase === 'ready' || e.row.error || Date.now() < e.deadline)
            return
          if (e.metadata && e.metadata.state !== 'pending_upload') return
        } else {
          e.row.phase = 'reserving'
          const ticket = await api.reserveAttachment(e.room, e.body, e.key, e.controller.signal)
          if (!current(e)) return
          if (!Number.isSafeInteger(ticket.attachment?.id) || ticket.attachment.id <= 0)
            throw new ApiError(0, 'Invalid upload reservation.')
          e.row.attachmentId = ticket.attachment.id
          e.metadata = ticket.attachment
          if (!(await waitForAuthorization(e))) return
          e.row.phase = 'uploading'
          e.uncertain = true
          await uploadAttachmentBytes(ticket, e.file!, e.controller.signal, (percent) => {
            if (allowed(e)) e.row.progress = percent
          })
          if (!(await waitForAuthorization(e))) return
          e.uncertain = false
        }
        e.row.phase = 'completing'
        const data = await api.completeAttachment(e.room, e.row.attachmentId!, e.controller.signal)
        if (current(e)) {
          e.observedMs = 0
          e.stopped = false
          apply(e, data)
        }
      } catch (cause) {
        if (!current(e)) return
        if (cause instanceof ApiError && cause.status === 429 && cause.retryAfterSeconds)
          e.deadline = Math.max(e.deadline, Date.now() + cause.retryAfterSeconds * 1000)
        e.row.phase = 'failed'
        e.row.error = e.uncertain
          ? 'Upload outcome is uncertain. Retry to check its status.'
          : errorMessage(cause)
      }
    },
  })
  function enqueue(id: string) {
    queue = queue.then(() => action.mutateAsync(id))
    return queue
  }
  async function select(files: readonly File[]) {
    if (!options.enabled.value || !options.userId.value || !readSession()) return
    selectionError.value = ''
    const fresh = [...new Set(files)].filter(
      (f) => ![...entries.values()].some((e) => e.file === f),
    )
    if (!fresh.length) {
      selectionError.value = 'This file is already selected.'
      return
    }
    if (list.value.length + fresh.length > 5) {
      selectionError.value = 'Choose up to five files.'
      return
    }
    for (const f of fresh) {
      const validation = validateAttachmentFile(f)
      if (validation.error) {
        selectionError.value = `${f.name}: ${validation.error}`
        return
      }
    }
    for (const f of fresh) {
      const row = reactive<UploadRow>({
        localId: crypto.randomUUID(),
        filename: f.name,
        sizeBytes: f.size,
        phase: 'validating',
        progress: 0,
        error: '',
        cooldownSeconds: 0,
        inSend: false,
      })
      const e: Entry = shallowReactive({
        row,
        file: f,
        key: crypto.randomUUID(),
        room: options.roomId.value,
        user: options.userId.value,
        epoch,
        account,
        controller: new AbortController(),
        deadline: 0,
        observedMs: 0,
        stopped: false,
        uncertain: false,
      })
      entries.set(row.localId, e)
      list.value = [...list.value, row]
      void enqueue(row.localId)
    }
    await queue
  }
  async function retry(id: string) {
    const e = entries.get(id)
    if (!e || !allowed(e) || e.row.inSend || Date.now() < e.deadline) return
    if (['ready', 'uploading', 'hashing', 'reserving', 'completing'].includes(e.row.phase)) return
    await enqueue(id)
  }
  async function remove(id: string) {
    const e = entries.get(id)
    if (e && !e.row.inSend) drop(e, true)
  }
  const readyAttachments = computed<AttachmentSummary[]>(() =>
    list.value.flatMap((row) => {
      const e = entries.get(row.localId)
      return e && allowed(e) && row.phase === 'ready' && !row.inSend && !expired(e)
        ? [e.metadata!]
        : []
    }),
  )
  function claimForSend(ids: readonly number[]) {
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          ![...entries.values()].some(
            (e) =>
              e.row.attachmentId === id &&
              allowed(e) &&
              e.row.phase === 'ready' &&
              !e.row.inSend &&
              !expired(e),
          ),
      )
    )
      throw new Error('Files must be ready and unexpired before sending.')
    for (const e of entries.values()) if (ids.includes(e.row.attachmentId!)) e.row.inSend = true
  }
  function settleSend(ids: readonly number[], outcome: 'sent' | 'editable' | 'discarded') {
    for (const e of [...entries.values()])
      if (e.row.inSend && ids.includes(e.row.attachmentId!)) {
        if (outcome === 'editable') {
          e.row.inSend = false
          if (expired(e)) {
            e.row.phase = 'failed'
            e.row.error = 'This file expired. Remove it and choose it again.'
          }
        } else drop(e, false)
      }
  }
  function tick() {
    const time = Date.now(),
      elapsed = Math.max(0, time - lastTick)
    lastTick = time
    now.value = time
    for (const e of entries.values()) {
      e.row.cooldownSeconds = Math.max(0, Math.ceil((e.deadline - time) / 1000))
      if (allowed(e) && visible() && e.row.phase === 'processing' && !e.stopped && !e.row.inSend) {
        e.observedMs += elapsed
        if (e.observedMs >= 60000) {
          e.stopped = true
          e.row.error = 'Processing is taking longer. Check status explicitly.'
        }
      }
      if (e.row.phase === 'ready' && !e.row.inSend && expired(e)) {
        e.row.phase = 'failed'
        e.row.error = 'This file expired. Remove it and choose it again.'
      }
    }
  }
  useIntervalFn(tick, 250)
  const resume = () => {
    foreground.value = document.visibilityState !== 'hidden'
    online.value = navigator.onLine
    lastTick = Date.now()
    tick()
    if (visible())
      for (const e of entries.values())
        if (e.row.phase === 'processing' && !e.stopped) void check(e.row.localId, false)
  }
  useEventListener(document, 'visibilitychange', resume)
  useEventListener(window, 'online', resume)
  useEventListener(window, 'offline', resume)
  useEventListener(window, 'focus', resume)
  watch(options.enabled, (value) => {
    lastTick = Date.now()
    if (value) resume()
  })
  onScopeDispose(() => {
    reset(true)
    disposed = true
  })
  return {
    rows: computed(() => (options.enabled.value ? list.value : [])),
    selectionError,
    readyAttachments,
    blocked: computed(
      () =>
        list.value.some((row) => row.inSend || row.phase !== 'ready') ||
        readyAttachments.value.length !== list.value.length,
    ),
    select,
    remove,
    retry,
    check,
    claimForSend,
    settleSend,
  }
}
