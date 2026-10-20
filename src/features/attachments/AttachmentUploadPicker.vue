<script setup lang="ts">
import { ref } from 'vue'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import type { UploadRow } from './useAttachmentUploads'
const props = defineProps<{
  rows: readonly UploadRow[]
  selectionError: string
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [files: File[]]
  remove: [localId: string]
  retry: [localId: string]
  check: [localId: string]
}>()
const input = ref<HTMLInputElement | null>(null)
function select(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  target.value = ''
  if (!props.disabled && files.length) emit('select', files)
}
const labels: Record<UploadRow['phase'], string> = {
  validating: 'Validating',
  hashing: 'Checking file',
  reserving: 'Preparing upload',
  uploading: 'Uploading',
  completing: 'Starting processing',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Needs attention',
}
</script>
<template>
  <section class="attachment-picker" aria-label="Message attachments">
    <input
      id="attachment-files"
      ref="input"
      class="sr-only"
      type="file"
      accept=".png,.jpg,.jpeg,.txt"
      multiple
      :disabled="disabled"
      tabindex="-1"
      aria-label="Attach files"
      @change="select"
    />
    <PixelButton type="button" :disabled="disabled || rows.length >= 5" @click="input?.click()"
      >ATTACH FILES</PixelButton
    >
    <small>PNG, JPEG or TXT · 10 MiB each · 5 files. Switching rooms discards unsent files.</small>
    <PixelAlert v-if="selectionError" tone="error">{{ selectionError }}</PixelAlert>
    <ul v-if="rows.length" class="attachment-list" aria-live="polite">
      <li v-for="row in rows" :key="row.localId" class="attachment-item">
        <span class="attachment-name">{{ row.filename }}</span
        ><small
          >{{ row.sizeBytes }} bytes · {{ row.inSend ? 'Pending send' : labels[row.phase] }}</small
        >
        <progress
          v-if="row.phase === 'uploading'"
          :value="row.progress"
          max="100"
          :aria-label="`Upload progress for ${row.filename}`"
        >
          {{ row.progress }}%
        </progress>
        <span v-if="row.error" class="attachment-error">{{ row.error }}</span>
        <div class="attachment-actions">
          <PixelButton
            v-if="row.phase === 'failed'"
            :disabled="disabled || row.inSend || !!row.cooldownSeconds"
            :aria-label="`Retry ${row.filename}`"
            @click="emit('retry', row.localId)"
            >{{ row.cooldownSeconds ? `RETRY IN ${row.cooldownSeconds}S` : 'RETRY' }}</PixelButton
          >
          <PixelButton
            v-if="row.phase === 'processing' && row.error"
            :disabled="disabled || row.inSend || !!row.cooldownSeconds"
            :aria-label="`Check status of ${row.filename}`"
            @click="emit('check', row.localId)"
            >CHECK STATUS</PixelButton
          >
          <PixelButton
            :disabled="disabled || row.inSend"
            :aria-label="`Remove ${row.filename}`"
            @click="emit('remove', row.localId)"
            >{{ ['ready', 'failed'].includes(row.phase) ? 'REMOVE' : 'CANCEL' }}</PixelButton
          >
        </div>
      </li>
    </ul>
  </section>
</template>
