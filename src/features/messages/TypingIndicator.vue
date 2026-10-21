<script setup lang="ts">
import { computed } from 'vue'
import type { RoomMember } from '../../types'
import type { RoomActivityState } from '../rooms/realtime-context'
const props = defineProps<{
  activity: RoomActivityState
  members: readonly RoomMember[]
  userId: number
}>()
const label = computed(() => {
  if (props.activity.phase !== 'ready') return ''
  const members = new Map(
    props.members
      .filter((m) => m.room_id === props.activity.roomId && m.user_id !== props.userId)
      .map((m) => [m.user_id, m.username]),
  )
  const names = [...new Set(props.activity.typingUserIds)]
    .sort((a, b) => a - b)
    .filter((id) => members.has(id))
    .map((id) => members.get(id)!)
  if (!names.length) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  const remaining = names.length - 2
  return `${names[0]}, ${names[1]} and ${remaining} ${remaining === 1 ? 'other' : 'others'} are typing…`
})
</script>
<template>
  <p
    v-if="label"
    class="typing-indicator muted"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ label }}
  </p>
</template>
