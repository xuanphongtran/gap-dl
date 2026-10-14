<script setup lang="ts">
import { ref, toRef, useId, watch, type Ref } from 'vue'
import PixelButton from '../../components/base/PixelButton.vue'
import PixelAlert from '../../components/base/PixelAlert.vue'
import { useNotificationPreferences } from './useNotificationPreferences'
const props = defineProps<{ userId: number | undefined; roomId?: number; enabled: boolean }>()
const emit = defineEmits<{ 'access-lost': [roomId: number] }>()
const preferences = useNotificationPreferences({
  userId: toRef(props, 'userId'),
  enabled: toRef(props, 'enabled'),
  ...(props.roomId !== undefined
    ? { roomId: toRef(props, 'roomId') as Readonly<Ref<number>> }
    : {}),
  onAccessLost: (id) => emit('access-lost', id),
})
const id = useId(),
  desired = ref(false),
  dirty = ref(false)
watch(
  preferences.value,
  (value) => {
    if (value !== undefined && !dirty.value) desired.value = value
  },
  { immediate: true },
)
watch(
  [toRef(props, 'roomId'), toRef(props, 'userId'), toRef(props, 'enabled')],
  () => {
    dirty.value = false
    desired.value = preferences.value.value ?? false
  },
  { flush: 'sync' },
)
async function save() {
  await preferences.save(desired.value)
  if (!preferences.error.value) {
    dirty.value = false
    desired.value = preferences.value.value ?? desired.value
  }
}
</script>
<template>
  <section class="notification-preferences stack-sm" aria-label="Notification preferences">
    <label :for="id"
      ><input
        :id="id"
        v-model="desired"
        type="checkbox"
        :disabled="!enabled || preferences.value.value === undefined || preferences.saving.value"
        @change="dirty = true"
      />
      {{ roomId !== undefined ? 'MUTE MENTIONS' : 'MENTION NOTIFICATIONS' }}</label
    >
    <p class="muted">This affects future notifications. Existing inbox entries remain.</p>
    <PixelAlert v-if="preferences.error.value" tone="error">{{
      preferences.error.value
    }}</PixelAlert>
    <div class="preference-actions">
      <PixelButton
        :disabled="
          !enabled ||
          preferences.value.value === undefined ||
          preferences.saving.value ||
          !!preferences.cooldownSeconds.value ||
          !dirty
        "
        @click="save"
        >{{ preferences.saving.value ? 'SAVING...' : 'SAVE PREFERENCES' }}</PixelButton
      >
      <PixelButton
        v-if="preferences.value.value === undefined && preferences.error.value"
        :disabled="!!preferences.cooldownSeconds.value || preferences.loading.value || !enabled"
        @click="preferences.retry"
        >RETRY</PixelButton
      >
    </div>
  </section>
</template>
<style scoped>
.notification-preferences {
  padding: 1rem;
  border: 2px solid var(--border);
  background: var(--panel);
  margin-top: 1rem;
}
.notification-preferences label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}
.preference-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
