<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelAlert from '../../components/base/PixelAlert.vue'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useNotificationInbox } from './useNotificationInbox'
const router = useRouter()
const profile = useQuery({
  queryKey: queryKeys.profile,
  queryFn: ({ signal }) => api.profile(signal),
})
const userId = computed(() => profile.data.value?.id)
const inbox = useNotificationInbox({
  userId,
  enabled: computed(() => !!userId.value && !profile.isFetching.value),
})
const list = ref<HTMLElement | null>(null)
let top = 0
let restoreFocus:
  { id: string; action: string; user: number | undefined; filter: boolean } | undefined
useEventListener(document, 'focusin', (event: FocusEvent) => {
  if (restoreFocus && event.target !== document.body && event.target !== document.documentElement)
    restoreFocus = undefined
})
useEventListener(document, 'pointerdown', () => {
  restoreFocus = undefined
})
useEventListener(document, 'keydown', () => {
  if (inbox.loading.value) restoreFocus = undefined
})
watch(
  [inbox.loading, inbox.unreadOnly],
  ([loading, filter], [wasLoading, previousFilter]) => {
    if (filter !== previousFilter) {
      restoreFocus = undefined
      top = 0
      if (list.value) list.value.scrollTop = 0
    } else if (loading && !wasLoading) {
      top = list.value?.scrollTop || 0
      const active = document.activeElement as HTMLElement | null
      const row = active?.closest<HTMLElement>('[data-notification-id]')
      if (row && active?.dataset.notificationAction)
        restoreFocus = {
          id: row.dataset.notificationId!,
          action: active.dataset.notificationAction,
          user: userId.value,
          filter: filter,
        }
    }
  },
  { flush: 'sync' },
)
watch(
  inbox.loading,
  (loading) => {
    if (!loading && list.value) {
      list.value.scrollTop = top
      const target = restoreFocus
      restoreFocus = undefined
      if (
        target &&
        target.user === userId.value &&
        target.filter === inbox.unreadOnly.value &&
        document.activeElement === document.body
      ) {
        const button = list.value.querySelector<HTMLButtonElement>(
          `[data-notification-id="${target.id}"] [data-notification-action="${target.action}"]`,
        )
        if (button && !button.disabled) button.focus({ preventScroll: true })
      }
    }
  },
  { flush: 'post' },
)
async function openRoom(id: number) {
  const user = userId.value
  if ((await inbox.authorizeRoom(id)) && user === userId.value)
    await router.push(`/app/rooms/${id}`)
}
function date(value: string) {
  return new Date(value).toLocaleString()
}
</script>
<template>
  <main class="inbox-screen">
    <RouterLink to="/app" class="text-button">← Back to rooms</RouterLink>
    <h1>Your inbox</h1>
    <p class="muted">
      Mentions from your current rooms. Opening the inbox does not mark messages as read.
    </p>
    <div class="inbox-filters" aria-label="Notification filter">
      <PixelButton :aria-pressed="!inbox.unreadOnly.value" @click="inbox.unreadOnly.value = false"
        >ALL</PixelButton
      >
      <PixelButton :aria-pressed="inbox.unreadOnly.value" @click="inbox.unreadOnly.value = true"
        >UNREAD</PixelButton
      >
    </div>
    <PixelAlert v-if="inbox.error.value" tone="error"
      >{{ inbox.error.value }}
      <PixelButton
        :disabled="!!inbox.cooldownSeconds.value || inbox.loading.value"
        @click="inbox.retry"
        >RETRY</PixelButton
      ></PixelAlert
    >
    <div
      ref="list"
      class="notification-list"
      aria-label="Notifications"
      :aria-busy="inbox.loading.value"
    >
      <p v-if="inbox.loading.value" role="status">Loading notifications...</p>
      <p v-else-if="!inbox.rows.value.length && !inbox.error.value">
        No notifications in this view.
      </p>
      <article
        v-for="row in inbox.rows.value"
        :key="row.id"
        class="notification-row"
        :data-notification-id="row.id"
      >
        <strong>{{ row.kind === 'mention' ? 'Mention' : 'Notification' }}</strong>
        <span>{{ inbox.rooms.value.find((room) => room.id === row.room_id)?.name || 'Room' }}</span>
        <time :datetime="row.created_at">{{ date(row.created_at) }}</time>
        <span>{{ row.read_at ? 'Read' : 'Unread' }}</span>
        <span v-if="row.availability === 'deleted'">MESSAGE DELETED</span>
        <div class="inbox-actions">
          <PixelButton
            v-if="!row.read_at"
            data-notification-action="read"
            :disabled="inbox.readingIds.value.includes(row.id) || !!inbox.cooldownSeconds.value"
            @click="inbox.markRead(row.id)"
            >MARK READ</PixelButton
          >
          <PixelButton
            v-if="row.availability === 'available'"
            data-notification-action="open"
            :disabled="!!inbox.cooldownSeconds.value"
            @click="openRoom(row.room_id)"
            >OPEN ROOM</PixelButton
          >
        </div>
      </article>
      <PixelButton
        v-if="inbox.hasMore.value"
        :disabled="inbox.loading.value || !!inbox.cooldownSeconds.value"
        @click="inbox.loadMore"
        >LOAD MORE</PixelButton
      >
      <p v-else-if="inbox.rows.value.length" class="muted">End of notifications.</p>
    </div>
  </main>
</template>
<style scoped>
.inbox-screen {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  width: 100%;
  padding: 1.5rem;
  overflow: hidden;
}
.inbox-screen h1 {
  font-size: 1.3rem;
}
.inbox-filters,
.inbox-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.notification-list {
  overflow: auto;
  min-height: 0;
  flex: 1;
  overflow-anchor: none;
}
.notification-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 2px solid var(--border);
  background: var(--panel);
  padding: 1rem;
  margin-bottom: 1rem;
  overflow-wrap: anywhere;
}
.notification-row time {
  font-size: 0.8rem;
  color: var(--muted);
}
@media (max-width: 600px) {
  .inbox-screen {
    padding: 1rem;
  }
}
</style>
