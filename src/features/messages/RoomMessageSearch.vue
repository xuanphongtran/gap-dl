<script setup lang="ts">
import { onMounted, ref, toRef, watch } from 'vue'
import PixelField from '../../components/base/PixelField.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelEmptyState from '../../components/base/PixelEmptyState.vue'
import MessageRow from './MessageRow.vue'
import { useRoomMessageSearch } from './useRoomMessageSearch'
import type { Message } from '../../types'
const props = defineProps<{
  roomId: number
  userId: number | undefined
  enabled: boolean
  knownMessages: Message[]
}>()
const emit = defineEmits<{ close: []; accessLost: [id: number] }>()
const panel = ref<HTMLElement | null>(null)
const search = useRoomMessageSearch({
  roomId: toRef(props, 'roomId'),
  userId: toRef(props, 'userId'),
  open: ref(true),
  enabled: toRef(props, 'enabled'),
  knownMessages: toRef(props, 'knownMessages'),
  onAccessLost: (id) => emit('accessLost', id),
})
let savedSearchTop = 0
let displayedResults = false
watch(
  [search.submitted, search.pending, toRef(props, 'enabled'), search.error],
  ([text, pending, enabled], [previousText, previousPending, previousEnabled, previousError]) => {
    if (text !== previousText) {
      savedSearchTop = 0
      displayedResults = false
    }
    if (pending || !enabled) {
      if (displayedResults && !previousPending && previousEnabled && !previousError)
        savedSearchTop = panel.value?.scrollTop || 0
      return
    }
  },
  { flush: 'sync' },
)
watch(
  [search.submitted, search.pending, toRef(props, 'enabled'), search.error],
  ([text, pending, enabled, error]) => {
    if (panel.value && text && !pending && enabled && !error) {
      panel.value.scrollTop = savedSearchTop
      displayedResults = true
    }
  },
  { flush: 'post' },
)
onMounted(() => panel.value?.querySelector('input')?.focus())
function time(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(navigator.language || 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}
</script>
<template>
  <section
    ref="panel"
    class="room-search"
    aria-label="Search room messages"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <div class="search-heading">
      <strong>SEARCH MESSAGES</strong><PixelButton @click="emit('close')">CLOSE SEARCH</PixelButton>
    </div>
    <form class="search-form" @submit.prevent="search.submit">
      <PixelField
        v-model="search.input.value"
        label="Search this room"
        hint="All words must match. Maximum 256 UTF-8 bytes."
        :error="search.validationError.value"
        :disabled="!enabled"
        autocomplete="off"
      />
      <PixelButton
        type="submit"
        variant="primary"
        :disabled="!enabled || search.pending.value || !!search.retryAfter.value"
        >SEARCH</PixelButton
      >
    </form>
    <PixelEmptyState v-if="!enabled">Checking conversation access and updates…</PixelEmptyState>
    <PixelEmptyState v-else-if="search.pending.value">Searching...</PixelEmptyState>
    <PixelAlert v-else-if="search.error.value" tone="error"
      >{{ search.error.value
      }}<PixelButton :disabled="!!search.retryAfter.value" @click="search.retry">{{
        search.retryAfter.value ? `RETRY IN ${search.retryAfter.value}s` : 'RETRY'
      }}</PixelButton></PixelAlert
    >
    <template v-else-if="search.submitted.value">
      <p role="status" aria-live="polite" class="muted">
        {{
          search.results.value.length
            ? `${search.results.value.length} matches loaded`
            : 'No matching messages.'
        }}
      </p>
      <div class="search-results">
        <MessageRow
          v-for="message in search.results.value"
          :key="message.id"
          :message="message"
          :mine="message.user_id === userId"
          :time="time(message.created_at)"
        />
      </div>
      <PixelButton
        v-if="search.hasMore.value"
        :disabled="search.loadingMore.value || !!search.retryAfter.value"
        @click="search.loadMore"
        >{{ search.loadingMore.value ? 'LOADING...' : 'LOAD MORE' }}</PixelButton
      >
      <p v-else-if="search.results.value.length" class="muted">End of results.</p>
    </template>
    <PixelEmptyState v-else>Enter text to search this room's messages.</PixelEmptyState>
  </section>
</template>
<style scoped>
.room-search {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px clamp(16px, 4vw, 60px);
}
.search-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.search-heading strong {
  font-family: 'Press Start 2P', monospace;
  font-size: 10px;
}
.search-form {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
.search-form .field {
  flex: 1;
  min-width: 0;
}
.search-form > button {
  margin-top: 24px;
}
.search-results {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .search-form {
    flex-direction: column;
    align-items: stretch;
  }
  .search-form > button {
    margin-top: 0;
  }
  .search-heading {
    flex-wrap: wrap;
  }
}
</style>
