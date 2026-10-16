<script setup lang="ts">
import { computed, useId } from 'vue'
import type { RoomMember } from '../../types'
import PixelButton from '../../components/base/PixelButton.vue'
const props = defineProps<{
  members: RoomMember[]
  userId: number
  modelValue: number[]
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [ids: number[]] }>()
const id = useId()
const available = computed(() =>
  props.members.filter(
    (member) => member.user_id !== props.userId && !props.modelValue.includes(member.user_id),
  ),
)
function select(event: Event) {
  const field = event.target as HTMLSelectElement
  const userId = Number(field.value)
  if (!props.disabled && available.value.some((member) => member.user_id === userId))
    emit('update:modelValue', [...props.modelValue, userId])
  field.value = ''
}
</script>
<template>
  <div class="mention-picker stack-sm">
    <label :for="id">Mention recipients</label>
    <select :id="id" :disabled="disabled" @change="select">
      <option value="">Choose a room member</option>
      <option v-for="member in available" :key="member.user_id" :value="member.user_id">
        {{ member.username }}
      </option>
    </select>
    <div v-if="modelValue.length" class="mention-selection">
      <PixelButton
        v-for="userId in modelValue"
        :key="userId"
        :disabled="disabled"
        :aria-label="`Remove mention ${members.find((m) => m.user_id === userId)?.username || 'recipient'}`"
        @click="
          emit(
            'update:modelValue',
            modelValue.filter((id) => id !== userId),
          )
        "
        >{{
          members.find((m) => m.user_id === userId)?.username || 'Unavailable recipient'
        }}
        ×</PixelButton
      >
    </div>
  </div>
</template>
<style scoped>
.mention-picker {
  padding: 0.75rem 1rem;
  border-top: 2px solid var(--border);
  font-size: 0.8rem;
}
.mention-picker select {
  width: 100%;
  padding: 0.5rem;
  color: inherit;
  background: var(--panel);
  border: 2px solid var(--border);
}
.mention-selection {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
