<script setup lang="ts">
import { computed } from 'vue'
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import { MAX_MESSAGE_BYTES, messageContentBytes } from '../../lib/messages'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled: boolean
    sending: boolean
    error: string
    cooldownSeconds?: number
  }>(),
  { cooldownSeconds: 0 },
)
const emit = defineEmits<{ 'update:modelValue': [value: string]; send: [] }>()
const contentBytes = computed(() => messageContentBytes(props.modelValue))
const overLimit = computed(() => contentBytes.value > MAX_MESSAGE_BYTES)

function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="composer-wrap">
    <PixelAlert v-if="error" tone="error">{{ error }}</PixelAlert>
    <PixelAlert v-if="overLimit" id="message-size-error" tone="error">
      Message exceeds the 4000-byte UTF-8 limit.
    </PixelAlert>
    <form class="composer" @submit.prevent="emit('send')">
      <label class="sr-only" for="message-input">Message content</label>
      <textarea
        id="message-input"
        :value="modelValue"
        maxlength="4000"
        rows="1"
        placeholder="Write a message..."
        :disabled="disabled || sending"
        :aria-invalid="overLimit || undefined"
        :aria-describedby="overLimit ? 'message-size-error' : undefined"
        @input="update"
        @keydown.enter.exact.prevent="emit('send')"
      ></textarea>
      <PixelButton
        variant="primary"
        class="send-button"
        type="submit"
        :disabled="!modelValue.trim() || overLimit || disabled || sending || cooldownSeconds > 0"
        :aria-label="
          sending
            ? 'Sending'
            : cooldownSeconds
              ? `Retry in ${cooldownSeconds} seconds`
              : 'Send message'
        "
      >
        {{ sending ? '...' : '➤' }}
      </PixelButton>
    </form>
    <div class="composer-hint">
      <span>ENTER TO SEND · SHIFT + ENTER FOR NEW LINE</span
      ><span>{{
        cooldownSeconds
          ? `RETRY IN ${cooldownSeconds}S`
          : `${contentBytes}/${MAX_MESSAGE_BYTES} UTF-8 BYTES`
      }}</span>
    </div>
  </div>
</template>
