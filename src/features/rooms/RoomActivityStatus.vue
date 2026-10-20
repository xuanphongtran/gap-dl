<script setup lang="ts">
import { computed } from 'vue'
import type { RoomMember } from '../../types'
import type { RoomActivityState } from './realtime-context'
const props = defineProps<{
  activity: RoomActivityState
  members: readonly RoomMember[]
  userId?: number
  memberId?: number
}>()
const label = computed(() => {
  if (props.activity.phase !== 'ready')
    return props.activity.phase === 'unavailable' ? 'Activity unavailable' : 'Checking activity'
  const authorized = new Set(
    props.members.filter((m) => m.room_id === props.activity.roomId).map((m) => m.user_id),
  )
  if (props.memberId !== undefined)
    return !authorized.has(props.memberId)
      ? 'Checking activity'
      : props.activity.onlineUserIds.includes(props.memberId)
        ? 'Online'
        : 'Offline'
  return `${new Set(props.activity.onlineUserIds.filter((id) => authorized.has(id))).size} online`
})
</script>
<template>
  <span class="room-activity muted">{{ label }}</span>
</template>
