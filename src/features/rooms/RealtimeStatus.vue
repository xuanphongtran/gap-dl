<script setup lang="ts">
import PixelButton from '../../components/base/PixelButton.vue'
import type { RealtimeStatus } from './realtime-context'

defineProps<{ status: RealtimeStatus }>()
defineEmits<{ retry: [] }>()
const labels: Record<RealtimeStatus, string> = {
  connecting: 'Connecting live updates…',
  connected: 'Live updates connected',
  recovering: 'Checking conversation updates…',
  offline: 'Offline. Waiting for a connection.',
  fallback: 'Live updates unavailable.',
}
</script>
<template>
  <div class="realtime-status" aria-live="polite" role="status">
    <span>{{ labels[status] }}</span>
    <PixelButton
      v-if="status !== 'connected'"
      :disabled="['connecting', 'recovering', 'offline'].includes(status)"
      @click="$emit('retry')"
      >RETRY</PixelButton
    >
  </div>
</template>
<style scoped>
.realtime-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}
.realtime-status button {
  font-size: 9px;
  padding: 4px 8px;
}
</style>
