<script setup lang="ts">
import { computed, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { readStateOptions } from '../messages/read-state'
import { ApiError } from '../../lib/api'
import { clearRoomQueries } from '../../lib/query'

const props = defineProps<{ roomId: number; userId: number }>()
const state = useQuery(computed(() => readStateOptions(props.roomId, props.userId)))
const count = computed(() => state.data.value?.unread_count)
watch(state.error, (cause) => {
  if (cause instanceof ApiError && [403, 404].includes(cause.status)) clearRoomQueries(props.roomId)
})
</script>

<template>
  <span v-if="count" class="unread-badge" :aria-label="`${count} unread messages`">{{
    count
  }}</span>
  <span
    v-else-if="state.isError.value"
    class="unread-unavailable"
    aria-label="Unread count unavailable"
    >?</span
  >
</template>

<style scoped>
.unread-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  background: var(--mint);
  color: var(--bg);
  border: 2px solid currentColor;
  font-size: 12px;
  font-weight: 700;
}
.unread-unavailable {
  font-size: 12px;
}
</style>
