<script setup lang="ts">
import PixelAlert from '../../components/base/PixelAlert.vue'
import PixelButton from '../../components/base/PixelButton.vue'

withDefaults(
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

function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="composer-wrap">
    <PixelAlert v-if="error" tone="error">{{ error }}</PixelAlert>
    <form class="composer" @submit.prevent="emit('send')">
      <label class="sr-only" for="message-input">Message content</label>
      <textarea
        id="message-input"
        :value="modelValue"
        maxlength="4000"
        rows="1"
        placeholder="Write a message..."
        :disabled="disabled || sending"
        @input="update"
        @keydown.enter.exact.prevent="emit('send')"
      ></textarea>
      <PixelButton
        variant="primary"
        class="send-button"
        type="submit"
        :disabled="!modelValue.trim() || disabled || sending || cooldownSeconds > 0"
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
      ><span>{{ cooldownSeconds ? `RETRY IN ${cooldownSeconds}S` : 'HTTP SYNC / 5S' }}</span>
    </div>
  </div>
</template>
