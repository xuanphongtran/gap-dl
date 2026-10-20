<script setup lang="ts">
import { computed, toRef } from 'vue'
import PixelButton from '../../components/base/PixelButton.vue'
import type { Message } from '../../types'
import { safeMessageAttachments } from './attachment-metadata'
import { useAttachmentDownload } from './useAttachmentDownload'
const props = defineProps<{ message: Message; userId?: number; enabled: boolean }>()
const emit = defineEmits<{ accessLost: [roomId: number] }>()
const files = computed(() => safeMessageAttachments(props.message))
const action = useAttachmentDownload({
  message: toRef(props, 'message'),
  userId: toRef(props, 'userId'),
  enabled: toRef(props, 'enabled'),
  onAccessLost: (id) => emit('accessLost', id),
})
</script>
<template>
  <ul v-if="enabled && userId && files.length" class="attachment-list" aria-label="Attached files">
    <li v-for="file in files" :key="file.id" class="attachment-item">
      <span class="attachment-name">{{ file.filename }}</span
      ><small>{{ file.content_type }} · {{ file.size_bytes }} bytes</small>
      <span v-if="action.unavailable(file.id)">File unavailable.</span>
      <PixelButton
        v-else
        :disabled="action.pending(file.id) || !!action.cooldownSeconds(file.id)"
        :aria-label="`Download ${file.filename}`"
        @click="action.download(file.id)"
        >{{
          action.pending(file.id)
            ? 'PREPARING...'
            : action.cooldownSeconds(file.id)
              ? `RETRY IN ${action.cooldownSeconds(file.id)}S`
              : 'DOWNLOAD'
        }}</PixelButton
      >
      <span v-if="action.error(file.id)" role="alert" class="attachment-error">{{
        action.error(file.id)
      }}</span>
    </li>
  </ul>
</template>
