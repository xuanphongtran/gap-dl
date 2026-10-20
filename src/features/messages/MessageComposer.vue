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
    locked?: boolean
    error: string
    cooldownSeconds?: number
    blockedReason?: string
  }>(),
  { cooldownSeconds: 0 },
)
const emit = defineEmits<{ 'update:modelValue': [value: string]; send: [] }>()
const contentBytes = computed(() => messageContentBytes(props.modelValue))
const overLimit = computed(() => contentBytes.value > MAX_MESSAGE_BYTES)
const blocked = computed(
  () =>
    !props.modelValue.trim() ||
    overLimit.value ||
    props.disabled ||
    props.sending ||
    props.locked ||
    props.cooldownSeconds > 0 ||
    !!props.blockedReason,
)
function send() {
  if (!blocked.value) emit('send')
}

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
    <PixelAlert v-if="blockedReason">{{ blockedReason }}</PixelAlert>
    <form class="composer" @submit.prevent="send">
      <label class="sr-only" for="message-input">Message content</label>
      <textarea
        id="message-input"
        :value="modelValue"
        maxlength="4000"
        rows="1"
        placeholder="Write a message..."
        :disabled="disabled || sending || locked"
        :aria-invalid="overLimit || undefined"
        :aria-describedby="overLimit ? 'message-size-error' : undefined"
        @input="update"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <PixelButton
        variant="primary"
        class="send-button"
        type="submit"
        :disabled="blocked"
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
